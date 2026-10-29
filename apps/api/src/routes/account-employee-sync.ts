import { DEFAULT_SHIFT_LABELS, type Employee, type EmployeeStage, type Role, type User } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { singleFlight, tolerantWrite } from '../services/background-write.js';
import { ensureSyncedNotifications } from '../services/notification-sync.service.js';
import { today } from '../services/salary-profile.service.js';
import { resolveWorkflowShiftStatus, sweepExpiredShiftsAndMarkAbsent } from '../services/shift-absent-scanner.js';
import { findLinkedEmployeeForUser, findLinkedUserForEmployee } from './employee-mapper.js';

const SHIFT_FALLBACK: Record<string, { start: string; end: string; hours: number }> = {
  CA_SANG: { start: '07:00', end: '12:00', hours: 5 }, CA_CHIEU: { start: '12:00', end: '17:00', hours: 5 },
  CA_TOI: { start: '17:00', end: '22:00', hours: 5 }, CA_HANH_CHINH: { start: '08:00', end: '17:30', hours: 8 },
};

export function findBranchShiftTemplate(ctx: AppContext, shiftCode: string, branchId = '') {
  if (branchId && branchId !== 'ALL') {
    const branchTpl = ctx.db.shiftTemplates.find((s) => s.code === shiftCode && s.shift_group === branchId);
    if (branchTpl) return branchTpl;
  }
  return ctx.db.shiftTemplates.find((s) => s.code === shiftCode && (s.shift_group === 'ALL' || s.shift_group === 'STORE')) ?? ctx.db.shiftTemplates.find((s) => s.code === shiftCode);
}

export function resolveShiftTimeDetails(ctx: AppContext, shiftCode: string, assignmentId = '', branchId = '', employeeId = '', workDate = '') {
  const st = resolveWorkflowShiftStatus(ctx.db, shiftCode, assignmentId, employeeId, workDate);
  const assign = (st.shiftAssignmentId ? ctx.db.shiftAssignments.get(st.shiftAssignmentId) : undefined) ?? (assignmentId ? ctx.db.shiftAssignments.get(assignmentId) : undefined);
  const tpl = findBranchShiftTemplate(ctx, shiftCode, branchId || assign?.branch_id || '');
  const fb = SHIFT_FALLBACK[shiftCode] ?? SHIFT_FALLBACK.CA_SANG!;
  const startAt = assign?.start_at || tpl?.start_time || fb.start, endAt = assign?.end_at || tpl?.end_time || fb.end;
  const scheduledHours = assign?.scheduled_hours || tpl?.standard_hours || fb.hours;
  const rawLabel = tpl?.name ?? DEFAULT_SHIFT_LABELS[shiftCode as keyof typeof DEFAULT_SHIFT_LABELS] ?? shiftCode;
  return { shiftLabel: rawLabel.replace(/\s*\([^)]*\)\s*/g, '').trim(), startAt, endAt, scheduledHours, shiftTimeRange: `${startAt} – ${endAt}`, ...st };
}

export function resolveSingleBranchId(ctx: AppContext, branchScope?: string): string | undefined {
  const firstToken = branchScope?.trim().split(',')[0]?.trim();
  if (!firstToken || firstToken === 'ALL') return undefined;
  return (ctx.db.branches.get(firstToken) ?? ctx.db.branches.find((b) => b.code.trim().toUpperCase() === firstToken.toUpperCase()))?.id;
}

export function resolveEmployeeBranchId(ctx: AppContext, employeeId: string, fallbackBranchId = ''): string {
  if (!employeeId) return fallbackBranchId;
  const emp = ctx.db.employees.get(employeeId) ?? ctx.db.employees.find((e) => e.employee_code.trim().toUpperCase() === employeeId.trim().toUpperCase());
  if (!emp) return fallbackBranchId;
  const linkedUser = findLinkedUserForEmployee(emp, ctx), userBranchId = linkedUser ? resolveSingleBranchId(ctx, linkedUser.branch_scope) : undefined;
  if (userBranchId && userBranchId !== emp.branch_id && (linkedUser?.updated_at ?? '') > (emp.updated_at ?? '')) return userBranchId;
  return emp.branch_id || fallbackBranchId;
}

