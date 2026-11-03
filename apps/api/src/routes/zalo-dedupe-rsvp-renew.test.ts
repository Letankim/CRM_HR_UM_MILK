import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRsvpToken, verifyRsvpToken } from '../services/candidate-form-scorer.js';
import { ensureInterviewRsvpUrl } from '../services/zalo-hr.service.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

let t: TestAppContext;
beforeAll(async () => { t = await buildTestApp('zalo_dedupe_rsvp'); });
afterAll(async () => { await t.app.close(); });

describe('Tài khoản Zalo không bị lưu trùng & tạo lại link xác nhận phỏng vấn hết hạn', () => {
  it('1. Lưu lại cùng số điện thoại Zalo chỉ cập nhật bản ghi cũ, giữ nguyên thông tin đăng nhập thật', async () => {
    const hr = await t.loginHeaders('hr');
    const payload = { zalo_name: 'HR Kim Ngân', zalo_phone: '0901555666', zalo_id: 'zalo_real_id', access_token: '{"imei":"abc"}', is_default: true };
    const first = await t.app.inject({ method: 'POST', url: '/api/admin/recruitment/zalo-accounts', headers: hr, payload });
    expect(first.statusCode).toBe(201);
    const second = await t.app.inject({ method: 'POST', url: '/api/admin/recruitment/zalo-accounts', headers: hr, payload: { ...payload, zalo_name: 'HR Kim Ngân (đã đổi tên)', zalo_id: '', access_token: 'zalo_qr_session_xyz' } });
    expect(second.statusCode).toBe(200);
    expect(second.json().data.id).toBe(first.json().data.id);
    const list = await t.app.inject({ method: 'GET', url: '/api/admin/recruitment/zalo-accounts', headers: hr });
    const same = (list.json().data.items as { zalo_phone: string; zalo_name: string; zalo_id: string }[]).filter((a) => a.zalo_phone === '0901555666');
    expect(same).toHaveLength(1);
    expect(same[0]).toMatchObject({ zalo_name: 'HR Kim Ngân (đã đổi tên)', zalo_id: 'zalo_real_id' });
  });

  it('2. Link xác nhận hết hạn được cấp mới tự động và HR có thể chủ động tạo link mới', async () => {
    const hr = await t.loginHeaders('hr');
    const candRes = await t.app.inject({ method: 'POST', url: '/api/admin/candidates', headers: hr, payload: { full_name: 'Đỗ Thu Link', phone: '0915777888', applied_position: 'BARISTA', applied_branch_id: t.db.branches.all()[0]!.id } });
    const ivRes = await t.app.inject({ method: 'POST', url: '/api/admin/interviews', headers: hr, payload: { candidate_id: candRes.json().data.id, interviewer_ids: ['hr'], scheduled_at: '2027-10-10T10:00:00+07:00', duration_minutes: 30 } });
    const ivId = ivRes.json().data.id as string;

    const expired = createRsvpToken({ interviewId: ivId }, -1);
    expect(verifyRsvpToken(expired)).toMatchObject({ valid: false, expired: true });
    const auto = ensureInterviewRsvpUrl(t.ctx, ivId, 'cand', expired);
    expect(auto.renewed).toBe(true);
    expect(verifyRsvpToken(auto.token).valid).toBe(true);
    const reused = ensureInterviewRsvpUrl(t.ctx, ivId, 'cand', auto.token);
    expect(reused).toMatchObject({ renewed: false, token: auto.token });

    const iv = t.db.interviews.get(ivId)!;
    await t.db.interviews.update(ivId, iv.version, { rsvp_token: expired }, 'test');
    const renew = await t.app.inject({ method: 'POST', url: `/api/admin/interviews/${ivId}/rsvp-link`, headers: hr, payload: {} });
    expect(renew.statusCode).toBe(200);
    const newUrl = renew.json().data.rsvp_url as string;
    const newToken = newUrl.split('/rsvp/')[1]!;
    expect(newToken).not.toBe(expired);
    expect(t.db.interviews.get(ivId)!.rsvp_token).toBe(newToken);
    const pub = await t.app.inject({ method: 'GET', url: `/api/public/rsvp/${newToken}` });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().data.candidate_name).toBe('Đỗ Thu Link');
  });
});
