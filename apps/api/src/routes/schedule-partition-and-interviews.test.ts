import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDaysYmd } from '@umbm/shared';
import { dayjs } from '../lib/time.js';
import { sweepUpcomingInterviewReminders } from '../services/interview-reminder.service.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

let t: TestAppContext;
let adminH: Record<string, string>, hrH: Record<string, string>, storeH: Record<string, string>;

const HR_MAIL = 'hr.remind.real@gmail.com';
const STORE_MAIL = 'store1.remind.real@gmail.com';
const CAND_MAIL = 'ungvien.remind.real@gmail.com';

beforeAll(async () => {
  t = await buildTestApp('sched_part_iv');
  t.email.attachDatabase(t.db);
  for (const [uname, mail] of [['hr', HR_MAIL], ['store1', STORE_MAIL]] as const) {
    const u = t.db.users.find((x) => x.username === uname)!;
    await t.db.users.update(u.id, u.version, { email: mail }, 'test');
  }
  adminH = await t.loginHeaders('admin');
  hrH = await t.loginHeaders('hr');
  storeH = await t.loginHeaders('store1');
});
afterAll(async () => { await t.app.close(); });

async function createOfficials(branchId: string, prefix: string, shiftCodes: ('CA_SANG' | 'CA_CHIEU' | 'CA_TOI')[]) {
  const ids: string[] = [];
  for (const [idx, sc] of shiftCodes.entries()) {
    const res = await t.app.inject({
      method: 'POST', url: '/api/admin/employees', headers: hrH,
      payload: {
        full_name: `NV ${prefix} ${sc} #${idx + 1}`, phone_number: `09${prefix}${String(idx).padStart(2, '0')}77`,
        branch_id: branchId, stage: 'OFFICIAL', employment_type: 'FULL_TIME', default_shift_code: sc, create_account: false,
      },
    });
    expect(res.statusCode).toBe(201);
    ids.push(res.json().data.id as string);
  }
  return ids;
}

