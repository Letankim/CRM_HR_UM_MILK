import { DEFAULT_SHIFT_LABELS, type ShiftSwap } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { nowIso } from '../lib/time.js';

/** Đăng lệnh điều phối khẩn cấp lên Bảng tin chi nhánh (COMMS.ANNOUNCEMENTS). */
export async function publishDispatchAnnouncement(
  ctx: AppContext,
  swap: ShiftSwap,
  from: { branch_id: string; work_date: string; shift_code: string; start_at?: string; end_at?: string },
  actor: { id: string; display_name?: string; username?: string },
): Promise<void> {
  const branch = ctx.db.branches.get(from.branch_id);
  const branchName = branch?.name || from.branch_id;
  const tpl = ctx.db.shiftTemplates.find((t) => t.code === from.shift_code);
  const shiftLabel = (DEFAULT_SHIFT_LABELS as Record<string, string>)[from.shift_code] ?? tpl?.name ?? from.shift_code;
  const workDateFormatted = from.work_date.split('-').reverse().join('/');
  const shiftTime = `${from.start_at || tpl?.start_time || '07:00'} – ${from.end_at || tpl?.end_time || '12:00'}`;

  const title = `Điều phối khẩn cấp: Cần nhân sự làm thêm / làm thay ca ${shiftLabel} ngày ${workDateFormatted} (+30.000đ)`;
  const summary = `Cửa hàng ${branchName} thiếu nhân sự khẩn cấp cho ca ${shiftLabel} (${shiftTime}) ngày ${workDateFormatted}. Nhân sự nhận ca làm thêm / làm thay được hệ thống tự động cộng phụ cấp thưởng +30.000đ/ca vào bảng lương kỳ này.`;
  const bodyHtml = `<p><strong>LỆNH ĐIỀU PHỐI NHÂN SỰ KHẨN CẤP (${swap.swap_code})</strong></p>` +
    `<p>Cửa hàng <strong>${branchName}</strong> đang cần tuyển gấp nhân sự nhận làm thêm / làm thay ca làm việc sau:</p>` +
    `<ul>` +
    `<li><strong>Ngày làm:</strong> ${workDateFormatted}</li>` +
    `<li><strong>Ca làm việc:</strong> ${shiftLabel} (${shiftTime})</li>` +
    `<li><strong>Lý do điều phối:</strong> ${swap.reason || 'Thiếu nhân sự đột xuất tại chi nhánh'}</li>` +
    `<li><strong>Chính sách đãi ngộ:</strong> Tự động cộng thêm <strong>+30.000đ/ca</strong> vào bảng lương kỳ này</li>` +
    `</ul>` +
    `<p>Nhân viên bấm vào liên kết <em>"Nhận ca làm thay (+30.000đ)"</em> để nhận ca ngay. Ca làm sẽ lập tức nạp vào lịch của bạn và đồng bộ bảng lương.</p>`;

  await ctx.db.announcements.insert({
    code: `ANC-DSP-${swap.swap_code}`,
    campaign_id: '',
    title,
    summary,
    body: bodyHtml,
    cta_label: 'Nhận ca (+30.000đ)',
    cta_link: '/nv/doi-ca',
    media_ids: '[]',
    audience_scope: 'BRANCH',
    audience_json: JSON.stringify({ scope: 'BRANCH', target: from.branch_id, onlyStoreOfficial: true }),
    priority: 'URGENT',
    requires_ack: false,
    scheduled_at: '',
    sent_at: nowIso(),
    status: 'SENT',
    approved_by: actor.display_name || actor.username || 'HR/Store',
  }, actor.id);
}

/** Cập nhật bản tin khi có nhân viên bấm nhận ca điều phối khẩn cấp. */
export async function resolveDispatchAnnouncementOnClaim(
  ctx: AppContext,
  swapCode: string,
  receiver: { full_name: string; employee_code: string },
  actorId: string,
): Promise<void> {
  const anc = ctx.db.announcements.find((a) => a.code === `ANC-DSP-${swapCode}`);
  if (!anc) return;
  const note = `ĐÃ TIẾP NHẬN: ${receiver.full_name} (${receiver.employee_code})`;
  const updatedBody = anc.body + `<p style="color: #16A34A; font-weight: bold; margin-top: 12px;">Ca làm việc này đã được nhân viên ${receiver.full_name} (${receiver.employee_code}) nhận làm thay. Cảm ơn bạn!</p>`;
  await ctx.db.announcements.update(anc.id, anc.version, {
    summary: `${anc.summary} [${note}]`,
    body: updatedBody,
  }, actorId);
}

/** Xóa bản tin khi lệnh điều phối khẩn cấp bị hủy bỏ. */
export async function cancelDispatchAnnouncement(
  ctx: AppContext,
  swapCode: string,
  actorId: string,
): Promise<void> {
  const anc = ctx.db.announcements.find((a) => a.code === `ANC-DSP-${swapCode}`);
  if (!anc) return;
  await ctx.db.announcements.softDelete(anc.id, anc.version, actorId);
}
