import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PIN } from '../data/memory-seed.js';
import { dayjs } from '../lib/time.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

describe('Duyệt chuyển Nhân viên Chính thức & Xem trước Lịch tuần (Promote Schedule Preview)', () => {
  let t: TestAppContext;
  const todayStr = dayjs().format('YYYY-MM-DD');

  beforeAll(async () => {
    t = await buildTestApp('promote_official_preview');
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('Xem trước (Preview) trả về danh sách ca thử việc cũ cần thu hồi (REMOVE) và ca chính thức gợi ý (CREATE)', async () => {
    const hr = await t.loginHeaders('hr');
    const probEmp = t.db.employees.find((e) => e.employee_code === 'NV0001')!;

    // 1. Tạo 1 ca thử việc tương lai cho NV0001
    const futureDate = dayjs().add(2, 'day').format('YYYY-MM-DD');
    const schRes = await t.app.inject({
      method: 'POST',
      url: '/api/admin/schedules',
      headers: hr,
      payload: {
        branch_id: probEmp.branch_id,
        employee_id: probEmp.id,
        work_date: futureDate,
        shift_code: 'CHIEU',
        status: 'PUBLISHED',
        day_type: 'WORK',
        note: 'Ca thử việc tương lai',
      },
    });
    expect(schRes.statusCode).toBe(201);

    // 2. Gọi API GET /api/admin/employees/:id/promote-preview
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/admin/employees/${probEmp.id}/promote-preview?official_from=${todayStr}`,
      headers: hr,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.employee.id).toBe(probEmp.id);
    expect(body.data.officialFrom).toBe(todayStr);

    // Stale shift tương lai phải nằm trong staleShifts với action = REMOVE
    const staleItem = body.data.staleShifts.find((s: { workDate: string; shiftCode: string }) => s.workDate === futureDate && s.shiftCode === 'CHIEU');
    expect(staleItem).toBeDefined();
    expect(staleItem.action).toBe('REMOVE');
  });

  it('Chặn duyệt chuyển nếu truyền ca làm việc trong quá khứ', async () => {
    const hr = await t.loginHeaders('hr');
    const probEmp = t.db.employees.find((e) => e.employee_code === 'NV0001')!;
    const pastDate = dayjs().subtract(1, 'day').format('YYYY-MM-DD');

    const res = await t.app.inject({
      method: 'POST',
      url: `/api/admin/employees/${probEmp.id}/promote-official`,
      headers: hr,
      payload: {
        version: probEmp.version,
        official_from: todayStr,
        evaluation_summary: 'Đạt yêu cầu thử việc',
        create_shifts: [
          { work_date: pastDate, shift_code: 'SANG', note: 'Ca quá khứ vi phạm' },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(JSON.stringify(body)).toContain('quá khứ');
  });

  it('Duyệt chuyển chính thức thành công: cập nhật stage=OFFICIAL, thu hồi ca thử việc cũ và tạo ca chính thức mới', async () => {
    const hr = await t.loginHeaders('hr');
    const probEmp = t.db.employees.find((e) => e.employee_code === 'NV0001')!;
    const futureDate = dayjs().add(3, 'day').format('YYYY-MM-DD');

    const res = await t.app.inject({
      method: 'POST',
      url: `/api/admin/employees/${probEmp.id}/promote-official`,
      headers: hr,
      payload: {
        version: probEmp.version,
        official_from: todayStr,
        evaluation_summary: 'Hoàn thành xuất sắc 7 ca thử việc và đạt đánh giá chuyên môn',
        create_shifts: [
          { work_date: futureDate, shift_code: 'TOI', note: 'Bổ sung ca chính thức' },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const updated = t.db.employees.get(probEmp.id)!;
    expect(updated.stage).toBe('OFFICIAL');
    expect(updated.official_from).toBe(todayStr);

    // Kiểm tra ca mới đã được tạo trong bảng shiftAssignments
    const newShift = t.db.shiftAssignments.find((s) => s.employee_id === probEmp.id && s.work_date === futureDate && s.shift_code === 'TOI');
    expect(newShift).toBeDefined();
    expect(newShift?.status).toBe('PUBLISHED');
  });
});
