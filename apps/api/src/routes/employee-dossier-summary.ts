import { CONTRACT_TYPE_LABELS, EMPLOYEE_STAGE_LABELS, ROLE_LABELS, type Employee, type EmployeeContractItem, type LeaveRequest, type ShiftAssignment, type ShiftSwap } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { readPartitionRegistry } from '../services/data-partition.service.js';
import { getCachedPartitionStore } from '../services/partition-write-router.js';
import { resolveShiftLabel } from './employee-mapper.js';

function parseContractsSafe(raw?: string | null): EmployeeContractItem[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as EmployeeContractItem[]).slice().sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
  } catch {
    return [];
  }
}

function resolveActorInfo(ctx: AppContext, rawActor: string, fallbackName = '') {
  const actor = (rawActor || '').trim();
  if (actor) {
    const user = ctx.db.users.get(actor) ?? ctx.db.users.find((u) => u.username === actor || u.employee_id === actor);
    if (user) {
      return {
        name: user.display_name || fallbackName || user.username,
        sub: user.username ? `@${user.username}` : '',
        roleLabel: ROLE_LABELS[user.role as keyof typeof ROLE_LABELS] ?? 'Quản trị nhân sự',
      };
    }
    const emp = ctx.db.employees.get(actor) ?? ctx.db.employees.find((x) => x.employee_code === actor);
    if (emp) {
      return { name: emp.full_name, sub: emp.employee_code, roleLabel: 'Nhân sự' };
    }
  }
  if (fallbackName && !/^[0-9A-Z]{26}$/.test(fallbackName)) {
    return { name: fallbackName, sub: '', roleLabel: 'Quản lý Nhân sự' };
  }
  const sysMap: Record<string, string> = {
    hr: 'Phòng Nhân sự (HR)',
    admin: 'Quản trị hệ thống',
    owner: 'Chủ dự án',
    system: 'Hệ thống nhân sự',
    seed: 'Hệ thống nhân sự',
  };
  return {
    name: sysMap[actor.toLowerCase()] ?? (actor && !/^[0-9A-Z]{26}$/.test(actor) ? actor : 'Phòng Nhân sự (HR)'),
    sub: actor && sysMap[actor.toLowerCase()] && actor !== 'system' && actor !== 'seed' ? `@${actor}` : '',
    roleLabel: 'Quản trị nhân sự',
  };
}

