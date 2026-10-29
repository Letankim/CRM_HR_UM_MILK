import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';
import { isScheduledAnnouncementDue, parseScheduledAtEpochMs } from './announcement-scheduler.service.js';

let t: TestAppContext;
let mktHeaders: Record<string, string>;
let storeHeaders: Record<string, string>;

beforeAll(async () => {
  t = await buildTestApp('anc_sched');
  mktHeaders = await t.loginHeaders('mkt');
  storeHeaders = await t.loginHeaders('store1');
});

afterAll(async () => {
  await t.app.close();
});

describe('Announcement Scheduler (Tự động phát hành bản tin hẹn giờ chuẩn múi giờ Việt Nam +07:00)', () => {
  it('Xử lý đúng múi giờ Việt Nam (UTC+7) kể cả khi server chạy trên Render UTC', () => {
    const dueMs = parseScheduledAtEpochMs('2026-10-29 22:30');
    expect(dueMs).toBe(Date.parse('2026-10-29T15:30:00.000Z'));
    expect(isScheduledAnnouncementDue('2026-10-29 22:30', Date.parse('2026-10-29T15:29:59.000Z'))).toBe(false);
    expect(isScheduledAnnouncementDue('2026-10-29 22:30', Date.parse('2026-10-29T15:30:00.000Z'))).toBe(true);
    expect(isScheduledAnnouncementDue('2026-10-29 22:30', Date.parse('2026-10-29T15:31:58.000Z'))).toBe(true);
  });

  it('Tự động chuyển bản tin SCHEDULED đã đến hạn sang SENT, sinh Notification + Delivery Log và giải mã Media đính kèm', async () => {
    const mediaRes = await t.app.inject({
      method: 'POST',
      url: '/api/mkt/media',
      headers: mktHeaders,
      payload: {
        file_name: 'poster-chien-dich-cuoi-thang-10.png',
        mime_type: 'image/png',
        size_bytes: 245000,
        drive_url: 'https://cdn.example.com/poster-t10.png',
        category: 'BANNER',
        is_internal_only: true,
      },
    });
    expect(mediaRes.statusCode).toBe(201);
    const mediaId = (mediaRes.json().data as { id: string }).id;

    // 1. Bản tin hẹn giờ trong tương lai xa phải giữ nguyên SCHEDULED
    const futureRes = await t.app.inject({
      method: 'POST',
      url: '/api/mkt/announcements',
      headers: mktHeaders,
      payload: {
        title: 'Chiến dịch tương lai 2099',
        summary: 'Chưa đến giờ phát',
        body_md: '<p>Nội dung tương lai</p>',
        status: 'SCHEDULED',
        scheduled_at: '2099-12-31 22:30',
        audience_scope: 'STAFF_GROUP',
        audience_target: 'STORE_MANAGER',
        media_ids: mediaId,
      },
    });
    expect(futureRes.statusCode).toBe(201);
    const futureAnc = futureRes.json().data as { id: string; status: string };
    expect(futureAnc.status).toBe('SCHEDULED');

    // 2. Giả lập bản tin đang ở trạng thái SCHEDULED trong DB và đồng hồ đã vượt qua 22:30
    const mktUser = t.db.users.find((u) => u.username === 'mkt')!;
    const dueAnc = await t.db.announcements.insert({
      code: 'ANC-9903',
      campaign_id: '',
      title: 'Chiến dịch cuối tháng 10',
      summary: 'Chiến dịch cuối tháng 10',
      body: '<p>Chiến dịch cuối tháng 10</p>',
      cta_label: 'Xem ngay',
      cta_link: '/admin/integrations?section=comms',
      media_ids: mediaId,
      audience_scope: 'STAFF_GROUP',
      audience_json: JSON.stringify({ scope: 'STAFF_GROUP', target: 'STORE_MANAGER' }),
      priority: 'HIGH',
      requires_ack: false,
      scheduled_at: '2026-10-29 22:30',
      sent_at: '',
      status: 'SCHEDULED',
      approved_by: mktUser.display_name,
    }, mktUser.id);

    // Gọi GET /api/admin/comms -> tự động quét và phát hành ngay bản tin đã quá 22:30
    const commsRes = await t.app.inject({ method: 'GET', url: '/api/admin/comms', headers: mktHeaders });
    expect(commsRes.statusCode).toBe(200);
    const ancs = commsRes.json().data.announcements as Array<{
      id: string; status: string; sent_at: string; mediaAttachments: Array<{ file_name: string; mimeLabel: string }>;
    }>;
    const published = ancs.find((a) => a.id === dueAnc.id)!;
    expect(published.status).toBe('SENT');
    expect(published.sent_at).toBeTruthy();
    expect(published.mediaAttachments).toHaveLength(1);
    expect(published.mediaAttachments[0]?.file_name).toBe('poster-chien-dich-cuoi-thang-10.png');

    // Quản lý cửa hàng nhận được ngay thông báo kèm mediaAttachments
    const storeNotifRes = await t.app.inject({ method: 'GET', url: '/api/notifications', headers: storeHeaders });
    expect(storeNotifRes.statusCode).toBe(200);
    const notifs = storeNotifRes.json().data as Array<{ code: string; title: string; mediaAttachments?: Array<{ file_name: string }> }>;
    const matchedNotif = notifs.find((n) => n.code === 'ANC-9903');
    expect(matchedNotif).toBeDefined();
    expect(matchedNotif?.mediaAttachments?.[0]?.file_name).toBe('poster-chien-dich-cuoi-thang-10.png');

    // Quét lần 2 qua endpoint cron không phát trùng (idempotent = 0)
    const cronRes = await t.app.inject({
      method: 'POST',
      url: '/api/internal/cron/publish-announcements',
      headers: { 'x-internal-token': `${'anc_sched'.repeat(40)}i` },
    });
    expect(cronRes.statusCode).toBe(200);
    expect(cronRes.json().data.publishedAnnouncements).toBe(0);
    expect(t.db.announcements.get(futureAnc.id)?.status).toBe('SCHEDULED');
  });
});