describe('Cảnh báo OFF trùng ngày, Lịch sử 4 tuần xuyên Sheet tháng & Phỏng vấn nâng cao', () => {
  it('1. Cảnh báo CRITICAL khi toàn bộ nhân sự cùng nhóm ca (2, 3, 4 người) đăng ký nghỉ OFF trùng 1 ngày', async () => {
    const cn2 = t.db.branches.filter((b) => b.status === 'ACTIVE').sort((a, b) => a.code.localeCompare(b.code))[1]!;
    for (const e of t.db.employees.filter((x) => x.branch_id === cn2.id && x.status === 'ACTIVE')) {
      await t.db.employees.softDelete(e.id, e.version, 'test');
    }
    const [m1, m2, c1] = await createOfficials(cn2.id, '5111', ['CA_SANG', 'CA_SANG', 'CA_CHIEU', 'CA_TOI']);
    const targetMonday = '2027-08-02', leaveDate = '2027-08-04';

    const r1 = await t.app.inject({ method: 'POST', url: '/api/admin/leave-requests', headers: hrH, payload: { employee_id: m1, leave_date: leaveDate, shift_code: 'CA_SANG', reason: 'Việc cá nhân 1' } });
    const r2 = await t.app.inject({ method: 'POST', url: '/api/admin/leave-requests', headers: hrH, payload: { employee_id: m2, leave_date: leaveDate, shift_code: 'CA_SANG', reason: 'Việc cá nhân 2' } });
    const r3 = await t.app.inject({ method: 'POST', url: '/api/admin/leave-requests', headers: hrH, payload: { employee_id: c1, leave_date: leaveDate, shift_code: 'CA_CHIEU', reason: 'Việc cá nhân 3' } });
    expect([r1.statusCode, r2.statusCode, r3.statusCode]).toEqual([201, 201, 201]);

    const listRes = await t.app.inject({ method: 'GET', url: `/api/admin/leave-requests?branch_id=${cn2.id}`, headers: hrH });
    const leave1Row = listRes.json().data.find((x: { id: string }) => x.id === r1.json().data.id);
    expect(leave1Row.offConflict).toMatchObject({
      hasConflict: true, sameBranchOffCount: 3, sameShiftOffCount: 2, sameShiftTotalStaff: 2,
      remainingGroupStaff: 0, willUnderstaffShift: true, severity: 'CRITICAL',
    });
    expect(String(leave1Row.offConflict.warningMessage)).toContain('trống ca');

    const plannerRes = await t.app.inject({ method: 'GET', url: `/api/admin/schedule-planner/week?week_start=${targetMonday}&branch_id=${cn2.id}`, headers: hrH });
    expect(plannerRes.json().data.summary.offConflictCount).toBeGreaterThanOrEqual(1);
    const dayConflict = plannerRes.json().data.offConflicts.find((c: { leaveDate: string }) => c.leaveDate === leaveDate);
    expect(dayConflict).toMatchObject({ severity: 'CRITICAL', totalOffCount: 3 });

    const decideRes = await t.app.inject({
      method: 'POST', url: `/api/admin/leave-requests/${r1.json().data.id}/decide`, headers: hrH,
      payload: { version: 1, decision: 'APPROVED', decision_reason: 'Chấp thuận và sẽ điều phối quản lý trực thay' },
    });
    expect(decideRes.statusCode).toBe(200);
    expect(String(decideRes.json().message)).toContain('trống ca');
  });

  it('2. Giữ nguyên thống kê "4 tuần trước" & xoay vòng 4-3 + đảo Chủ Nhật chính xác khi chuyển sang Sheet phân vùng tháng mới', async () => {
    const cn3 = t.db.branches.filter((b) => b.status === 'ACTIVE').sort((a, b) => a.code.localeCompare(b.code))[2]!;
    for (const e of t.db.employees.filter((x) => x.branch_id === cn3.id && x.stage === 'OFFICIAL')) {
      await t.db.employees.softDelete(e.id, e.version, 'test');
    }
    const [s1, s2] = await createOfficials(cn3.id, '6222', ['CA_SANG', 'CA_SANG', 'CA_CHIEU', 'CA_TOI']);

    expect((await t.app.inject({ method: 'POST', url: '/api/admin/data-partitions/rollover', headers: adminH, payload: { month_key: '2027_10', carry_forward: false } })).statusCode).toBe(201);
    for (const ws of ['2027-10-11', '2027-10-18', '2027-10-25']) {
      expect((await t.app.inject({ method: 'POST', url: '/api/admin/schedule-planner/week/lock', headers: hrH, payload: { week_start: ws, branch_id: cn3.id } })).statusCode).toBe(200);
    }
    const octSunEmp = t.db.shiftAssignments.find((a) => a.branch_id === cn3.id && a.work_date === '2027-10-31' && a.shift_code === 'CA_SANG')!.employee_id;

    expect((await t.app.inject({ method: 'POST', url: '/api/admin/data-partitions/rollover', headers: adminH, payload: { month_key: '2027_11', carry_forward: false } })).statusCode).toBe(201);
    expect(t.db.shiftAssignments.all()).toHaveLength(0);

    const novPreview = await t.app.inject({ method: 'GET', url: `/api/admin/schedule-planner/week?week_start=2027-11-01&branch_id=${cn3.id}`, headers: hrH });
    const load1 = novPreview.json().data.employeeLoads.find((l: { employeeId: string }) => l.employeeId === s1);
    const load2 = novPreview.json().data.employeeLoads.find((l: { employeeId: string }) => l.employeeId === s2);
    expect([load1.recent4WeeksShifts, load2.recent4WeeksShifts].sort((a, b) => a - b)).toEqual([10, 11]);
    expect(load1.recent4WeeksShifts + load1.totalWeekShifts).toBe(14);
    expect(load2.recent4WeeksShifts + load2.totalWeekShifts).toBe(14);

    const novSunPlanned = novPreview.json().data.planned.find((p: { workDate: string; shiftCode: string }) => p.workDate === addDaysYmd('2027-11-01', 6) && p.shiftCode === 'CA_SANG');
    expect(novSunPlanned.employeeId).not.toBe(octSunEmp);
    await t.app.inject({ method: 'PUT', url: '/api/admin/data-partitions/active', headers: adminH, payload: { month_key: '' } });
  });

  it('3. Chặn đặt lịch / đổi lịch phỏng vấn giao thoa khoảng thời gian người phỏng vấn & cảnh báo giao thoa khung giờ', async () => {
    const branchId = t.db.branches.all()[0]!.id;
    const mkCand = async (name: string, phone: string) => {
      const r = await t.app.inject({ method: 'POST', url: '/api/admin/candidates', headers: hrH, payload: { full_name: name, phone, applied_position: 'BARISTA', applied_branch_id: branchId } });
      expect(r.statusCode).toBe(201);
      return r.json().data.id as string;
    };
    const [candA, candB, candC] = [await mkCand('Ứng viên A', '0908111222'), await mkCand('Ứng viên B', '0908111333'), await mkCand('Ứng viên C', '0908111444')];

    const ivA = await t.app.inject({ method: 'POST', url: '/api/admin/interviews', headers: hrH, payload: { candidate_id: candA, interviewer_ids: ['hr', 'store1'], scheduled_at: '2027-06-15T10:00:00+07:00', duration_minutes: 45 } });
    expect(ivA.statusCode).toBe(201);

    const overlapCreate = await t.app.inject({ method: 'POST', url: '/api/admin/interviews', headers: hrH, payload: { candidate_id: candB, interviewer_ids: ['store1'], scheduled_at: '2027-06-15T10:30:00+07:00', duration_minutes: 30 } });
    expect(overlapCreate.statusCode).toBe(400);
    expect(overlapCreate.json().errors.details[0]).toMatchObject({ field: 'scheduled_at', code: 'DUPLICATE_VALUE' });
    expect(String(overlapCreate.json().errors.details[0].message)).toContain('Ứng viên A');

    const ivC = await t.app.inject({ method: 'POST', url: '/api/admin/interviews', headers: hrH, payload: { candidate_id: candC, interviewer_ids: ['hr'], scheduled_at: '2027-06-15T14:00:00+07:00', duration_minutes: 30 } });
    expect(ivC.statusCode).toBe(201);
    const overlapResched = await t.app.inject({ method: 'PUT', url: `/api/admin/interviews/${ivC.json().data.id}/evaluate`, headers: hrH, payload: { version: 1, interviewer_ids: ['hr'], scheduled_at: '2027-06-15T09:45:00+07:00', duration_minutes: 30 } });
    expect(overlapResched.statusCode).toBe(400);
    expect(overlapResched.json().errors.details[0].code).toBe('DUPLICATE_VALUE');

    const diffPanel = await t.app.inject({ method: 'POST', url: '/api/admin/interviews', headers: hrH, payload: { candidate_id: candB, interviewer_ids: ['admin'], scheduled_at: '2027-06-15T10:20:00+07:00', duration_minutes: 30 } });
    expect(diffPanel.statusCode).toBe(201);
    expect(diffPanel.json().data.slotOverlaps).toHaveLength(1);
    expect(String(diffPanel.json().message)).toContain('Lưu ý:');
  });

  it('4. Tự động nhắc lịch phỏng vấn trước 5–10 phút tới Hội đồng phỏng vấn, HR & Ứng viên (chống gửi trùng) và chấm điểm 2 phân loại kinh nghiệm', async () => {
    const branchId = t.db.branches.all()[0]!.id;
    const candDRes = await t.app.inject({
      method: 'POST', url: '/api/admin/candidates', headers: hrH,
      payload: { full_name: 'Lê Minh Khôi', phone: '0908555666', email: CAND_MAIL, applied_position: 'BARISTA', applied_branch_id: branchId, experience_note: 'Đã làm pha chế 2 năm tại chuỗi trà sữa' },
    });
    expect(candDRes.statusCode).toBe(201);

    const beforeMailIds = new Set(t.email.recent(200).map((m) => m.id));
    const startSoonIso = dayjs().tz('Asia/Ho_Chi_Minh').add(8, 'minute').second(0).format('YYYY-MM-DDTHH:mm:ssZ');
    const ivSoon = await t.app.inject({
      method: 'POST', url: '/api/admin/interviews', headers: hrH,
      payload: { candidate_id: candDRes.json().data.id, interviewer_ids: ['hr', 'store1'], scheduled_at: startSoonIso, duration_minutes: 30 },
    });
    expect(ivSoon.statusCode).toBe(201);
    const ivSoonId = ivSoon.json().data.id as string;

    await sweepUpcomingInterviewReminders(t.ctx);
    await t.email.processQueueBatch(15);

    const reminderNotifs = t.db.notifications.filter((n) => n.entity_type === 'INTERVIEW_REMINDER' && n.entity_id.startsWith(`${ivSoonId}@`));
    expect(reminderNotifs).toHaveLength(1);
    expect(reminderNotifs[0]!.title).toContain('Nhắc lịch phỏng vấn sau');

    const hrNotifs = (await t.app.inject({ method: 'GET', url: '/api/notifications?per_page=50', headers: hrH })).json().data;
    const storeNotifs = (await t.app.inject({ method: 'GET', url: '/api/notifications?per_page=50', headers: storeH })).json().data;
    expect(hrNotifs.some((n: { id: string }) => n.id === reminderNotifs[0]!.id)).toBe(true);
    expect(storeNotifs.some((n: { id: string }) => n.id === reminderNotifs[0]!.id)).toBe(true);

    const newRemindMails = t.email.recent(200).filter((m) => !beforeMailIds.has(m.id) && m.referenceCode.startsWith('REM-'));
    expect(newRemindMails.map((m) => m.to).sort()).toEqual([CAND_MAIL, HR_MAIL, STORE_MAIL].sort());

    const cronRes = await t.app.inject({ method: 'POST', url: '/api/internal/cron/interview-reminders', headers: { 'x-internal-token': t.ctx.env.INTERNAL_API_TOKEN } });
    expect(cronRes.statusCode).toBe(200);
    expect(cronRes.json().data.reminded).toBe(0);

    const evalExp = await t.app.inject({
      method: 'PUT', url: `/api/admin/interviews/${ivSoonId}/evaluate`, headers: hrH,
      payload: { version: 1, experience_track: 'EXPERIENCED', appearance_score: 80, attitude_score: 100, skill_score: 60, decision: 'PASS', comment: 'Tay nghề pha chế thực chiến tốt' },
    });
    expect(evalExp.statusCode).toBe(200);
    expect(evalExp.json().data).toMatchObject({ score: 77, experience_track: 'EXPERIENCED' });

    const otherPendingIv = t.db.interviews.find((iv) => iv.id !== ivSoonId && iv.decision === 'PENDING')!;
    const evalInexp = await t.app.inject({
      method: 'PUT', url: `/api/admin/interviews/${otherPendingIv.id}/evaluate`, headers: hrH,
      payload: { version: otherPendingIv.version, experience_track: 'INEXPERIENCED', appearance_score: 80, attitude_score: 100, skill_score: 60, decision: 'PASS', comment: 'Thái độ cầu tiến nổi bật' },
    });
    expect(evalInexp.statusCode).toBe(200);
    expect(evalInexp.json().data).toMatchObject({ score: 85, experience_track: 'INEXPERIENCED' });

    const filterExp = await t.app.inject({ method: 'GET', url: '/api/admin/interviews?experience_track=EXPERIENCED', headers: hrH });
    expect(filterExp.json().data.find((x: { id: string }) => x.id === ivSoonId)).toMatchObject({
      score: 77, experience_track: 'EXPERIENCED', experienceTrackLabel: 'Ứng viên đã có kinh nghiệm', experienceTrackShortLabel: 'Đã có kinh nghiệm',
    });
  });
});
