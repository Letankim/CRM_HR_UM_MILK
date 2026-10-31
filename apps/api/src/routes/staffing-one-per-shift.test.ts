import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mondayOfWeek } from '@umbm/shared';
import { dayjs } from '../lib/time.js';
import { ensureStartupOnePersonPerShiftMigration, SINGLE_STAFF_MIGRATION_KEY } from '../services/staffing-one-per-shift.service.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

let t: TestAppContext;
const day = (n: number) => dayjs().add(n, 'day').format('YYYY-MM-DD');

beforeAll(async () => { t = await buildTestApp('s'); });
afterAll(async () => { await t.app.close(); });

describe('Quy tắc cứng 1 người / 1 ca & Cân bằng ca mặc định toàn tuần khi nhân sự đăng ký OFF', () => {
  it('Chuẩn hóa toàn bộ định biên 2-4 / 2-3 cũ về đúng 1-1 HARD_BLOCK, cân bằng ca mặc định theo chi nhánh và gỡ ca tương lai xếp trùng', async () => {
    const admin = await t.loginHeaders('admin');
    const hr = await t.loginHeaders('hr');
    const branches = t.db.branches.all().sort((a, b) => a.code.localeCompare(b.code));
    const cn1 = branches[0]!;
    const shifts = t.db.shiftTemplates.all();

    // Tạo dữ liệu định biên cũ 2-4 và 2-3 giống dữ liệu Google Sheets trước khi chuẩn hóa
    for (const s of shifts) {
      await t.db.staffingRules.insert({
        branch_id: cn1.id, shift_template_id: s.id, min_staff: 2, max_staff: s.code === 'CA_TOI' ? 3 : 4,
        enforcement: s.code === 'CA_TOI' ? 'SOFT_WARN' : 'HARD_BLOCK', effective_from: '2026-01-01',
        day_of_week: 'ALL', required_groups_json: '["BARISTA"]', approved_by: 'HR', note: 'Định biên cũ 2-4',
      }, 'test');
    }

    // Thêm 3 nhân sự chính thức tại CN01 đều bị dồn ca mặc định vào CA_SANG
    const addedIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await t.app.inject({
        method: 'POST', url: '/api/admin/employees', headers: hr,
        payload: {
          full_name: `Nhân Sự Chính Thức ${i + 1}`, phone_number: `091680010${i}`,
          branch_id: cn1.id, stage: 'OFFICIAL', employment_type: 'FULL_TIME',
          default_shift_code: 'CA_SANG', create_account: false,
        },
      });
      expect(res.statusCode).toBe(201);
      addedIds.push(res.json().data.id as string);
    }

    // Tạo 2 ca tương lai trùng cùng 1 khung ca CA_SANG tại CN01 (dữ liệu lịch cũ xếp > 1 người/ca)
    const futureDate = day(25);
    await t.db.shiftAssignments.insert({
      schedule_week_id: 'WK-OLD', employee_id: addedIds[0]!, branch_id: cn1.id, work_date: futureDate,
      shift_template_id: shifts[0]!.id, start_at: '07:00', end_at: '12:00', status: 'PUBLISHED',
      source: 'MANUAL', employee_stage: 'OFFICIAL', day_type: 'WORK', shift_code: 'CA_SANG',
      scheduled_hours: 5, swapped_from_employee_id: '', replacement_for_employee_id: '', published_at: '', note: '', linked_assignment_id: '',
    }, 'test');
    await t.db.shiftAssignments.insert({
      schedule_week_id: 'WK-OLD', employee_id: addedIds[1]!, branch_id: cn1.id, work_date: futureDate,
      shift_template_id: shifts[0]!.id, start_at: '07:00', end_at: '12:00', status: 'PUBLISHED',
      source: 'MANUAL', employee_stage: 'OFFICIAL', day_type: 'WORK', shift_code: 'CA_SANG',
      scheduled_hours: 5, swapped_from_employee_id: '', replacement_for_employee_id: '', published_at: '', note: '', linked_assignment_id: '',
    }, 'test');

    // Chạy migration tự động khi khởi động (và gọi lại lần 2 đảm bảo idempotent)
    const mig1 = await ensureStartupOnePersonPerShiftMigration(t.ctx, 'startup-sync');
    expect(mig1).not.toBeNull();
    expect(mig1!.updatedRules).toBe(3);
    expect(mig1!.createdRules).toBe(9);
    expect(mig1!.trimmedFutureShifts).toBe(1);
    expect(t.db.systemSettings.find((s) => s.key === SINGLE_STAFF_MIGRATION_KEY)?.value).toBe('true');
    expect(await ensureStartupOnePersonPerShiftMigration(t.ctx, 'startup-sync')).toBeNull();

    // Kiểm tra API chuẩn hóa thủ công từ giao diện Quản trị viên
    const apiNorm = await t.app.inject({ method: 'POST', url: '/api/admin/staffing-rules/normalize-single', headers: admin, payload: {} });
    expect(apiNorm.statusCode).toBe(200);

    const allRules = (await t.app.inject({ method: 'GET', url: '/api/admin/staffing-rules', headers: admin })).json().data as { min_staff: number; max_staff: number; enforcement: string }[];
    expect(allRules.length).toBe(12);
    expect(allRules.every((r) => r.min_staff === 1 && r.max_staff === 1 && r.enforcement === 'HARD_BLOCK')).toBe(true);

    // Ca mặc định của 4 NV chính thức tại CN01 được chia đều đủ cả 3 ca: CA_SANG, CA_CHIEU, CA_TOI
    const cn1Officials = t.db.employees.filter((e) => e.branch_id === cn1.id && e.stage === 'OFFICIAL');
    const dist = new Set(cn1Officials.map((e) => e.default_shift_code));
    expect(dist.has('CA_SANG') && dist.has('CA_CHIEU') && dist.has('CA_TOI')).toBe(true);

    // Ca tương lai xếp trùng chỉ còn đúng 1 người
    expect(t.db.shiftAssignments.filter((a) => a.branch_id === cn1.id && a.work_date === futureDate && a.shift_code === 'CA_SANG').length).toBe(1);
  });

  it('Chặn xếp người thứ 2 vào cùng 1 ca (POST, PUT duyệt nháp, Bulk PUBLISH) và xếp đủ 21/21 ca (1 người/ca) khi nhiều người đăng ký OFF trong tuần', async () => {
    const hr = await t.loginHeaders('hr');
    const cn1 = t.db.branches.all().sort((a, b) => a.code.localeCompare(b.code))[0]!;
    const officials = t.db.employees.filter((e) => e.branch_id === cn1.id && e.stage === 'OFFICIAL').sort((a, b) => a.employee_code.localeCompare(b.employee_code));
    expect(officials.length).toBeGreaterThanOrEqual(4);

    // 1. Chặn POST PUBLISHED người thứ 2 vào cùng 1 ca
    const testDate = day(32);
    const first = await t.app.inject({ method: 'POST', url: '/api/admin/schedules', headers: hr, payload: { employee_id: officials[0]!.id, work_date: testDate, shift_code: 'CA_CHIEU', status: 'PUBLISHED' } });
    expect(first.statusCode).toBe(201);
    const secondPub = await t.app.inject({ method: 'POST', url: '/api/admin/schedules', headers: hr, payload: { employee_id: officials[1]!.id, work_date: testDate, shift_code: 'CA_CHIEU', status: 'PUBLISHED' } });
    expect(secondPub.statusCode).toBe(400);

    // 2. Chặn PUT DRAFT -> PUBLISHED và Bulk PUBLISH khi ca đã đủ 1/1 người
    const draft = (await t.app.inject({ method: 'POST', url: '/api/admin/schedules', headers: hr, payload: { employee_id: officials[1]!.id, work_date: testDate, shift_code: 'CA_CHIEU', status: 'DRAFT' } })).json().data;
    const putApprove = await t.app.inject({ method: 'PUT', url: `/api/admin/schedules/${draft.id}`, headers: hr, payload: { version: draft.version, status: 'PUBLISHED' } });
    expect(putApprove.statusCode).toBe(400);
    const bulkApprove = await t.app.inject({ method: 'POST', url: '/api/admin/schedules/bulk-action', headers: hr, payload: { action: 'PUBLISH', items: [{ id: draft.id, version: draft.version }] } });
    expect(bulkApprove.statusCode).toBe(400);

    // 3. Đăng ký 4 đơn nghỉ OFF rải đều các ngày trong tuần cho cả 4 NV chính thức -> vẫn sắp đủ 21/21 ca đúng 1 người/ca, 0 lỗi
    const weekStart = mondayOfWeek(day(75));
    for (let i = 0; i < 4; i++) {
      const offDay = dayjs(weekStart).add(i, 'day').format('YYYY-MM-DD');
      const r = await t.app.inject({ method: 'POST', url: '/api/admin/leave-requests', headers: hr, payload: { employee_id: officials[i]!.id, leave_date: offDay, reason: `Nghỉ OFF ngày ${i + 1}` } });
      expect(r.statusCode).toBe(201);
    }

    const lockRes = await t.app.inject({ method: 'POST', url: '/api/admin/schedule-planner/week/lock', headers: hr, payload: { week_start: weekStart, branch_id: cn1.id } });
    expect(lockRes.statusCode).toBe(200);
    expect(lockRes.json().data.createdCount).toBe(21);
    expect(lockRes.json().data.approvedOffCount).toBe(4);
    expect(lockRes.json().data.issues.length).toBe(0);

    for (let dIdx = 0; dIdx < 7; dIdx++) {
      const d = dayjs(weekStart).add(dIdx, 'day').format('YYYY-MM-DD');
      for (const sc of ['CA_SANG', 'CA_CHIEU', 'CA_TOI']) {
        const slotRows = t.db.shiftAssignments.filter((a) => a.branch_id === cn1.id && a.work_date === d && a.shift_code === sc && a.status === 'PUBLISHED');
        expect(slotRows.length).toBe(1);
      }
    }
  });
});
