import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PIN, SHIFT_DEFINITIONS } from '../data/memory-seed.js';
import { isPinRotationRequiredInWindow, parsePinHistory } from './auth.routes.js';
import { sweepExpiredNoShowInterviews, sweepUpcomingInterviewReminders, INTERVIEW_REMINDER_WINDOW_MINUTES } from '../services/interview-reminder.service.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

let t: TestAppContext;
const web = { 'x-umbm-client': 'web' };

beforeAll(async () => { t = await buildTestApp('p1_p2'); });
afterAll(async () => { await t.app.close(); });

describe('Giai đoạn 1 & 2: 6 Điểm GPS, 3 Ca Chuẩn, Xoay PIN, Google Form 26 Cột, AI Scorer 14đ, Rubric 13đ & RSVP 7 Ngày', () => {
  it('1. Khởi tạo đúng 6 địa điểm GPS (CN1..CN4, XUONG_SX 500m, VAN_PHONG 300m) và 3 khung ca chuẩn (5h - 6h - 5h)', () => {
    expect(SHIFT_DEFINITIONS).toEqual([
      { code: 'CA_SANG', name: 'Ca Sáng', start_time: '07:00', end_time: '12:00', standard_hours: 5 },
      { code: 'CA_CHIEU', name: 'Ca Chiều', start_time: '12:00', end_time: '18:00', standard_hours: 6 },
      { code: 'CA_TOI', name: 'Ca Tối', start_time: '18:00', end_time: '23:00', standard_hours: 5 },
    ]);
    const branches = t.db.branches.all();
    expect(branches.length).toBeGreaterThanOrEqual(6);
    const cn1 = branches.find((b) => b.code === 'CN01')!, xuong = branches.find((b) => b.code === 'XUONG_SX')!, vp = branches.find((b) => b.code === 'VAN_PHONG')!;
    expect(cn1).toMatchObject({ address: '130 Vạn Kiếp, P.3, Q.Bình Thạnh', lat: 10.79782, lng: 106.69345, radius_m: 300, max_accuracy_m: 150 });
    expect(xuong).toMatchObject({ id: 'br_xuong_sx', name: 'Xưởng Củ Chi', radius_m: 500, max_accuracy_m: 150 });
    expect(vp).toMatchObject({ id: 'br_van_phong', address: '10 Đặng Thai Mai, P.7, Q.Phú Nhuận', radius_m: 300, max_accuracy_m: 150 });
  });

  it('2. POST /api/auth/change-pin lưu lịch sử pin_history_json (tối đa 10 hash) và chặn dùng lại mã PIN cũ + kiểm tra cửa sổ ngày 01–05', async () => {
    const admin = await t.loginHeaders('admin');
    const created = await t.app.inject({
      method: 'POST', url: '/api/admin/accounts', headers: admin,
      payload: { username: 'nv.pin.hist', display_name: 'Trần Văn PIN History', phone_number: '0913111222', role: 'THU_VIEC', secret: '111222' },
    });
    expect(created.statusCode).toBe(201);
    const uid = created.json().data.user.id as string;
    await t.app.inject({ method: 'POST', url: '/api/admin/accounts/bulk-action', headers: admin, payload: { action: 'ACTIVATE', items: [{ id: uid, version: created.json().data.version }] } });

    const { cookie } = await t.login('0913111222', '111222', 'employee');
    const empHeaders = { ...web, cookie };
    const change1 = await t.app.inject({ method: 'POST', url: '/api/auth/change-pin', headers: empHeaders, payload: { current_pin: '111222', new_pin: '333444', confirm_pin: '333444' } });
    expect(change1.statusCode).toBe(200);
    const change2 = await t.app.inject({ method: 'POST', url: '/api/auth/change-pin', headers: empHeaders, payload: { current_pin: '333444', new_pin: '555666', confirm_pin: '555666' } });
    expect(change2.statusCode).toBe(200);

    const reuseOld = await t.app.inject({ method: 'POST', url: '/api/auth/change-pin', headers: empHeaders, payload: { current_pin: '555666', new_pin: '111222', confirm_pin: '111222' } });
    expect(reuseOld.statusCode).toBe(400);
    expect(reuseOld.json().errors.details[0].message).toContain('Mã PIN mới không được trùng với các mã PIN bạn đã từng sử dụng trước đây');
    expect(parsePinHistory(t.db.users.get(uid)!.pin_history_json)).toHaveLength(2);
    expect(isPinRotationRequiredInWindow({ must_change_pin: false, pin_changed_at: '2026-10-15T08:00:00+07:00' }, 30, '2026-11-03T09:00:00+07:00')).toMatchObject({ required: true, inDay01To05Window: true, reason: 'EXPIRED' });
    expect(DEMO_PIN).toBe('246810');
  });

  it('3. Đồng bộ Google Form 26 cột (AI Scorer 14đ + Red Flag), gắn VIP, chấm Rubric 13đ, gửi Zalo và xác nhận RSVP công khai', async () => {
    const hr = await t.loginHeaders('hr');
    const syncRes = await t.app.inject({
      method: 'POST', url: '/api/admin/candidates/sync-form', headers: hr,
      payload: {
        rows: [
          {
            'Tên Bạn là?': 'Nguyễn Ngọc Mai', 'Giới tính của bạn?': 'Nữ', 'Năm Sinh của bạn?': '2004', 'Trình độ học vấn': 'Sinh viên Đại học',
            'Quê Quán theo CCCD?': 'TP. Hồ Chí Minh', 'Số điện thoại của bạn (Số zalo để liên hệ)': '+84914222333',
            'Em có thể làm ca nào?': 'Xoay ca linh hoạt Sáng / Chiều', 'Chi nhánh em muốn ứng tuyển (CỐ ĐỊNH)?': '130 Vạn Kiếp, Bình Thạnh (CN1)',
            'Kinh nghiệm làm việc?': '1 năm pha chế trà sữa và thu ngân F&B', 'Nếu như ngày mai em có việc đột xuất trùng lịch ca trực...': 'Em sẽ báo trước cho Cửa hàng trưởng và nhờ đồng nghiệp đổi ca',
            'Em dự định gắn bó tối thiểu bao lâu?': '1 năm lâu dài', 'Gửi link Facebook cá nhân của bạn vào đây nhé!': 'https://facebook.com/ngocmai2004', 'Bạn biết tin ứng tuyển qua hình thức nào?': 'Fanpage Ụm Bò Milk',
          },
          { 'Tên Bạn là?': 'Trần Văn Vi Phạm', 'Năm Sinh của bạn?': '2003', 'Số điện thoại của bạn (Số zalo để liên hệ)': '0914222444', 'Nếu như ngày mai em có việc đột xuất trùng lịch ca trực...': 'Em tự ý nghỉ luôn không cần báo quản lý' },
        ],
      },
    });
    expect(syncRes.statusCode).toBe(201);
    const synced = syncRes.json().data;
    expect(synced).toMatchObject({ syncedCount: 2, qualifiedCount: 1, redFlagCount: 1 });
    const goodCand = synced.items.find((c: { phone: string }) => c.phone === '0914222333');
    const flaggedCand = synced.items.find((c: { phone: string }) => c.phone === '0914222444');
    expect(goodCand.ai_score_14).toBeGreaterThanOrEqual(12);
    expect(flaggedCand.status).toBe('REJECTED');

    const vipRes = await t.app.inject({ method: 'PUT', url: `/api/admin/candidates/${goodCand.id}/vip`, headers: hr, payload: { is_vip: true, vip_rank: 1 } });
    expect(vipRes.json().data).toMatchObject({ is_vip: true, vip_rank: 1 });

    const ivRes = await t.app.inject({ method: 'POST', url: '/api/admin/interviews', headers: hr, payload: { candidate_id: goodCand.id, interviewer_ids: ['hr'], scheduled_at: '2027-07-20T09:00:00+07:00', duration_minutes: 30 } });
    const ivId = ivRes.json().data.id as string;
    const zaloRes = await t.app.inject({ method: 'POST', url: `/api/admin/interviews/${ivId}/send-zalo`, headers: hr, payload: {} });
    const token = zaloRes.json().data.rsvp_token as string;
    expect(token.split('.')).toHaveLength(3);

    const getRsvp = await t.app.inject({ method: 'GET', url: `/api/public/rsvp/${token}` });
    expect(getRsvp.json().data.candidate_name).toBe('Nguyễn Ngọc Mai');
    const confirmRsvp = await t.app.inject({ method: 'POST', url: `/api/public/rsvp/${token}`, headers: web, payload: { action: 'CONFIRM' } });
    expect(confirmRsvp.json().data.status).toBe('CONFIRMED');
    // Sau khi đã xác nhận hoặc từ chối, khóa không cho thao tác lại trừ khi HR dời lịch hoặc gửi lại lịch
    const blockedRsvp = await t.app.inject({ method: 'POST', url: `/api/public/rsvp/${token}`, headers: web, payload: { action: 'RESCHEDULE', reason: 'Thử đổi lại ngay khi đã xác nhận' } });
    expect(blockedRsvp.statusCode).toBe(400);
    // HR gửi lại lời mời phỏng vấn qua Zalo -> mở khóa để ứng viên phản hồi lại
    await t.app.inject({ method: 'POST', url: `/api/admin/interviews/${ivId}/send-zalo`, headers: hr, payload: {} });
    const reschedRsvp = await t.app.inject({ method: 'POST', url: `/api/public/rsvp/${token}`, headers: web, payload: { action: 'RESCHEDULE', reason: 'Xin dời sang ca chiều vì bận thi học kỳ' } });
    expect(reschedRsvp.json().data.status).toBe('RESCHEDULE_NEEDED');

    const perfectScores = { s1_punctuality: 2, s2_grooming: 1, s3_voice_smile: 2, s4_shift_commitment: 2, s5_honesty_discipline: 2, s6_teamwork: 1, s7_fnb_operation: 1, s8_hygiene_safety: 1, s9_incident_handling: 1 };
    const decidePass = await t.app.inject({ method: 'POST', url: `/api/admin/interviews/${ivId}/decision`, headers: hr, payload: { rubric_block: 'STORE', rubric_scores: perfectScores, red_flags: [], create_employee: true, comment: 'Xuất sắc 13/13 điểm' } });
    expect(decidePass.json().data).toMatchObject({ decision: 'PASS', score_13: 13, isPerfect13: true });
    expect(decidePass.json().data.suggested_employee_code).toMatch(/^UBM_NV\d{6}$/);
    const ob = decidePass.json().data.onboarding;
    expect(ob).toMatchObject({ employee_code: decidePass.json().data.suggested_employee_code, user_status: 'ACTIVE', temporary_pin: '246810', probation_cycle_days: 12, probation_work_days: 7, probation_off_days: 5 });
    const createdEmp = t.db.employees.get(ob.employee_id)!;
    const createdUser = t.db.users.get(ob.user_id)!;
    expect(createdEmp).toMatchObject({ employee_code: ob.employee_code, stage: 'PROBATION', status: 'ACTIVE', probation_cycle_days: 12, permanent_address: 'TP. Hồ Chí Minh' });
    expect(createdUser).toMatchObject({ status: 'ACTIVE', role: 'THU_VIEC', must_change_pin: true, employee_id: ob.employee_code });
  });

  it('4. Tự động chuyển lịch phỏng vấn quá 30 phút chưa tham gia sang NO_SHOW và cửa sổ nhắc lịch 15 phút', async () => {
    expect(INTERVIEW_REMINDER_WINDOW_MINUTES).toBe(15);
    const hr = await t.loginHeaders('hr');
    const candRes = await t.app.inject({ method: 'POST', url: '/api/admin/candidates', headers: hr, payload: { full_name: 'Phạm Văn Vắng Mặt', phone: '0914999888', applied_position: 'BARISTA', applied_branch_id: t.db.branches.all()[0]!.id } });
    const candId = candRes.json().data.id as string;
    const ivRes = await t.app.inject({ method: 'POST', url: '/api/admin/interviews', headers: hr, payload: { candidate_id: candId, interviewer_ids: ['hr'], scheduled_at: '2027-08-10T09:00:00+07:00', duration_minutes: 30 } });
    const ivId = ivRes.json().data.id as string;
    const swept = await sweepExpiredNoShowInterviews(t.ctx, Date.parse('2027-08-10T09:35:00+07:00'));
    expect(swept).toBeGreaterThanOrEqual(1);
    expect(t.db.interviews.get(ivId)?.status).toBe('NO_SHOW');
  });

  it('5. Cấu hình tài khoản Zalo HR đăng nhập QR, nhắc lịch 5–15p & Đồng bộ Google Sheet Form chống trùng lặp 100%', async () => {
    const hr = await t.loginHeaders('hr');
    const qrRes = await t.app.inject({ method: 'POST', url: '/api/admin/recruitment/zalo-qr-session', headers: hr, payload: {} });
    expect(qrRes.statusCode).toBe(200);
    expect(qrRes.json().data.session_token).toContain('zalo_qr_session_');
    const accRes = await t.app.inject({
      method: 'POST', url: '/api/admin/recruitment/zalo-accounts', headers: hr,
      payload: { zalo_name: 'HR Ụm Bò Milk - Kim Ngân', zalo_phone: '0901222333', zalo_id: 'zalo_hr_ngan', access_token: qrRes.json().data.session_token, is_default: true },
    });
    expect(accRes.statusCode).toBe(201);
    const zaloAccId = accRes.json().data.id as string;
    const rawSetting = t.db.systemSettings.get(zaloAccId)!;
    expect(rawSetting.value.startsWith('enc:v1:')).toBe(true);
    expect(rawSetting.value).not.toContain('secret_cookie_token_xyz987');

    const candRes = await t.app.inject({ method: 'POST', url: '/api/admin/candidates', headers: hr, payload: { full_name: 'Lê Hoàng Thảo', phone: '0915888777', applied_position: 'BARISTA', applied_branch_id: t.db.branches.all()[0]!.id } });
    const candId = candRes.json().data.id as string;
    const ivRes = await t.app.inject({ method: 'POST', url: '/api/admin/interviews', headers: hr, payload: { candidate_id: candId, interviewer_ids: ['hr'], scheduled_at: '2027-09-10T10:00:00+07:00', duration_minutes: 30 } });
    const ivId = ivRes.json().data.id as string;

    const sendRes = await t.app.inject({ method: 'POST', url: '/api/admin/recruitment/zalo-send', headers: hr, payload: { candidate_id: candId, interview_id: ivId, zalo_account_id: zaloAccId, candidate_zalo_id: 'zalo_uv_0915888777', template_type: 'INVITE', mark_confirmed: true, mode: 'SEND' } });
    expect(sendRes.statusCode).toBe(200);
    expect(t.db.interviews.get(ivId)).toMatchObject({ zalo_account_id: zaloAccId, candidate_zalo_id: 'zalo_uv_0915888777', candidate_confirmed: true, status: 'CONFIRMED' });

    const reminded = await sweepUpcomingInterviewReminders(t.ctx, Date.parse('2027-09-10T09:50:00+07:00'));
    expect(reminded).toBeGreaterThanOrEqual(1);
    expect(Boolean(t.db.interviews.get(ivId)?.zalo_reminder_sent_at)).toBe(true);

    // Kiểm tra cấu hình Link Google Sheet Form & Đồng bộ chống trùng lặp
    const cfgRes = await t.app.inject({ method: 'PUT', url: '/api/admin/candidates/form-sync-config', headers: hr, payload: { sheet_url: 'https://docs.google.com/spreadsheets/d/1UMBM_FROM_NHAN_VIEN_FORM_2026/edit#gid=0', tab_name: 'FROM_NHAN_VIEN', hourly_auto_sync: true, sync_interval_minutes: 60 } });
    expect(cfgRes.statusCode).toBe(200);
    const sync1 = await t.app.inject({ method: 'POST', url: '/api/admin/candidates/sync-google-sheet', headers: hr, payload: {} });
    expect(sync1.statusCode).toBe(200);
    expect(sync1.json().data.newCount).toBe(4);
    const sync2 = await t.app.inject({ method: 'POST', url: '/api/admin/candidates/sync-google-sheet', headers: hr, payload: {} });
    expect(sync2.statusCode).toBe(200);
    expect(sync2.json().data).toMatchObject({ newCount: 0, skippedCount: 4 });
  });
});
