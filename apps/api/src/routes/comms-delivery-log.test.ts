import { describe, expect, it } from 'vitest';
import { buildTestApp } from '../test-utils/build-test-app.js';
import { enrichDeliveryLog } from '../services/comms-delivery-log-helper.js';

describe('Xử lý nhật ký gửi thông báo (Delivery Logs) & Làm sạch JSON Metadata', () => {
  it('1. enrichDeliveryLog bóc tách đúng recipientName và không làm rò rỉ JSON metadata từ ack_at', async () => {
    const { ctx } = await buildTestApp('dlv1');
    const mockJsonMeta = JSON.stringify({
      recipientName: 'Đặng Văn Chính',
      subject: 'Thông báo nội bộ tháng 11',
      summary: 'Quy chuẩn an toàn vệ sinh mới',
    });

    const enriched = enrichDeliveryLog(ctx, {
      id: 'log_test_01',
      version: 1,
      announcement_id: 'INTERNAL_ANNOUNCEMENT:ANC-202611-001',
      recipient_user_id: 'dangvanchinh@gmail.com',
      channel: 'EMAIL',
      status: 'SENT',
      attempts: 1,
      last_error: '',
      branch_id: 'ALL',
      sent_at: '2026-11-05T08:00:00.000Z',
      delivered_at: '2026-11-05T08:01:00.000Z',
      read_at: '',
      ack_at: mockJsonMeta,
      created_at: '2026-11-05T08:00:00.000Z',
      updated_at: '2026-11-05T08:01:00.000Z',
      created_by: 'system',
      updated_by: 'system',
      is_deleted: false,
    });

    expect(enriched.recipientName).toBe('Đặng Văn Chính');
    expect(enriched.ack_at).toBe('');
    expect(enriched.readReceiptStatus).toBe('NO_RECEIPT');
    expect(enriched.readReceiptLabel).toBe('Chưa xác nhận đọc');
    expect(enriched.announcementCode).toBe('ANC-202611-001');
  });

  it('2. API /api/mkt/comms trả về danh sách deliveryLogs đã được chuẩn hóa tên và trạng thái đọc', async () => {
    const { app, db, loginHeaders } = await buildTestApp('dlv2');
    const mktHeaders = await loginHeaders('mkt');

    // Chèn 1 log có chứa metadata JSON vào deliveryLogs
    await db.deliveryLogs.insert({
      announcement_id: 'INTERNAL_ANNOUNCEMENT:ANC-TEST',
      recipient_user_id: 'nhanvien.test@umbomilk.vn',
      channel: 'EMAIL',
      status: 'SENT',
      attempts: 1,
      last_error: '',
      branch_id: 'ALL',
      sent_at: '2026-11-05T08:00:00.000Z',
      delivered_at: '2026-11-05T08:01:00.000Z',
      read_at: '',
      ack_at: JSON.stringify({ recipientName: 'Nguyễn Thị Thử Nghiệm' }),
    }, 'mkt');

    const res = await app.inject({
      method: 'GET',
      url: '/api/mkt/comms',
      headers: mktHeaders,
    });
    expect(res.statusCode).toBe(200);
    const logs = res.json().data.deliveryLogs as Array<Record<string, unknown>>;
    const testLog = logs.find((l) => l.recipient_user_id === 'nhanvien.test@umbomilk.vn');
    expect(testLog).toBeTruthy();
    expect(testLog!.recipientName).toBe('Nguyễn Thị Thử Nghiệm');
    expect(testLog!.ack_at).toBe('');
    expect(testLog!.readReceiptLabel).toBe('Chưa xác nhận đọc');
  });
});
