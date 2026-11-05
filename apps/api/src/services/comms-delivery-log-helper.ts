import type { DeliveryLog } from '@umbm/shared';
import type { AppContext } from '../context.js';

export interface EnrichedDeliveryLog extends DeliveryLog {
  announcementCode: string;
  announcementTitle: string;
  recipientName: string;
  readReceiptStatus: 'READ_CONFIRMED' | 'NO_RECEIPT';
  readReceiptLabel: string;
}

export function enrichDeliveryLog(ctx: AppContext, log: DeliveryLog): EnrichedDeliveryLog {
  let anc = ctx.db.announcements.get(log.announcement_id);
  let refCode = '';
  if (!anc && log.announcement_id.includes(':')) {
    const parts = log.announcement_id.split(':');
    refCode = parts.slice(1).join(':');
    anc = ctx.db.announcements.find((a) => a.code === refCode || a.id === refCode);
  }

  let savedRecipientName = '';
  const isMetaJson = Boolean(log.ack_at && log.ack_at.trim().startsWith('{'));
  if (isMetaJson) {
    try {
      const parsed = JSON.parse(log.ack_at);
      if (parsed.recipientName) savedRecipientName = String(parsed.recipientName).trim();
    } catch {
      // Bỏ qua lỗi parse JSON metadata
    }
  }

  const cleanRecipientId = (log.recipient_user_id || '').trim();
  const cleanRecipientLower = cleanRecipientId.toLowerCase();

  let recUser = ctx.db.users.get(cleanRecipientId);
  if (!recUser) {
    recUser = ctx.db.users.find(
      (u) =>
        u.id === cleanRecipientId ||
        u.email.trim().toLowerCase() === cleanRecipientLower ||
        u.username.trim().toLowerCase() === cleanRecipientLower ||
        (Boolean(u.employee_id) && u.employee_id.toLowerCase() === cleanRecipientLower),
    );
  }

  let recEmp = recUser?.employee_id
    ? ctx.db.employees.find((e) => e.employee_code === recUser.employee_id || e.id === recUser.employee_id)
    : undefined;
  if (!recEmp) {
    recEmp = ctx.db.employees.find(
      (e) =>
        e.id === cleanRecipientId ||
        e.employee_code.toLowerCase() === cleanRecipientLower ||
        e.email.trim().toLowerCase() === cleanRecipientLower,
    );
  }

  const recipientName =
    savedRecipientName ||
    recEmp?.full_name ||
    recUser?.display_name ||
    recUser?.username ||
    cleanRecipientId ||
    'Nhân sự Ụm Bò Milk';

  const realAckAt = isMetaJson ? '' : log.ack_at;
  const isReadConfirmed = Boolean(log.read_at || realAckAt);

  return {
    ...log,
    announcementCode: anc?.code || refCode || 'ANC',
    announcementTitle: anc?.title || 'Bản tin truyền thông nội bộ',
    recipientName,
    ack_at: realAckAt,
    readReceiptStatus: isReadConfirmed ? 'READ_CONFIRMED' : 'NO_RECEIPT',
    readReceiptLabel: isReadConfirmed ? 'Đã xác nhận đọc' : 'Chưa xác nhận đọc',
  };
}
