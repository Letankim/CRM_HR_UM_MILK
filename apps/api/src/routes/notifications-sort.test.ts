import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PIN } from '../data/memory-seed.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

let t: TestAppContext;
let adminHeaders: Record<string, string>;
let nv1Headers: Record<string, string>;
let nv1UserId = '';

beforeAll(async () => {
  t = await buildTestApp('notif_sort');
  adminHeaders = await t.loginHeaders('admin');
  const nv1User = t.db.users.find((u) => u.phone === '0901000001')!;
  nv1UserId = nv1User.id;
  nv1Headers = { cookie: (await t.login('0901000001', DEMO_PIN, 'employee')).cookie, 'x-umbm-client': 'web' };
});

afterAll(async () => {
  await t.app.close();
});

describe('Sắp xếp Thông báo chuẩn xác: Mới nhất trước (desc) & Cũ nhất trước (asc)', () => {
  it('Hiển thị đúng thông báo mới nhất ở đầu danh sách (sort_order=desc / mặc định) và cũ nhất ở đầu khi chọn Cũ nhất trước (sort_order=asc), kể cả khác múi giờ +07:00 / Z và cùng giây', async () => {
    const adminUser = t.db.users.find((u) => u.username === 'admin')!;

    // 1. Chèn 4 thông báo theo trình tự thời gian rõ ràng (gồm cả định dạng +07:00, UTC Z và 2 thông báo cùng giây)
    await t.db.notifications.insert({
      created_at: '2026-10-28T08:00:00+07:00',
      recipient_user_id: nv1UserId, recipient_role: '', branch_id: 'ALL',
      category: 'SYSTEM', severity: 'INFO', title: 'Thông báo thứ 1 (Cũ nhất ngày 28/10)',
      body: 'Nội dung thông báo số 1 phát lúc 08:00 sáng 28/10.', link: '/nv/thong-bao', read_at: '', entity_type: 'MANUAL', entity_id: '',
    }, adminUser.id);

    // 2026-10-29T03:00:00.000Z tương đương 10:00:00+07:00 ngày 29/10 (mới hơn thông báo 1, cũ hơn thông báo 3)
    await t.db.notifications.insert({
      created_at: '2026-10-29T03:00:00.000Z',
      recipient_user_id: nv1UserId, recipient_role: '', branch_id: 'ALL',
      category: 'WORKFLOW', severity: 'INFO', title: 'Thông báo thứ 2 (Chuẩn UTC Z 10:00 29/10)',
      body: 'Nội dung thông báo số 2 định dạng UTC Z.', link: '/nv/thong-bao', read_at: '', entity_type: 'MANUAL', entity_id: '',
    }, adminUser.id);

    await t.db.notifications.insert({
      created_at: '2026-10-29T14:30:00+07:00',
      recipient_user_id: nv1UserId, recipient_role: '', branch_id: 'ALL',
      category: 'PAYROLL', severity: 'WARNING', title: 'Thông báo thứ 3 (Cùng giây 14:30 - Tạo trước)',
      body: 'Nội dung thông báo số 3 phát lúc 14:30.', link: '/nv/thong-bao', read_at: '', entity_type: 'MANUAL', entity_id: '',
    }, adminUser.id);

    await t.db.notifications.insert({
      created_at: '2026-10-29T14:30:00+07:00',
      recipient_user_id: nv1UserId, recipient_role: '', branch_id: 'ALL',
      category: 'PAYROLL', severity: 'CRITICAL', title: 'Thông báo thứ 4 (Mới nhất 14:30 - Tạo sau)',
      body: 'Nội dung thông báo số 4 phát sau cùng lúc 14:30.', link: '/nv/thong-bao', read_at: '', entity_type: 'MANUAL', entity_id: '',
    }, adminUser.id);

    // 2. Chèn thêm 1 bản tin cũ từ 27/10 đồng bộ sau để đảm bảo bản ghi cũ đồng bộ muộn không nhảy lên trên thông báo mới
    await t.db.announcements.insert({
      created_at: '2026-10-27T09:15:00+07:00',
      code: 'ANN-OLD-2710', campaign_id: '', title: 'Bản tin lịch sử ngày 27/10',
      summary: 'Bản tin cũ từ ngày 27/10', body: 'Nội dung bản tin ngày 27/10.',
      cta_label: '', cta_link: '/nv/ban-tin', media_ids: '[]', audience_scope: 'ALL', audience_json: '{"scope":"ALL"}',
      priority: 'NORMAL', status: 'SENT', requires_ack: false, scheduled_at: '2026-10-27T09:15:00+07:00',
      sent_at: '2026-10-27T09:15:00+07:00', approved_by: 'mkt',
    }, adminUser.id);

    // 3. Kiểm tra mặc định & sort_order=desc ("Mới nhất trước") — áp dụng cho cả Chuông Header và Trung tâm Thông báo
    const descRes = await t.app.inject({
      method: 'GET',
      url: '/api/notifications?per_page=50&sort_by=created_at&sort_order=desc',
      headers: nv1Headers,
    });
    expect(descRes.statusCode).toBe(200);
    const descItems = descRes.json().data as { title: string; created_at: string; code: string }[];
    const trackedTitles = [
      'Thông báo thứ 4 (Mới nhất 14:30 - Tạo sau)',
      'Thông báo thứ 3 (Cùng giây 14:30 - Tạo trước)',
      'Thông báo thứ 2 (Chuẩn UTC Z 10:00 29/10)',
      'Thông báo thứ 1 (Cũ nhất ngày 28/10)',
      'Bản tin lịch sử ngày 27/10',
    ];
    const descFiltered = descItems.filter((i) => trackedTitles.includes(i.title)).map((i) => i.title);
    expect(descFiltered).toEqual(trackedTitles);

    // Kiểm tra Chuông Header (GET /api/notifications?per_page=12 không truyền sort_order -> mặc định desc, phần tử đầu tiên mới nhất)
    const bellRes = await t.app.inject({ method: 'GET', url: '/api/notifications?per_page=12', headers: nv1Headers });
    expect(bellRes.statusCode).toBe(200);
    const bellItems = bellRes.json().data as { title: string; created_at: string }[];
    for (let i = 0; i < bellItems.length - 1; i++) {
      expect(Date.parse(bellItems[i]!.created_at)).toBeGreaterThanOrEqual(Date.parse(bellItems[i + 1]!.created_at));
    }

    // 4. Kiểm tra sort_order=asc ("Cũ nhất trước") -> Đảo ngược chính xác từ cũ nhất đến mới nhất
    const ascRes = await t.app.inject({
      method: 'GET',
      url: '/api/notifications?per_page=50&sort_by=created_at&sort_order=asc',
      headers: nv1Headers,
    });
    expect(ascRes.statusCode).toBe(200);
    const ascItems = ascRes.json().data as { title: string; created_at: string }[];
    const ascFiltered = ascItems.filter((i) => trackedTitles.includes(i.title)).map((i) => i.title);
    expect(ascFiltered).toEqual([...trackedTitles].reverse());
    for (let i = 0; i < ascItems.length - 1; i++) {
      expect(Date.parse(ascItems[i]!.created_at)).toBeLessThanOrEqual(Date.parse(ascItems[i + 1]!.created_at));
    }

    // 5. Khi Admin vừa phát thông báo mới tức thì qua POST /api/notifications -> Hiện ngay ở vị trí số 0 (trên cùng)
    const liveSend = await t.app.inject({
      method: 'POST', url: '/api/notifications', headers: adminHeaders,
      payload: {
        title: 'Thông báo khẩn mới phát tức thì lên đầu bảng',
        body: 'Kiểm tra thông báo vừa gửi phải nằm ngay dòng đầu tiên.',
        category: 'SYSTEM', severity: 'CRITICAL', target_scope: 'USER', recipient_user_ids: [nv1UserId],
      },
    });
    expect(liveSend.statusCode).toBe(201);

    const afterSendRes = await t.app.inject({ method: 'GET', url: '/api/notifications?per_page=12', headers: nv1Headers });
    expect(afterSendRes.json().data[0].title).toBe('Thông báo khẩn mới phát tức thì lên đầu bảng');
  });
});
