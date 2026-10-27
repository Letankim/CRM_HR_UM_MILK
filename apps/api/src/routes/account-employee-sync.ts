import { DEFAULT_SHIFT_LABELS, type Employee, type EmployeeStage, type Role, type User } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { singleFlight, tolerantWrite } from '../services/background-write.js';
import { today } from '../services/salary-profile.service.js';
import { sweepExpiredShiftsAndMarkAbsent } from '../services/shift-absent-scanner.js';
import { findLinkedEmployeeForUser, findLinkedUserForEmployee } from './employee-mapper.js';

const SHIFT_FALLBACK: Record<string, { start: string; end: string; hours: number }> = {
  CA_SANG: { start: '07:00', end: '12:00', hours: 5 },
  CA_CHIEU: { start: '12:00', end: '17:00', hours: 5 },
  CA_TOI: { start: '17:00', end: '22:00', hours: 5 },
  CA_HANH_CHINH: { start: '08:00', end: '17:30', hours: 8 },
};

export function findBranchShiftTemplate(ctx: AppContext, shiftCode: string, branchId = '') {
  if (branchId && branchId !== 'ALL') {
    const branchTpl = ctx.db.shiftTemplates.find((s) => s.code === shiftCode && s.shift_group === branchId);
    if (branchTpl) return branchTpl;
  }
  return (
    ctx.db.shiftTemplates.find((s) => s.code === shiftCode && (s.shift_group === 'ALL' || s.shift_group === 'STORE')) ??
    ctx.db.shiftTemplates.find((s) => s.code === shiftCode)
  );
}

export function resolveShiftTimeDetails(ctx: AppContext, shiftCode: string, assignmentId = '', branchId = '') {
  const assign = assignmentId ? ctx.db.shiftAssignments.get(assignmentId) : undefined;
  const tpl = findBranchShiftTemplate(ctx, shiftCode, branchId || assign?.branch_id || '');
  const fb = SHIFT_FALLBACK[shiftCode] ?? SHIFT_FALLBACK.CA_SANG!;
  const startAt = assign?.start_at || tpl?.start_time || fb.start;
  const endAt = assign?.end_at || tpl?.end_time || fb.end;
  const scheduledHours = assign?.scheduled_hours || tpl?.standard_hours || fb.hours;
  const rawLabel = tpl?.name ?? DEFAULT_SHIFT_LABELS[shiftCode as keyof typeof DEFAULT_SHIFT_LABELS] ?? shiftCode;
  const shiftLabel = rawLabel.replace(/\s*\([^)]*\)\s*/g, '').trim();
  return { shiftLabel, startAt, endAt, scheduledHours, shiftTimeRange: `${startAt} – ${endAt}` };
}

/** Giải mã 1 mã/ID chi nhánh cụ thể từ chuỗi branch_scope (bỏ qua nếu là ALL) */
export function resolveSingleBranchId(ctx: AppContext, branchScope?: string): string | undefined {
  if (!branchScope) return undefined;
  const raw = branchScope.trim();
  if (!raw || raw === 'ALL') return undefined;
  const firstToken = raw.split(',')[0]?.trim();
  if (!firstToken || firstToken === 'ALL') return undefined;
  const found =
    ctx.db.branches.get(firstToken) ??
    ctx.db.branches.find((b) => b.code.trim().toUpperCase() === firstToken.toUpperCase());
  return found?.id;
}

/** Lấy branch_id hiện hành của nhân sự làm chuẩn cho mọi bảng nghiệp vụ (Lịch ca, Điểm danh, Nghỉ phép, Đổi ca) */
export function resolveEmployeeBranchId(ctx: AppContext, employeeId: string, fallbackBranchId = ''): string {
  if (!employeeId) return fallbackBranchId;
  const emp =
    ctx.db.employees.get(employeeId) ??
    ctx.db.employees.find((e) => e.employee_code.trim().toUpperCase() === employeeId.trim().toUpperCase());
  if (!emp) return fallbackBranchId;
  const linkedUser = findLinkedUserForEmployee(emp, ctx);
  const userBranchId = linkedUser ? resolveSingleBranchId(ctx, linkedUser.branch_scope) : undefined;
  if (userBranchId && userBranchId !== emp.branch_id && (linkedUser?.updated_at ?? '') > (emp.updated_at ?? '')) {
    return userBranchId;
  }
  return emp.branch_id || fallbackBranchId;
}

/** Khi nhân sự chuyển chi nhánh, đồng bộ branch_id cho toàn bộ ca làm việc, điểm danh, đơn nghỉ và đổi ca của nhân sự đó */
export async function cascadeEmployeeBranchChange(
  ctx: AppContext,
  emp: Employee,
  newBranchId: string,
  actorId: string,
): Promise<void> {
  if (!newBranchId) return;
  const matchEmp = (eid: string) => eid === emp.id || eid.trim().toUpperCase() === emp.employee_code.trim().toUpperCase();
  const move = <T extends { id: string; version: number }>(store: { update: (id: string, v: number, p: { branch_id: string }, a: string) => Promise<T> }, row: T) =>
    tolerantWrite(() => store.update(row.id, row.version, { branch_id: newBranchId }, actorId));

  for (const a of ctx.db.shiftAssignments.filter((x) => matchEmp(x.employee_id) && x.branch_id !== newBranchId)) await move(ctx.db.shiftAssignments, a);
  for (const l of ctx.db.leaveRequests.filter((x) => matchEmp(x.employee_id) && x.branch_id !== newBranchId)) await move(ctx.db.leaveRequests, l);
  for (const s of ctx.db.shiftSwaps.filter((x) => matchEmp(x.requester_id) && x.branch_id !== newBranchId)) await move(ctx.db.shiftSwaps, s);
  for (const e of ctx.db.emergencyLeaves.filter((x) => matchEmp(x.employee_id) && x.branch_id !== newBranchId)) await move(ctx.db.emergencyLeaves, e);
  for (const ev of ctx.db.attendanceEvents.filter((x) => matchEmp(x.employee_id) && x.branch_id !== newBranchId)) await move(ctx.db.attendanceEvents, ev);
  for (const adj of ctx.db.attendanceAdjustments.filter((x) => matchEmp(x.employee_id) && x.branch_id !== newBranchId)) await move(ctx.db.attendanceAdjustments, adj);
}