export function buildEmployeeDossierSummary(e: Employee, ctx: AppContext) {
  const isEmp = (eid: string) => eid === e.id || eid === e.employee_code;
  const regMonths = readPartitionRegistry(ctx.db).map((r) => r.monthKey);
  const monthsToRead = regMonths.length > 0 ? Array.from(new Set([...regMonths, ...(ctx.db.partitionMonth ? [ctx.db.partitionMonth] : [])])) : [ctx.db.partitionMonth];

  const assignMap = new Map<string, ShiftAssignment>();
  const leaveMap = new Map<string, LeaveRequest>();
  const swapMap = new Map<string, ShiftSwap>();
  for (const mk of monthsToRead) {
    const sStore = getCachedPartitionStore<ShiftAssignment>(ctx.db, 'SHIFT_ASSIGNMENTS', mk) ?? (mk === ctx.db.partitionMonth ? ctx.db.shiftAssignments : undefined);
    if (sStore) for (const a of sStore.all()) if (isEmp(a.employee_id) && a.day_type !== 'OFF' && !assignMap.has(a.id)) assignMap.set(a.id, a);
    const lStore = getCachedPartitionStore<LeaveRequest>(ctx.db, 'LEAVE_REQUESTS', mk) ?? (mk === ctx.db.partitionMonth ? ctx.db.leaveRequests : undefined);
    if (lStore) for (const l of lStore.all()) if (isEmp(l.employee_id) && !leaveMap.has(l.id)) leaveMap.set(l.id, l);
    const swStore = getCachedPartitionStore<ShiftSwap>(ctx.db, 'SHIFT_SWAPS', mk) ?? (mk === ctx.db.partitionMonth ? ctx.db.shiftSwaps : undefined);
    if (swStore) for (const s of swStore.all()) if ((isEmp(s.requester_id) || isEmp(s.peer_id)) && !swapMap.has(s.id)) swapMap.set(s.id, s);
  }

  const assignments = Array.from(assignMap.values());
  const completedOrPublished = assignments.filter((a) => a.status === 'PUBLISHED' || a.status === 'COMPLETED');
  const probationHoursCompleted = completedOrPublished.reduce((sum, a) => sum + (Number(a.scheduled_hours) || 5), 0);
  const recentShifts = assignments
    .slice()
    .reverse()
    .sort((a, b) => b.work_date.localeCompare(a.work_date))
    .slice(0, 50)
    .map((a) => {
      const assignedBy = resolveActorInfo(ctx, a.created_by);
      return {
        id: a.id,
        work_date: a.work_date,
        shift_code: a.shift_code,
        shiftLabel: resolveShiftLabel(ctx, a.shift_code, a.branch_id || e.branch_id),
        branchName: ctx.db.branches.get(a.branch_id || e.branch_id)?.name ?? '',
        start_at: a.start_at,
        end_at: a.end_at,
        scheduled_hours: a.scheduled_hours,
        status: a.status,
        note: a.note || '',
        assignedByName: assignedBy.name,
        assignedByRoleLabel: assignedBy.roleLabel,
      };
    });

  const testAssigns = ctx.db.testAssignments.filter((ta) => isEmp(ta.employee_id));
  const testAttempts = ctx.db.testAttempts.filter((at) => isEmp(at.employee_id));
  const bestScorePercent = Math.max(
    0,
    ...testAssigns.map((ta) => Number(ta.best_score_percent) || 0),
    ...testAttempts.map((at) => Number(at.score_percent) || 0),
  );
  const testPassed = testAssigns.some((ta) => ta.passed || ta.status === 'PASSED') || testAttempts.some((at) => at.passed);

  const stageHistory = ctx.db.employeeStageHistory
    .filter((h) => isEmp(h.employee_id))
    .reverse()
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))
    .map((h) => {
      const actor = resolveActorInfo(ctx, h.decided_by || h.created_by, h.approved_by);
      return {
        id: h.id,
        fromStage: h.from_stage,
        fromStageLabel: EMPLOYEE_STAGE_LABELS[h.from_stage as keyof typeof EMPLOYEE_STAGE_LABELS] ?? h.from_stage,
        toStage: h.to_stage,
        toStageLabel: EMPLOYEE_STAGE_LABELS[h.to_stage as keyof typeof EMPLOYEE_STAGE_LABELS] ?? h.to_stage,
        effectiveFrom: h.effective_from,
        decidedBy: actor.name,
        decidedBySub: actor.sub,
        decidedByRoleLabel: actor.roleLabel,
        probationHoursCompleted: h.probation_hours_completed,
        testScorePercent: h.test_score_percent,
        evaluationSummary: h.evaluation_summary || h.note || 'Đủ điều kiện chuyển giai đoạn theo quy định nhân sự',
        note: h.note || '',
        fromBranchName: ctx.db.branches.get(h.from_branch_id || e.branch_id)?.name ?? '',
        toBranchName: ctx.db.branches.get(h.to_branch_id || e.branch_id)?.name ?? '',
        fromShiftLabel: resolveShiftLabel(ctx, h.from_shift_code || e.default_shift_code, h.from_branch_id || e.branch_id),
        toShiftLabel: resolveShiftLabel(ctx, h.to_shift_code || e.default_shift_code, h.to_branch_id || e.branch_id),
        createdAt: h.created_at,
      };
    });

  const leaveRequestsCount = leaveMap.size;
  const swapRequestsCount = swapMap.size;
  const contracts = parseContractsSafe(e.contracts_json).map((c) => ({
    ...c,
    contractTypeLabel: CONTRACT_TYPE_LABELS[c.contractType] ?? c.contractType,
  }));
  const attendanceCreditPoints = typeof e.attendance_credit_points === 'number' && e.attendance_credit_points > 0 ? e.attendance_credit_points : 100;

  return {
    probationHoursCompleted,
    totalShiftsCount: assignments.length,
    recentShifts,
    testBestScorePercent: bestScorePercent,
    testPassed,
    testAssignedCount: testAssigns.length,
    testAttemptsCount: testAttempts.length,
    leaveRequestsCount,
    swapRequestsCount,
    stageHistory,
    contracts,
    contractsCount: contracts.length,
    attendanceCreditPoints,
    attendance_credit_points: attendanceCreditPoints,
    probationMeetDone: Boolean(e.probation_meet_done),
    probation_meet_done: Boolean(e.probation_meet_done),
    probationMeetNote: e.probation_meet_note || '',
    probation_meet_note: e.probation_meet_note || '',
    emergencyLeaveGrantCount: Number(e.emergency_leave_grant_count) || 0,
    emergency_leave_grant_count: Number(e.emergency_leave_grant_count) || 0,
  };
}