export async function cascadeEmployeeBranchChange(ctx: AppContext, emp: Employee, newBranchId: string, actorId: string): Promise<void> {
  if (!newBranchId) return;
  const matchEmp = (eid: string) => eid === emp.id || eid.trim().toUpperCase() === emp.employee_code.trim().toUpperCase();
  const moveBatch = <T extends { id: string; version: number }>(store: { batchUpdate: (items: { id: string; expectedVersion: number; patch: { branch_id: string } }[], a: string) => Promise<T[]> }, rows: T[]) =>
    rows.length > 0 ? tolerantWrite(() => store.batchUpdate(rows.map((r) => ({ id: r.id, expectedVersion: r.version, patch: { branch_id: newBranchId } })), actorId)) : Promise.resolve();
  await Promise.all([
    moveBatch(ctx.db.shiftAssignments, ctx.db.shiftAssignments.filter((x) => matchEmp(x.employee_id) && x.branch_id !== newBranchId)),
    moveBatch(ctx.db.leaveRequests, ctx.db.leaveRequests.filter((x) => matchEmp(x.employee_id) && x.branch_id !== newBranchId)),
    moveBatch(ctx.db.shiftSwaps, ctx.db.shiftSwaps.filter((x) => matchEmp(x.requester_id) && x.branch_id !== newBranchId)),
    moveBatch(ctx.db.emergencyLeaves, ctx.db.emergencyLeaves.filter((x) => matchEmp(x.employee_id) && x.branch_id !== newBranchId)),
    moveBatch(ctx.db.attendanceEvents, ctx.db.attendanceEvents.filter((x) => matchEmp(x.employee_id) && x.branch_id !== newBranchId)),
    moveBatch(ctx.db.attendanceAdjustments, ctx.db.attendanceAdjustments.filter((x) => matchEmp(x.employee_id) && x.branch_id !== newBranchId)),
  ]);
}

const healsInFlight = new WeakMap<object, Promise<void>>();
const lastHealSig = new WeakMap<object, string>();

function computeHealSig(ctx: AppContext): string {
  const verSum = (rows: readonly { version: number }[]) => rows.reduce((s, r) => s + r.version, rows.length);
  return `${Math.floor(Date.now() / 60_000)}:${verSum(ctx.db.users.all())}:${verSum(ctx.db.employees.all())}:${verSum(ctx.db.shiftAssignments.all())}:${verSum(ctx.db.leaveRequests.all())}:${verSum(ctx.db.attendanceEvents.all())}:${verSum(ctx.db.attendanceAdjustments.all())}`;
}

/** Tự động đồng bộ & làm sạch lệch chi nhánh giữa Tài khoản <-> Hồ sơ nhân sự <-> Lịch phân ca & Điểm danh */
export function healBranchConsistency(ctx: AppContext, actorId = 'system-sync'): Promise<void> {
  const sig = computeHealSig(ctx);
  if (lastHealSig.get(ctx.db) === sig) return Promise.resolve();
  return singleFlight(healsInFlight, ctx.db, async () => {
    await runHeal(ctx, actorId);
    lastHealSig.set(ctx.db, computeHealSig(ctx));
  });
}

