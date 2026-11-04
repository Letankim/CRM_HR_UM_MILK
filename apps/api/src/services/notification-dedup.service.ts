import type { AppContext } from '../context.js';
import { tolerantWrite } from './background-write.js';
import { isStaleTicketNotification } from './ticket-notification.service.js';

export const SYNC_ACTOR = 'system-sync';

/** Khử trùng lặp và dọn dẹp các thông báo / phiếu bù công đã được giải quyết hoặc trùng lặp. */
export async function deduplicateAdjustmentsAndNotifications(ctx: AppContext): Promise<void> {
  const empByCode = new Map(ctx.db.employees.all().map((e) => [e.employee_code, e.id]));
  const seenAdjKeys = new Set<string>();
  const adjDeletes: { id: string; expectedVersion: number; patch: { is_deleted: boolean } }[] = [];
  for (const adj of [...ctx.db.attendanceAdjustments.all()].reverse()) {
    if (adj.status === 'REJECTED') continue;
    const eid = empByCode.get(adj.employee_id) ?? adj.employee_id, pType = adj.punch_type || 'FULL_SHIFT';
    const key = adj.assignment_id ? `asg:${adj.assignment_id}:${pType}` : `emp:${eid}:${adj.work_date}:${adj.shift_code}:${pType}`;
    if (seenAdjKeys.has(key)) adjDeletes.push({ id: adj.id, expectedVersion: adj.version, patch: { is_deleted: true } });
    else seenAdjKeys.add(key);
  }
  if (adjDeletes.length > 0) await tolerantWrite(() => ctx.db.attendanceAdjustments.batchUpdate(adjDeletes, SYNC_ACTOR));

  const adjBatchCounts = new Map<string, number>();
  for (const adj of ctx.db.attendanceAdjustments.all()) {
    if ((adj.status === 'APPROVED' || adj.status === 'REJECTED') && adj.decided_at) {
      adjBatchCounts.set(`${adj.decided_at.slice(0, 16)}_${adj.status}`, (adjBatchCounts.get(`${adj.decided_at.slice(0, 16)}_${adj.status}`) ?? 0) + 1);
    }
  }

  const seenNotifKeys = new Set<string>();
  const notifDeletes: { id: string; expectedVersion: number; patch: { is_deleted: boolean } }[] = [];
  for (const n of [...ctx.db.notifications.all()].reverse()) {
    const rawAdjId = (n.entity_id || '').replace(/_(STORE_CONFIRMED|APPROVED|REJECTED)$/, '');
    const adj = n.entity_type.startsWith('ATT_ADJ_') && !n.entity_id.startsWith('BULK_') ? ctx.db.attendanceAdjustments.get(rawAdjId) : undefined;
    const isResolvedPending =
      n.entity_type === 'PAYSLIP_SIGNED_ADMIN' || n.entity_type === 'PAYSLIP_PAID' ||
      (n.entity_type === 'PAYROLL_SUBMIT_ADMIN' && ctx.db.payPeriods.get(n.entity_id)?.status !== 'RECONCILE') ||
      (n.entity_type === 'PAYROLL_ADMIN_APPROVED' && ctx.db.payPeriods.get(n.entity_id)?.status !== 'APPROVED') ||
      (n.entity_type === 'PAYSLIP_USER' && !n.entity_id.endsWith('_PAID') && ctx.db.payslips.get(n.entity_id)?.status === 'REVISED') ||
      (n.entity_type === 'ATT_ADJ_HR' && (!adj || (adj.status !== 'PENDING' && adj.status !== 'STORE_CONFIRMED') || (adj.status === 'STORE_CONFIRMED' && !n.entity_id.endsWith('_STORE_CONFIRMED')))) ||
      (n.entity_type === 'LEAVE_ROLE' && ctx.db.leaveRequests.get(n.entity_id)?.status !== 'PENDING') ||
      (n.entity_type === 'SHIFT_DRAFT_ROLE' && ctx.db.shiftAssignments.get(n.entity_id)?.status !== 'DRAFT') ||
      (n.entity_type === 'SWAP_STORE' && ctx.db.shiftSwaps.get((n.entity_id || '').replace(/_(PENDING_PEER|PEER_ACCEPTED)$/, ''))?.status !== 'PEER_ACCEPTED') ||
      n.entity_type === 'EMG_STORE' || n.entity_type === 'EMG_USER' ||
      (n.entity_type === 'PROBATION_READY_HR' && ctx.db.employees.get(n.entity_id)?.stage !== 'PROBATION') ||
      (n.entity_type === 'USERS_PENDING' && ctx.db.users.get(n.entity_id)?.status !== 'PENDING_ACTIVATION') ||
      isStaleTicketNotification(ctx, n);
    const isMergedIntoBulk = n.entity_type === 'ATT_ADJ_USER' && !n.entity_id.startsWith('BULK_') && adj?.decided_at && (adjBatchCounts.get(`${adj.decided_at.slice(0, 16)}_${adj.status}`) ?? 0) > 1;
    const isSelfPendingLeave = n.entity_type === 'LEAVE_USER' && n.title.includes('Đã tiếp nhận');
    const dedupKey = n.entity_type && n.entity_id ? `ent:${n.entity_type}:${n.entity_id}` : `txt:${n.category}:${n.recipient_role}:${n.recipient_user_id}:${n.title}:${n.body}`;
    if (isResolvedPending || isMergedIntoBulk || isSelfPendingLeave || seenNotifKeys.has(dedupKey)) {
      notifDeletes.push({ id: n.id, expectedVersion: n.version, patch: { is_deleted: true } });
      continue;
    }
    seenNotifKeys.add(dedupKey);
  }
  if (notifDeletes.length > 0) await tolerantWrite(() => ctx.db.notifications.batchUpdate(notifDeletes, SYNC_ACTOR));
}
