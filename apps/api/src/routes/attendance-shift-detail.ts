import type { FastifyInstance } from 'fastify';
import { ADJUSTMENT_PUNCH_TYPE_LABELS, type AttendanceEvent } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { assertBranchAccess, requirePermission } from '../plugins/auth-context.js';
import { findBranchShiftTemplate, resolveEmployeeBranchId } from './account-employee-sync.js';
import { mapAttendanceEvent, migrateLegacyBase64Photos } from './attendance-helpers.js';
import { resolveShiftLabel } from './employee-mapper.js';

function sortEventsLatestFirst(list: AttendanceEvent[]): AttendanceEvent[] {
  return [...list].sort((a, b) => {
    const ta = Date.parse(a.server_time), tb = Date.parse(b.server_time);
    return !Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb ? tb - ta : b.server_time.localeCompare(a.server_time);
  });
}

export function registerShiftAttendanceDetailRoute(app: FastifyInstance, ctx: AppContext): void {
  app.get(
    '/api/admin/attendance/shift-detail/:assignmentId',
    { preHandler: requirePermission('attendance.read', 'schedule.read', 'self.attendance', 'self.schedule') },
    async (request) => {
      const { assignmentId } = request.params as { assignmentId: string };
      void migrateLegacyBase64Photos(ctx);
      const assign = ctx.db.shiftAssignments.get(assignmentId);
      if (!assign) throw Errors.notFound('Ca làm việc phân công', assignmentId);

      const emp = ctx.db.employees.get(assign.employee_id) ?? ctx.db.employees.find((x) => x.employee_code === assign.employee_id);
      const branchId = resolveEmployeeBranchId(ctx, assign.employee_id, assign.branch_id);
      const perms = request.auth!.permissions;
      const caller = request.auth!.user;
      if (!perms.has('attendance.read') && !perms.has('schedule.read')) {
        const isSelf = Boolean(emp && (emp.user_id === caller.id || caller.employee_id === emp.id || caller.employee_id === emp.employee_code));
        if (!isSelf) throw Errors.forbidden('Bạn chỉ được phép xem chi tiết điểm danh của chính mình');
      } else {
        assertBranchAccess(request, branchId);
      }

      const isSameEmp = (empIdRaw: string) =>
        empIdRaw === assign.employee_id || Boolean(emp && (empIdRaw === emp.id || empIdRaw === emp.employee_code));

      const directEvents = sortEventsLatestFirst(ctx.db.attendanceEvents.filter((e) => e.assignment_id === assign.id));
      const fallbackEvents = sortEventsLatestFirst(
        ctx.db.attendanceEvents.filter((e) => e.assignment_id !== assign.id && isSameEmp(e.employee_id) && e.work_date === assign.work_date && e.shift_code === assign.shift_code),
      );

      const inEv = directEvents.find((e) => e.type === 'CHECK_IN') ?? fallbackEvents.find((e) => e.type === 'CHECK_IN') ?? null;
      const rawOutEv = directEvents.find((e) => e.type === 'CHECK_OUT') ?? fallbackEvents.find((e) => e.type === 'CHECK_OUT') ?? null;

      const matchedAdjs = ctx.db.attendanceAdjustments.filter(
        (adj) => adj.assignment_id === assign.id || (isSameEmp(adj.employee_id) && adj.work_date === assign.work_date && adj.shift_code === assign.shift_code),
      );
      const approvedCompletionAdj = matchedAdjs.find((a) => a.status === 'APPROVED' && a.punch_type !== 'CHECK_IN') ?? null;
      const approvedCheckInAdj = matchedAdjs.find((a) => a.status === 'APPROVED' && a.punch_type === 'CHECK_IN') ?? null;
      const latestAdj = approvedCompletionAdj ?? approvedCheckInAdj ?? matchedAdjs[matchedAdjs.length - 1] ?? null;

      const tpl = findBranchShiftTemplate(ctx, assign.shift_code, branchId);
      const startAt = assign.start_at || tpl?.start_time || '07:00';
      const endAt = assign.end_at || tpl?.end_time || '12:00';
      const isCompleted = assign.status === 'COMPLETED' || Boolean(inEv && rawOutEv) || Boolean(approvedCompletionAdj);

      const outEv: AttendanceEvent | null = rawOutEv ?? (isCompleted && inEv
        ? {
            ...inEv,
            id: `${inEv.id}_auto_out`,
            type: 'CHECK_OUT',
            scheduled_time: endAt,
            server_time: `${assign.work_date}T${approvedCompletionAdj?.requested_check_out_at || endAt}:00+07:00`,
            late_minutes: 0,
            early_leave_minutes: 0,
            photo_id: '',
            photo_drive_file_id: approvedCompletionAdj?.evidence_file_id || '',
            note: approvedCompletionAdj ? `Xác nhận giờ Ra ca theo phiếu bổ sung công ${approvedCompletionAdj.adjustment_code}` : 'Đã hoàn thành ca (Xác nhận bổ sung giờ ra ca)',
          }
        : null);

      const mappedIn = inEv ? mapAttendanceEvent(inEv, ctx) : null;
      const mappedOut = outEv ? mapAttendanceEvent(outEv, ctx) : null;
      const branch = (emp ? ctx.db.branches.get(emp.branch_id) : undefined) ?? ctx.db.branches.get(branchId);
      const shiftLabel = resolveShiftLabel(ctx, assign.shift_code, branch?.id ?? branchId).replace(/\s*\([^)]*\)\s*/g, '').trim();
      const employeeName = emp ? `${emp.full_name} (${emp.employee_code})` : assign.employee_id;
      const base = mappedIn ?? mappedOut;
      const mappedAdjs = matchedAdjs.map((a) => ({
        id: a.id,
        adjustment_code: a.adjustment_code,
        kind: a.kind,
        punch_type: a.punch_type,
        punchTypeLabel: ADJUSTMENT_PUNCH_TYPE_LABELS[a.punch_type],
        status: a.status,
        requested_check_in_at: a.requested_check_in_at,
        requested_check_out_at: a.requested_check_out_at,
        requested_hours: a.requested_hours,
        reason: a.reason,
        decision_reason: a.decision_reason,
        decided_at: a.decided_at,
      }));

      return sendSuccess(request, 'Lấy chi tiết điểm danh ca làm việc thành công', {
        ...(base ?? {
          id: `shift_${assign.id}`,
          assignment_id: assign.id,
          employee_id: emp?.id ?? assign.employee_id,
          branch_id: branch?.id ?? branchId,
          work_date: assign.work_date,
          shift_code: assign.shift_code,
          type: 'CHECK_IN' as const,
        }),
        assignmentId: assign.id,
        employeeId: emp?.id ?? assign.employee_id,
        employeeCode: emp?.employee_code ?? assign.employee_id,
        employeeName,
        branchName: branch?.name ?? 'Chi nhánh',
        branchLat: branch?.lat ?? null,
        branchLng: branch?.lng ?? null,
        branchRadiusM: branch?.radius_m ?? 100,
        shiftLabel,
        shiftTimeRange: `${startAt} – ${endAt}`,
        scheduledHours: assign.scheduled_hours,
        shiftStatus: isCompleted ? 'COMPLETED' : inEv ? 'CHECKED_IN' : assign.status,
        shiftNote: assign.note || '',
        hasRawCheckIn: Boolean(inEv),
        hasRawCheckOut: Boolean(rawOutEv),
        isAutoOut: Boolean(!rawOutEv && mappedOut),
        checkInEvent: mappedIn,
        checkOutEvent: mappedOut,
        adjustments: mappedAdjs,
        adjustment: latestAdj ? (mappedAdjs.find((x) => x.id === latestAdj.id) ?? mappedAdjs[mappedAdjs.length - 1] ?? null) : null,
      });
    },
  );
}