async function runHeal(ctx: AppContext, actorId: string): Promise<void> {
  const empPatches: { id: string; expectedVersion: number; patch: { branch_id: string } }[] = [];
  const userPatches: { id: string; expectedVersion: number; patch: { branch_scope: string } }[] = [];
  for (const snap of ctx.db.employees.all()) {
    const emp = ctx.db.employees.get(snap.id) ?? snap;
    let effectiveBranchId = emp.branch_id;
    const linkedUser = findLinkedUserForEmployee(emp, ctx);
    if (linkedUser) {
      const userBranchId = resolveSingleBranchId(ctx, linkedUser.branch_scope);
      const isBranchRole = linkedUser.role === 'THU_VIEC' || linkedUser.role === 'CHINH_THUC' || linkedUser.role === 'STORE';
      if (userBranchId && userBranchId !== emp.branch_id) {
        if ((linkedUser.updated_at ?? '') >= (emp.updated_at ?? '')) {
          effectiveBranchId = userBranchId;
          empPatches.push({ id: emp.id, expectedVersion: emp.version, patch: { branch_id: userBranchId } });
        } else if (isBranchRole) {
          userPatches.push({ id: linkedUser.id, expectedVersion: linkedUser.version, patch: { branch_scope: emp.branch_id } });
        }
      } else if (!userBranchId && isBranchRole && emp.branch_id) {
        userPatches.push({ id: linkedUser.id, expectedVersion: linkedUser.version, patch: { branch_scope: emp.branch_id } });
      }
    }
    if (effectiveBranchId) await cascadeEmployeeBranchChange(ctx, emp, effectiveBranchId, actorId);
  }
  if (empPatches.length > 0) await tolerantWrite(() => ctx.db.employees.batchUpdate(empPatches, actorId));
  if (userPatches.length > 0) await tolerantWrite(() => ctx.db.users.batchUpdate(userPatches, actorId));
  const hasEventAssignIds = new Set(ctx.db.attendanceEvents.all().map((ev) => ev.assignment_id));
  const shiftDeletes: { id: string; expectedVersion: number; patch: { is_deleted: boolean } }[] = [];
  for (const l of ctx.db.leaveRequests.filter((x) => x.status === 'APPROVED')) {
    const emp = ctx.db.employees.get(l.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === l.employee_id);
    const matchEmp = (eid: string) => eid === l.employee_id || Boolean(emp && (eid === emp.id || eid === emp.employee_code));
    for (const s of ctx.db.shiftAssignments.filter((a) => matchEmp(a.employee_id) && a.work_date === l.leave_date)) {
      if (!hasEventAssignIds.has(s.id)) shiftDeletes.push({ id: s.id, expectedVersion: s.version, patch: { is_deleted: true } });
    }
  }
  if (shiftDeletes.length > 0) await tolerantWrite(() => ctx.db.shiftAssignments.batchUpdate(shiftDeletes, actorId));
  await sweepExpiredShiftsAndMarkAbsent(ctx.db, actorId);
}

export interface SyncEmployeeFromAccountParams {
  userId: string; prevEmp?: Employee; targetEmp?: Employee; displayName?: string;
  phone?: string; email?: string; role?: Role; branchScope?: string; actorId: string;
}

export async function syncEmployeeFromAccount(ctx: AppContext, params: SyncEmployeeFromAccountParams): Promise<string> {
  const { userId, prevEmp, targetEmp, displayName, phone, email, role, branchScope, actorId } = params;
  if (prevEmp && prevEmp.id !== targetEmp?.id && prevEmp.user_id === userId) {
    await ctx.db.employees.update(prevEmp.id, prevEmp.version, { user_id: '' }, actorId);
  }
  if (!targetEmp) return '';
  if (targetEmp.user_id && targetEmp.user_id !== userId) {
    const oldUser = ctx.db.users.get(targetEmp.user_id);
    if (oldUser && oldUser.id !== userId) await ctx.db.users.update(oldUser.id, oldUser.version, { employee_id: '' }, actorId);
  }
  const resolvedBranchId = resolveSingleBranchId(ctx, branchScope);
  const empPatch: Record<string, unknown> = { user_id: userId };
  if (resolvedBranchId && resolvedBranchId !== targetEmp.branch_id) empPatch.branch_id = resolvedBranchId;
  if (displayName && displayName !== targetEmp.full_name) empPatch.full_name = displayName;
  if (phone !== undefined && phone !== '' && phone !== targetEmp.phone) empPatch.phone = phone;
  if (email !== undefined && email !== targetEmp.email) empPatch.email = email;
  if (role === 'CHINH_THUC' && targetEmp.stage !== 'OFFICIAL') {
    empPatch.stage = 'OFFICIAL';
    if (!targetEmp.official_from) empPatch.official_from = today();
  } else if (role === 'THU_VIEC' && targetEmp.stage !== 'PROBATION') {
    empPatch.stage = 'PROBATION';
  }
  const updatedEmp = await ctx.db.employees.update(targetEmp.id, targetEmp.version, empPatch, actorId);
  await cascadeEmployeeBranchChange(ctx, updatedEmp, updatedEmp.branch_id, actorId);
  return updatedEmp.employee_code;
}

