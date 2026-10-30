import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../data/database.js';
import { DEMO_PIN } from '../data/memory-seed.js';
import { dayjs } from '../lib/time.js';
import { getVnNowDateAndHm } from '../services/shift-absent-scanner.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

let t: TestAppContext, app: TestAppContext['app'], db: Database;
const loginHeaders = (username: string) => t.loginHeaders(username);
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

beforeAll(async () => { t = await buildTestApp('audit10'); app = t.app; db = t.db; });
afterAll(async () => { await app.close(); });

describe('Audit 10 Business Fixes (MKT, HR, Schedules, Staffing, Attendance 1h Grace, Policies)', () => {
  it('1 & 2. MKT Media & Campaign delete support cascade checkbox and never leak deleted media', async () => {
    const headers = await loginHeaders('mkt');

    const m1 = (await app.inject({ method: 'POST', url: '/api/mkt/media', headers, payload: { file_name: 'banner-a.png', mime_type: 'image/png', file_base64: TINY_PNG, category: 'BANNER' } })).json().data;
    const m2 = (await app.inject({ method: 'POST', url: '/api/mkt/media', headers, payload: { file_name: 'banner-b.png', mime_type: 'image/png', file_base64: TINY_PNG, category: 'BANNER' } })).json().data;
    const c1 = (await app.inject({ method: 'POST', url: '/api/mkt/campaigns', headers, payload: { name: 'Chiến dịch Mùa Thu A', status: 'ACTIVE' } })).json().data;
    const c2 = (await app.inject({ method: 'POST', url: '/api/mkt/campaigns', headers, payload: { name: 'Chiến dịch Mùa Đông B', status: 'ACTIVE' } })).json().data;

    const anc1 = (await app.inject({ method: 'POST', url: '/api/mkt/announcements', headers, payload: { title: 'Bản tin gắn Media A & Camp A', summary: 'Tóm tắt A', body_md: '<p>Nội dung A</p>', campaign_id: c1.id, media_ids: JSON.stringify([m1.id]), publish_now: true } })).json().data;
    const anc2 = (await app.inject({ method: 'POST', url: '/api/mkt/announcements', headers, payload: { title: 'Bản tin gắn Media B', summary: 'Tóm tắt B', body_md: '<p>Nội dung B</p>', media_ids: JSON.stringify([m2.id]), publish_now: true } })).json().data;
    const anc3 = (await app.inject({ method: 'POST', url: '/api/mkt/announcements', headers, payload: { title: 'Bản tin thuộc Camp B', summary: 'Tóm tắt C', body_md: '<p>Nội dung C</p>', campaign_id: c2.id, publish_now: true } })).json().data;

    // Delete m1 WITHOUT cascade -> anc1 stays, mediaAttachments becomes [], file endpoint returns 404
    const delM1 = await app.inject({ method: 'DELETE', url: `/api/mkt/media/${m1.id}`, headers, payload: { version: m1.version, delete_related: false } });
    expect(delM1.statusCode).toBe(200);
    const fileRes = await app.inject({ method: 'GET', url: `/api/mkt/media/files/${m1.id}` });
    expect(fileRes.statusCode).toBe(404);

    const commsAfterM1 = (await app.inject({ method: 'GET', url: '/api/announcements', headers })).json().data;
    const foundAnc1 = commsAfterM1.announcements.find((a: { id: string }) => a.id === anc1.id);
    expect(foundAnc1).toBeTruthy();
    expect(foundAnc1.mediaAttachments).toEqual([]);

    // Delete m2 WITH cascade -> anc2 is also soft-deleted
    const delM2 = await app.inject({ method: 'DELETE', url: `/api/mkt/media/${m2.id}`, headers, payload: { version: m2.version, delete_related: true } });
    expect(delM2.statusCode).toBe(200);
    expect(db.announcements.get(anc2.id)).toBeUndefined();

    // Delete c1 WITHOUT cascade -> anc1 remains and unlinks campaign_id
    const freshAnc1 = db.announcements.get(anc1.id)!;
    expect(freshAnc1.campaign_id).toBe(c1.id);
    const delC1 = await app.inject({ method: 'DELETE', url: `/api/mkt/campaigns/${c1.id}`, headers, payload: { version: c1.version, delete_related: false } });
    expect(delC1.statusCode).toBe(200);
    expect(db.announcements.get(anc1.id)?.campaign_id).toBe('');

    // Delete c2 WITH cascade -> anc3 is also soft-deleted
    const delC2 = await app.inject({ method: 'DELETE', url: `/api/mkt/campaigns/${c2.id}`, headers, payload: { version: c2.version, delete_related: true } });
    expect(delC2.statusCode).toBe(200);
    expect(db.announcements.get(anc3.id)).toBeUndefined();
  });

  it('3, 4 & 8. HR Interview recalculates score, Employees supports per_page=200 search, Policies never emit undefined value', async () => {
    const hrHeaders = await loginHeaders('hr');
    const iv = db.interviews.all()[0]!;
    const eval1 = await app.inject({
      method: 'PUT', url: `/api/admin/interviews/${iv.id}/evaluate`, headers: hrHeaders,
      payload: { version: iv.version, appearance_score: 6, attitude_score: 6, skill_score: 6, score: 6, decision: 'HOLD', comment: 'Đánh giá lần 1' },
    });
    expect(eval1.statusCode).toBe(200);
    expect(eval1.json().data.score).toBe(6);

    // Send updated component scores with stale score: 6 -> backend must recalculate 9.3
    const eval2 = await app.inject({
      method: 'PUT', url: `/api/admin/interviews/${iv.id}/evaluate`, headers: hrHeaders,
      payload: { version: eval1.json().data.version, appearance_score: 9, attitude_score: 9, skill_score: 10, score: 6, decision: 'HOLD', comment: 'Cập nhật điểm HR' },
    });
    expect(eval2.statusCode).toBe(200);
    expect(eval2.json().data.score).toBe(9.3);

    const empSearch = await app.inject({ method: 'GET', url: '/api/admin/employees?per_page=200&q=NV', headers: hrHeaders });
    expect(empSearch.statusCode).toBe(200);
    expect(empSearch.json().meta.pagination.per_page).toBe(200);

    const comms = (await app.inject({ method: 'GET', url: '/api/announcements', headers: hrHeaders })).json().data;
    for (const pol of comms.policies) { expect(pol.value).toBeDefined(); expect(String(pol.value)).not.toBe('undefined'); }
  });

  it('5A, 5B & 5C. Schedules forbid editing approved shifts, lock employee_id on edit, and block duplicate/overlapping shifts', async () => {
    const hrHeaders = await loginHeaders('hr');
    const [emp1, emp2] = db.employees.all();
    expect(emp1 && emp2).toBeTruthy();

    const s1Res = await app.inject({
      method: 'POST', url: '/api/admin/schedules', headers: hrHeaders,
      payload: { employee_id: emp1!.id, work_date: '2026-12-10', shift_code: 'CA_SANG', status: 'DRAFT', day_type: 'WORK' },
    });
    expect(s1Res.statusCode).toBe(201);
    const s1 = s1Res.json().data;

    // 5C: Duplicate employee + shift on same date is rejected
    const dupRes = await app.inject({
      method: 'POST', url: '/api/admin/schedules', headers: hrHeaders,
      payload: { employee_id: emp1!.id, work_date: '2026-12-10', shift_code: 'CA_SANG', status: 'PUBLISHED', day_type: 'WORK' },
    });
    expect(dupRes.statusCode).toBe(400);

    // 5B: Changing employee_id during edit is rejected
    const changeEmpRes = await app.inject({
      method: 'PUT', url: `/api/admin/schedules/${s1.id}`, headers: hrHeaders,
      payload: { version: s1.version, employee_id: emp2!.id, note: 'Đổi người trái phép' },
    });
    expect(changeEmpRes.statusCode).toBe(400);

    // 5B/5C: Create CA_CHIEU DRAFT for emp1, then try editing CA_CHIEU into CA_SANG -> rejected
    const s2 = (await app.inject({
      method: 'POST', url: '/api/admin/schedules', headers: hrHeaders,
      payload: { employee_id: emp1!.id, work_date: '2026-12-10', shift_code: 'CA_CHIEU', status: 'DRAFT', day_type: 'WORK' },
    })).json().data;
    const overlapEdit = await app.inject({
      method: 'PUT', url: `/api/admin/schedules/${s2.id}`, headers: hrHeaders,
      payload: { version: s2.version, shift_code: 'CA_SANG' },
    });
    expect(overlapEdit.statusCode).toBe(400);

    // Approve s1 (DRAFT -> PUBLISHED) succeeds
    const approveRes = await app.inject({
      method: 'PUT', url: `/api/admin/schedules/${s1.id}`, headers: hrHeaders,
      payload: { version: s1.version, status: 'PUBLISHED' },
    });
    expect(approveRes.statusCode).toBe(200);
    const approvedS1 = approveRes.json().data;

    // 5A: Editing an already-approved (PUBLISHED) shift is forbidden; only DELETE is allowed
    const editApprovedRes = await app.inject({
      method: 'PUT', url: `/api/admin/schedules/${approvedS1.id}`, headers: hrHeaders,
      payload: { version: approvedS1.version, note: 'Sửa ca đã duyệt' },
    });
    expect(editApprovedRes.statusCode).toBe(400);

    const delApprovedRes = await app.inject({
      method: 'DELETE', url: `/api/admin/schedules/${approvedS1.id}`, headers: hrHeaders,
      payload: { version: approvedS1.version },
    });
    expect(delApprovedRes.statusCode).toBe(200);
  });

  it('7 & 10. Shift registration blocks when branch max_staff is reached, and Check-out allows 1h grace after end_at', async () => {
    const adminHeaders = await loginHeaders('admin');
    const empUser = db.users.find((u) => u.status === 'ACTIVE' && (u.role === 'CHINH_THUC' || u.role === 'THU_VIEC'))!;
    const nvLogin = await t.login(empUser.phone || empUser.username, DEMO_PIN, 'employee');
    const nvHeaders = { cookie: nvLogin.cookie, 'x-umbm-client': 'web' };
    const myData = (await app.inject({ method: 'GET', url: '/api/my-attendance', headers: nvHeaders })).json().data;
    const nvEmp = db.employees.get(myData.profile.employeeId)!;
    const peerEmp = db.employees.find((e) => e.id !== nvEmp.id && e.branch_id === nvEmp.branch_id) ?? db.employees.find((e) => e.id !== nvEmp.id)!;

    // Set strict max_staff = 1 rule for nvEmp's branch on CA_TOI via API
    const createRuleRes = await app.inject({
      method: 'POST', url: '/api/admin/staffing-rules', headers: adminHeaders,
      payload: { branch_id: nvEmp.branch_id, shift_template_id: 'CA_TOI', min_staff: 1, max_staff: 1 },
    });
    expect(createRuleRes.statusCode).toBe(201);
    const futureDate = dayjs(getVnNowDateAndHm().todayStr).add(10, 'day').format('YYYY-MM-DD');
    await db.shiftAssignments.insert({
      schedule_week_id: `WK-${futureDate.slice(0, 7)}`, employee_id: peerEmp.id, branch_id: nvEmp.branch_id,
      work_date: futureDate, shift_template_id: '', start_at: '17:00', end_at: '22:00', status: 'PUBLISHED',
      source: 'HR_ASSIGN', employee_stage: peerEmp.stage, day_type: 'WORK', shift_code: 'CA_TOI', scheduled_hours: 5,
      swapped_from_employee_id: '', replacement_for_employee_id: '', published_at: '', note: '',
    }, 'admin');

    const availRes = await app.inject({ method: 'GET', url: `/api/my-attendance/shift-availability?work_date=${futureDate}&shift_code=CA_TOI`, headers: nvHeaders });
    expect(availRes.statusCode).toBe(200);
    expect(availRes.json().data.isFullOrExceeded).toBe(true);
    expect(availRes.json().data.canRegister).toBe(false);

    const regBlocked = await app.inject({ method: 'POST', url: '/api/my-attendance/shifts', headers: nvHeaders, payload: { work_date: futureDate, shift_code: 'CA_TOI', note: 'Đăng ký vượt định biên' } });
    expect(regBlocked.statusCode).toBe(400);

    // Item 7: 1-hour Check-out grace window test
    const { todayStr, nowHm } = getVnNowDateAndHm();
    const nowDt = dayjs(`${todayStr}T${nowHm}:00`);
    const branch = db.branches.get(nvEmp.branch_id) ?? db.branches.all()[0]!;

    // Shift A ended 25 minutes ago (within 60m grace) -> CHECK_OUT must SUCCEED
    const endA = nowDt.subtract(25, 'minute'), startA = endA.subtract(4, 'hour');
    const shiftA = await db.shiftAssignments.insert({
      schedule_week_id: 'WK-GRACE', employee_id: nvEmp.id, branch_id: branch.id, work_date: startA.format('YYYY-MM-DD'),
      shift_template_id: '', start_at: startA.format('HH:mm'), end_at: endA.format('HH:mm'), status: 'PUBLISHED',
      source: 'HR_ASSIGN', employee_stage: nvEmp.stage, day_type: 'WORK', shift_code: 'CA_LINH_HOAT_A', scheduled_hours: 4,
      swapped_from_employee_id: '', replacement_for_employee_id: '', published_at: '', note: '',
    }, 'admin');
    await app.inject({
      method: 'POST', url: '/api/attendance/check', headers: nvHeaders,
      payload: { assignment_id: shiftA.id, kind: 'CHECK_IN', lat: branch.lat, lng: branch.lng, accuracy_m: 10, selfie_source: 'LIVE_CAMERA', photo_base64: TINY_PNG, enforce_shift_state: false },
    });

    const outOk = await app.inject({
      method: 'POST', url: '/api/attendance/check', headers: nvHeaders,
      payload: { assignment_id: shiftA.id, kind: 'CHECK_OUT', lat: branch.lat, lng: branch.lng, accuracy_m: 10, selfie_source: 'LIVE_CAMERA', photo_base64: TINY_PNG, enforce_shift_state: true },
    });
    expect(outOk.statusCode).toBe(201);

    // Shift B ended 85 minutes ago (> 60m grace) -> CHECK_OUT must be LOCKED (400)
    const endB = nowDt.subtract(85, 'minute'), startB = endB.subtract(4, 'hour');
    const shiftB = await db.shiftAssignments.insert({
      schedule_week_id: 'WK-GRACE', employee_id: nvEmp.id, branch_id: branch.id, work_date: startB.format('YYYY-MM-DD'),
      shift_template_id: '', start_at: startB.format('HH:mm'), end_at: endB.format('HH:mm'), status: 'PUBLISHED',
      source: 'HR_ASSIGN', employee_stage: nvEmp.stage, day_type: 'WORK', shift_code: 'CA_LINH_HOAT_B', scheduled_hours: 4,
      swapped_from_employee_id: '', replacement_for_employee_id: '', published_at: '', note: '',
    }, 'admin');
    await app.inject({
      method: 'POST', url: '/api/attendance/check', headers: nvHeaders,
      payload: { assignment_id: shiftB.id, kind: 'CHECK_IN', lat: branch.lat, lng: branch.lng, accuracy_m: 10, selfie_source: 'LIVE_CAMERA', photo_base64: TINY_PNG, enforce_shift_state: false },
    });

    const outLocked = await app.inject({
      method: 'POST', url: '/api/attendance/check', headers: nvHeaders,
      payload: { assignment_id: shiftB.id, kind: 'CHECK_OUT', lat: branch.lat, lng: branch.lng, accuracy_m: 10, selfie_source: 'LIVE_CAMERA', photo_base64: TINY_PNG, enforce_shift_state: true },
    });
    expect(outLocked.statusCode).toBe(400);
  });
});