const healsInFlight = new WeakMap<object, Promise<void>>();
const lastHealSig = new WeakMap<object, string>();

function computeHealSig(ctx: AppContext): string {
  const verSum = (rows: readonly { version: number }[]) => {
    let s = rows.length;
    for (let i = 0; i < rows.length; i++) s += rows[i]!.version;
    return s;
  };
  return `${Math.floor(Date.now() / 60_000)}:${verSum(ctx.db.users.all())}:${verSum(ctx.db.employees.all())}:${verSum(ctx.db.shiftAssignments.all())}:${verSum(ctx.db.leaveRequests.all())}:${verSum(ctx.db.attendanceEvents.all())}:${verSum(ctx.db.attendanceAdjustments.all())}`;
}

/**
 * Tự động đồng bộ & làm sạch lệch chi nhánh giữa Tài khoản <-> Hồ sơ nhân sự <-> Lịch phân ca & Điểm danh.
 * Bỏ qua tức thì nếu dữ liệu trong bộ nhớ đệm không thay đổi trong cùng phút hiện tại.
 */
export function healBranchConsistency(ctx: AppContext, actorId = 'system-sync'): Promise<void> {
  const sig = computeHealSig(ctx);
  if (lastHealSig.get(ctx.db) === sig) return Promise.resolve();
  return singleFlight(healsInFlight, ctx.db, async () => {
    await runHeal(ctx, actorId);
    lastHealSig.set(ctx.db, computeHealSig(ctx));
  });
}

async function runHeal(ctx: AppContext, actorId: string): Promise<void> {
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
          await tolerantWrite(() => ctx.db.employees.update(emp.id, emp.version, { branch_id: userBranchId }, actorId));
        } else if (isBranchRole || linkedUser.branch_scope !== 'ALL') {
          await tolerantWrite(() => ctx.db.users.update(linkedUser.id, linkedUser.version, { branch_scope: emp.branch_id }, actorId));
        }
      } else if (!userBranchId && isBranchRole && emp.branch_id) {
        await tolerantWrite(() => ctx.db.users.update(linkedUser.id, linkedUser.version, { branch_scope: emp.branch_id }, actorId));
      }
    }
    if (effectiveBranchId) await cascadeEmployeeBranchChange(ctx, emp, effectiveBranchId, actorId);
  }
  const hasEventAssignIds = new Set(ctx.db.attendanceEvents.all().map((ev) => ev.assignment_id));
  for (const l of ctx.db.leaveRequests.filter((x) => x.status === 'APPROVED')) {
    const emp = ctx.db.employees.get(l.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === l.employee_id);
    const matchEmp = (eid: string) => eid === l.employee_id || Boolean(emp && (eid === emp.id || eid === emp.employee_code));
    for (const s of ctx.db.shiftAssignments.filter((a) => matchEmp(a.employee_id) && a.work_date === l.leave_date)) {
      if (!hasEventAssignIds.has(s.id)) await tolerantWrite(() => ctx.db.shiftAssignments.softDelete(s.id, s.version, actorId));
    }
  }
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
  if (branchId && (isBranchScopedRole || targetUser.branch_scope !== 'ALL')) userPatch.branch_scope = branchId;
  if (stage === 'OFFICIAL' && targetUser.role === 'THU_VIEC') userPatch.role = 'CHINH_THUC';
  else if (stage === 'PROBATION' && targetUser.role === 'CHINH_THUC') userPatch.role = 'THU_VIEC';
  await ctx.db.users.update(targetUser.id, targetUser.version, userPatch, actorId);
  return targetUser.id;
}

/** Phát tín hiệu Socket.IO đồng bộ Lịch làm việc, Ca làm & Đơn từ tới đúng Room Chi nhánh và Tài khoản nhân sự */
export function emitScheduleRealtime(
  ctx: AppContext,
  event: string,
  opts: { branchId?: string; employeeIds?: (string | undefined)[]; kind?: string; message?: string; actorId?: string },
): void {
  const rt = ctx.realtime();
  if (!rt) return;
  const payload = { kind: opts.kind ?? 'SCHEDULE_SYNC', branchId: opts.branchId ?? '', message: opts.message ?? '', actorId: opts.actorId ?? '' };
  if (opts.branchId && opts.branchId !== 'ALL') rt.toBranch(opts.branchId, event, payload);
  else rt.broadcast(event, payload);
  for (const rawId of opts.employeeIds ?? []) {
    if (!rawId) continue;
    const emp = ctx.db.employees.get(rawId) ?? ctx.db.employees.find((e) => e.employee_code === rawId);
    const u = emp ? findLinkedUserForEmployee(emp, ctx) : undefined;
    if (u) rt.toUser(u.id, event, payload);
  }
}