export interface SyncAccountFromEmployeeParams {
  empId: string; employeeCode: string; prevUser?: User; targetUser?: User; fullName?: string;
  phone?: string; email?: string; branchId?: string; stage?: EmployeeStage; pinPatch?: Record<string, unknown>; actorId: string;
}

export async function syncAccountFromEmployee(ctx: AppContext, params: SyncAccountFromEmployeeParams): Promise<string> {
  const { empId, employeeCode, prevUser, targetUser, fullName, phone, email, branchId, stage, pinPatch, actorId } = params;
  if (prevUser && prevUser.id !== targetUser?.id) await ctx.db.users.update(prevUser.id, prevUser.version, { employee_id: '' }, actorId);
  if (!targetUser) return '';
  const otherEmp = findLinkedEmployeeForUser(targetUser, ctx);
  if (otherEmp && otherEmp.id !== empId && otherEmp.user_id === targetUser.id) {
    await ctx.db.employees.update(otherEmp.id, otherEmp.version, { user_id: '' }, actorId);
  }
  const isBranchScopedRole = targetUser.role === 'THU_VIEC' || targetUser.role === 'CHINH_THUC' || targetUser.role === 'STORE';
  const userPatch: Record<string, unknown> = { employee_id: employeeCode, ...(pinPatch ?? {}) };
  if (fullName && fullName !== targetUser.display_name) userPatch.display_name = fullName;
  if (phone && phone !== targetUser.phone) userPatch.phone = phone;
  if (email !== undefined && email !== targetUser.email) userPatch.email = email;
  if (branchId && isBranchScopedRole) userPatch.branch_scope = branchId;
  if (stage === 'OFFICIAL' && targetUser.role === 'THU_VIEC') userPatch.role = 'CHINH_THUC';
  else if (stage === 'PROBATION' && targetUser.role === 'CHINH_THUC') userPatch.role = 'THU_VIEC';
  await ctx.db.users.update(targetUser.id, targetUser.version, userPatch, actorId);
  return targetUser.id;
}

const pendingRealtimeBatches = new Map<string, { count: number; branchId: string; userIds: Set<string>; firstMsg: string; actorId: string; timer: ReturnType<typeof setTimeout> }>();
const BULK_KIND_LABELS: Record<string, (n: number) => string> = {
  ADJUSTMENT_DECIDED: (n) => `Đã xử lý hàng loạt ${n} phiếu bổ sung công`, ADJUSTMENT_STORE_CONFIRMED: (n) => `Cửa hàng đã xác nhận ${n} phiếu bổ sung công chờ HR duyệt`,
  ADJUSTMENT_CREATED: (n) => `Có ${n} phiếu bổ sung công mới vừa gửi chờ duyệt`, LEAVE_DECIDED: (n) => `Đã xử lý hàng loạt ${n} đơn xin nghỉ phép (OFF)`,
  LEAVE_CREATED: (n) => `Có ${n} đơn xin nghỉ phép (OFF) mới chờ duyệt`, SWAP_DECIDED: (n) => `Đã xử lý hàng loạt ${n} yêu cầu đổi ca`,
  SWAP_PEER: (n) => `Đã cập nhật hàng loạt ${n} yêu cầu đổi ca`, EMERGENCY_HANDLED: (n) => `Đã xử lý hàng loạt ${n} báo cáo nghỉ đột xuất`, SHIFT_APPROVED: (n) => `Đã duyệt và phát hành chính thức ${n} ca làm việc`,
};
const MGR_CREATE_KINDS = new Set(['ADJUSTMENT_CREATED', 'LEAVE_CREATED', 'SHIFT_REGISTERED', 'EMERGENCY_REPORTED']);

