import { DEFAULT_SHIFT_LABELS, EMPLOYEE_STAGE_LABELS, type Employee } from '@umbm/shared';
import type { AppContext } from '../context.js';

export function buildEmployeeDossierSummary(e: Employee, ctx: AppContext) {
  const isEmp = (eid: string) => eid === e.id || eid === e.employee_code;

  const assignments = ctx.db.shiftAssignments.filter((a) => isEmp(a.employee_id) && a.day_type !== 'OFF');
  const completedOrPublished = assignments.filter((a) => a.status === 'PUBLISHED' || a.status === 'COMPLETED');
  const probationHoursCompleted = completedOrPublished.reduce((sum, a) => sum + (Number(a.scheduled_hours) || 5), 0);
  const recentShifts = assignments
    .slice()
    .sort((a, b) => b.work_date.localeCompare(a.work_date))
    .slice(0, 8)
    .map((a) => ({
      id: a.id,
      work_date: a.work_date,
      shift_code: a.shift_code,
      shiftLabel: DEFAULT_SHIFT_LABELS[a.shift_code as keyof typeof DEFAULT_SHIFT_LABELS] ?? a.shift_code,
      start_at: a.start_at,
      end_at: a.end_at,
      scheduled_hours: a.scheduled_hours,
      status: a.status,
    }));

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
    .map((h) => ({
      id: h.id,
      fromStage: h.from_stage,
      fromStageLabel: EMPLOYEE_STAGE_LABELS[h.from_stage as keyof typeof EMPLOYEE_STAGE_LABELS] ?? h.from_stage,
      toStage: h.to_stage,
      toStageLabel: EMPLOYEE_STAGE_LABELS[h.to_stage as keyof typeof EMPLOYEE_STAGE_LABELS] ?? h.to_stage,
      effectiveFrom: h.effective_from,
      decidedBy: h.decided_by,
      probationHoursCompleted: h.probation_hours_completed,
      testScorePercent: h.test_score_percent,
      evaluationSummary: h.evaluation_summary || h.note,
      note: h.note,
    }));

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
