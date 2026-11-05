import { isShiftTimePassed, type ShiftSwap } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { APP_TZ, dayjs, nowIso } from '../lib/time.js';
import { SocketEvents } from '../realtime/realtime.js';
import { emitScheduleRealtime } from '../routes/account-employee-sync.js';
import { cancelDispatchAnnouncement } from './shift-dispatch.service.js';
import { resolveShiftSpec } from './shift-swap-audit.service.js';

/**
 * Quét toàn bộ các yêu cầu đổi / nhường ca hoặc điều phối khẩn cấp đang ở trạng thái chờ
 * (PENDING_PEER, PEER_ACCEPTED) nhưng khung ca làm việc đã kết thúc (quá hạn)
 * để tự động chuyển sang trạng thái EXPIRED (Đã quá hạn), đồng thời dọn bản tin thông báo.
 */
export async function sweepExpiredShiftSwaps(
  ctx: AppContext,
  actorId = 'system-expiry',
): Promise<{ expiredCount: number; expiredIds: string[] }> {
  const today = dayjs().tz(APP_TZ).format('YYYY-MM-DD');
  const nowHm = dayjs().tz(APP_TZ).format('HH:mm');
  const now = nowIso();
  const expired: ShiftSwap[] = [];

  for (const s of ctx.db.shiftSwaps.all()) {
    if (s.status !== 'PENDING_PEER' && s.status !== 'PEER_ACCEPTED') continue;
    const from = s.from_assignment_id ? ctx.db.shiftAssignments.get(s.from_assignment_id) : undefined;
    const workDate = from?.work_date || s.from_work_date;
    const shiftCode = from?.shift_code || s.from_shift_code;
    if (!workDate || !shiftCode) continue;

    const spec = resolveShiftSpec(ctx, shiftCode, from, workDate);
    if (!isShiftTimePassed(workDate, spec.endAt, today, nowHm)) continue;

    const formattedDate = dayjs(workDate).format('DD/MM/YYYY');
    const reason = `Tự động đóng do ca làm việc đã quá hạn (kết thúc lúc ${spec.endAt} ngày ${formattedDate})`;
    const updated = await ctx.db.shiftSwaps.update(s.id, s.version, {
      status: 'EXPIRED',
      decided_by: actorId,
      decided_at: now,
      decision_reason: reason,
    }, actorId);

    if (s.kind === 'HR_DISPATCH') {
      await cancelDispatchAnnouncement(ctx, s.swap_code, actorId).catch(() => undefined);
    }
    expired.push(updated);
    emitScheduleRealtime(ctx, SocketEvents.SWAP_UPDATED, {
      branchId: s.branch_id,
      employeeIds: [s.requester_id, s.peer_id].filter(Boolean),
      kind: 'SWAP_EXPIRED',
      message: `Yêu cầu ${s.swap_code} đã tự động chuyển sang Đã quá hạn`,
      actorId,
    });
  }

  return { expiredCount: expired.length, expiredIds: expired.map((x) => x.id) };
}