export function emitScheduleRealtime(ctx: AppContext, event: string, opts: { branchId?: string; employeeIds?: (string | undefined)[]; kind?: string; message?: string; actorId?: string }): void {
  const firstEmpId = (opts.employeeIds ?? []).find(Boolean) ?? '', resolvedBranchId = resolveEmployeeBranchId(ctx, firstEmpId, opts.branchId ?? '') || opts.branchId || '';
  const kind = opts.kind ?? 'SCHEDULE_SYNC', batchKey = `${event}:${kind}:${resolvedBranchId || 'ALL'}`;
  const existing = pendingRealtimeBatches.get(batchKey), userIds = existing?.userIds ?? new Set<string>();
  let isTargetBoOrHr = false;
  for (const rawId of opts.employeeIds ?? []) {
    if (!rawId) continue;
    const emp = ctx.db.employees.get(rawId) ?? ctx.db.employees.find((e) => e.employee_code === rawId);
    const u = emp ? findLinkedUserForEmployee(emp, ctx) : undefined;
    if (u) userIds.add(u.id);
    if (emp?.staff_group === 'BACKOFFICE' || ['HR', 'ADMIN', 'FINANCE', 'MKT', 'STORE'].includes(u?.role ?? '')) isTargetBoOrHr = true;
  }
  if (existing) clearTimeout(existing.timer);
  const count = (existing?.count ?? 0) + 1, firstMsg = existing?.firstMsg || opts.message || '';
  const branchId = resolvedBranchId || existing?.branchId || '', actorId = opts.actorId ?? existing?.actorId ?? '';
  const timer = setTimeout(async () => {
    pendingRealtimeBatches.delete(batchKey);
    await ensureSyncedNotifications(ctx).catch(() => undefined);
    const rt = ctx.realtime();
    if (!rt) return;
    const message = count > 1 ? (BULK_KIND_LABELS[kind]?.(count) ?? firstMsg) : firstMsg;
    const actorRole = actorId ? ctx.db.users.get(actorId)?.role : undefined;
    const skipStore = isTargetBoOrHr || actorRole === 'HR' || actorRole === 'ADMIN' || actorRole === 'FINANCE';
    const alertRoles: Role[] = (kind === 'ADJUSTMENT_STORE_CONFIRMED' || kind === 'EMERGENCY_ESCALATED') ? ['HR'] : (MGR_CREATE_KINDS.has(kind) || kind === 'SWAP_PEER') ? (skipStore ? ['HR'] : ['HR', 'STORE']) : [];
    const alertUserIds = (MGR_CREATE_KINDS.has(kind) || kind === 'EMERGENCY_ESCALATED') ? [] : Array.from(userIds);
    if (message && (alertRoles.length > 0 || alertUserIds.length > 0)) {
      rt.toTargets({ branchId, roles: alertRoles, userIds: alertUserIds, excludeUserId: actorId }, event, { kind, branchId, message, actorId });
      rt.toTargets({ branchId, roles: alertRoles, userIds: alertUserIds, excludeUserId: actorId }, 'notification:new', { kind, branchId, title: message, actorId });
    }
    const silentRoles = (['ADMIN', 'HR', 'STORE', 'FINANCE'] as Role[]).filter((r) => !message || !alertRoles.includes(r));
    rt.toTargets({ branchId, roles: silentRoles, userIds: message ? [] : Array.from(userIds) }, event, { kind, branchId, message: '', actorId });
  }, 120);
  if (typeof timer.unref === 'function') timer.unref();
  pendingRealtimeBatches.set(batchKey, { count, branchId, userIds, firstMsg, actorId, timer });
}
