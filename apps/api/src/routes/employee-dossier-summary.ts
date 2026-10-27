import { EMPLOYEE_STAGE_LABELS, ROLE_LABELS, type Employee } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { resolveShiftLabel } from './employee-mapper.js';

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

  const assignments = ctx.db.shiftAssignments.filter((a) => isEmp(a.employee_id) && a.day_type !== 'OFF');
  const completedOrPublished = assignments.filter((a) => a.status === 'PUBLISHED' || a.status === 'COMPLETED');
  const probationHoursCompleted = completedOrPublished.reduce((sum, a) => sum + (Number(a.scheduled_hours) || 5), 0);
  const recentShifts = assignments
    .slice()
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

  const leaveRequestsCount = ctx.db.leaveRequests.filter((l) => isEmp(l.employee_id)).length;
  const swapRequestsCount = ctx.db.shiftSwaps.filter((s) => isEmp(s.requester_id) || isEmp(s.peer_id)).length;

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
  };
}
