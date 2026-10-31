import { EMAIL_TEMPLATE_CODES, EMAIL_TEMPLATE_LABELS, SYSTEM_CONFIG, type DeliveryLog, type EmailTemplateCode } from '@umbm/shared';
import type { Database } from '../data/database.js';
import type { SendEmailInput } from './email-template.js';

export interface PersistedEmailMeta {
  recipientName?: string;
  subject?: string;
  summary?: string;
  metadata?: { label: string; value: string }[];
  actionLabel?: string;
  actionUrl?: string;
}

const SECRET_LABEL_RE = /(mã pin|pin đăng nhập|mật khẩu|password|secret)/i;

export function serializeSafeEmailMeta(input: SendEmailInput): string {
  const safeMetadata = (input.metadata ?? []).map((m) => ({
    label: m.label,
    value: SECRET_LABEL_RE.test(m.label) ? '****** (Đã ẩn bảo mật)' : m.value,
  }));
  const payload: PersistedEmailMeta = {
    recipientName: input.recipientName,
    subject: input.subject,
    summary: input.summary,
    metadata: safeMetadata,
    actionLabel: input.actionLabel,
    actionUrl: input.actionUrl,
  };
  return JSON.stringify(payload);
}

function parseSavedMeta(raw?: string): PersistedEmailMeta | null {
  if (!raw || !raw.trim().startsWith('{')) return null;
  try {
    return JSON.parse(raw) as PersistedEmailMeta;
  } catch {
    return null;
  }
}

export function reconstructEmailInputFromLog(db: Database, log: DeliveryLog, cleanTo: string): SendEmailInput {
  const [rawTpl = 'ACCOUNT_ACTIVATED', ...refParts] = (log.announcement_id || '').split(':');
  const template = (EMAIL_TEMPLATE_CODES.includes(rawTpl as EmailTemplateCode) ? rawTpl : 'ACCOUNT_ACTIVATED') as EmailTemplateCode;
  const referenceCode = refParts.join(':') || `REF-${log.id.slice(0, 6)}`;
  const saved = parseSavedMeta(log.ack_at);

  const matchedUser = db.users.find((u) => u.email.trim().toLowerCase() === cleanTo || (referenceCode.startsWith('UPD-') && u.id.startsWith(referenceCode.slice(4))));
  const matchedEmp = db.employees.find((e) => e.email.trim().toLowerCase() === cleanTo || Boolean(matchedUser?.employee_id && (e.employee_code === matchedUser.employee_id || e.id === matchedUser.employee_id)));

  let recipientName = saved?.recipientName || matchedEmp?.full_name || matchedUser?.display_name || 'Nhân sự Ụm Bò Milk';
  let summary = saved?.summary || `Thông báo hệ thống ${SYSTEM_CONFIG.brandName} — ${EMAIL_TEMPLATE_LABELS[template]}.`;
  const extraMeta: { label: string; value: string }[] = [];

  if (!saved?.metadata && referenceCode.startsWith('ADJ-')) {
    const adj = db.attendanceAdjustments.find((a) => a.adjustment_code === referenceCode || `ADJ-${a.id.slice(-4).toUpperCase()}` === referenceCode);
    if (adj) {
      const emp = db.employees.get(adj.employee_id);
      if (emp?.full_name && cleanTo === emp.email.trim().toLowerCase()) recipientName = emp.full_name;
      summary = `Phiếu bổ sung công ${referenceCode}${emp ? ` của nhân sự ${emp.full_name} (${emp.employee_code})` : ''} đã được cập nhật trạng thái xử lý trên hệ thống.`;
      extraMeta.push(
        { label: 'Nhân sự & Ngày công', value: `${emp ? `${emp.full_name} (${emp.employee_code})` : adj.employee_id}${adj.work_date ? ` · Ngày ${adj.work_date}` : ''}` },
        { label: 'Lý do giải trình', value: adj.reason || 'Bổ sung chấm công ca làm việc' },
        { label: 'Phản hồi phê duyệt', value: adj.decision_reason || (adj.status === 'APPROVED' ? 'Đã phê duyệt bổ sung công' : adj.status === 'REJECTED' ? 'Từ chối bổ sung công' : 'Đang chờ duyệt') },
      );
    }
  } else if (!saved?.metadata && matchedUser) {
    extraMeta.push(
      { label: 'Tài khoản hệ thống', value: `@${matchedUser.username} (${matchedUser.display_name})` },
      { label: 'Trạng thái tài khoản', value: matchedUser.status === 'ACTIVE' ? 'Đang hoạt động' : matchedUser.status },
    );
  }

  return {
    to: cleanTo,
    template,
    recipientName,
    referenceCode,
    subject: saved?.subject,
    summary,
    metadata: saved?.metadata && saved.metadata.length > 0
      ? saved.metadata
      : [
          { label: 'Mã tham chiếu', value: referenceCode },
          { label: 'Người nhận', value: `${recipientName} (${cleanTo})` },
          { label: 'Loại thông báo', value: EMAIL_TEMPLATE_LABELS[template] },
          ...extraMeta,
        ],
    actionLabel: saved?.actionLabel,
    actionUrl: saved?.actionUrl,
  };
}
