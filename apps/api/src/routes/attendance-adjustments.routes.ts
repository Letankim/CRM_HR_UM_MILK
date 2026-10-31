import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ADJUSTMENT_PUNCH_TYPE_LABELS, isEmployeeRole, zListQueryBase, type AttendanceAdjustment } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { paginateAndSort } from '../lib/list-query.js';
import { sendPaginated, sendSuccess } from '../lib/response.js';
import { nowIso } from '../lib/time.js';
import { assertBranchAccess, auditContext, filterByBranch, requireAuth, requirePermission } from '../plugins/auth-context.js';
import { SocketEvents } from '../realtime/realtime.js';
import { queueAttendanceAdjustmentCreatedEmail, queueAttendanceAdjustmentDecidedEmails } from '../services/action-email-dispatcher.js';
import { ensureSyncedNotifications } from '../services/notification-sync.service.js';
import { assertDateNotLockedByPayroll } from '../services/salary-profile.service.js';
import { applyApprovedAdjustmentToShift, assertNoDuplicateAdjustment } from '../services/shift-absent-scanner.js';
import { emitScheduleRealtime, resolveEmployeeBranchId, resolveShiftTimeDetails } from './account-employee-sync.js';
import { buildShiftFolderName, persistAttendancePhoto } from './attendance-photo-storage.js';

const zCreateAdjustmentBody = z.object({
  employee_id: z.string().trim().min(1, 'Vui lòng chọn nhân sự'), assignment_id: z.string().trim().optional().default(''), event_id: z.string().trim().optional().default(''),
  work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Định dạng ngày YYYY-MM-DD'), shift_code: z.string().default('CA_SANG'),
  kind: z.enum(['FORGOT_CHECK_IN', 'FORGOT_CHECK_OUT', 'GPS_ERROR', 'CAMERA_ERROR', 'OTHER']).default('FORGOT_CHECK_OUT'),
  punch_type: z.enum(['CHECK_IN', 'CHECK_OUT', 'FULL_SHIFT'], { errorMap: () => ({ message: 'Loại phiếu phải là Lỗi Vào ca, Lỗi Ra ca hoặc Bù công cả ca' }) }).optional(),
  requested_check_in_at: z.string().default('07:00'), requested_check_out_at: z.string().default('12:00'), requested_hours: z.coerce.number().min(0.5).max(24).default(5),
  reason: z.string().trim().min(3, 'Vui lòng nhập lý do bổ sung / điều chỉnh công').max(300),
  evidence_photo_base64: z.string().max(12_000_000, 'Ảnh minh chứng quá lớn (tối đa khoảng 8MB)').optional().default(''),
});
const zDecideAdjustmentBody = z.object({ version: z.coerce.number().int().min(1), action: z.enum(['STORE_CONFIRM', 'HR_APPROVE', 'HR_REJECT']), decision_reason: z.string().trim().max(300).optional().default('') });

/** Loại lượt chấm công mặc định suy ra từ loại sự cố (khi client không gửi punch_type). */
const inferPunchType = (kind: string): 'CHECK_IN' | 'CHECK_OUT' | 'FULL_SHIFT' => (kind === 'FORGOT_CHECK_IN' ? 'CHECK_IN' : kind === 'FORGOT_CHECK_OUT' ? 'CHECK_OUT' : 'FULL_SHIFT');

export function mapAdjustmentRecord(ctx: AppContext, a: AttendanceAdjustment) {
  const emp = ctx.db.employees.get(a.employee_id) ?? ctx.db.employees.find((x) => x.employee_code === a.employee_id), branch = (emp ? ctx.db.branches.get(emp.branch_id) : undefined) ?? ctx.db.branches.get(a.branch_id);
  const photo = a.evidence_file_id && a.evidence_file_id !== 'demo_camera_selfie' ? (a.evidence_file_id.startsWith('data:image/') ? a.evidence_file_id : `/api/attendance/photos/${encodeURIComponent(a.evidence_file_id)}`) : null;
  return { ...a, ...resolveShiftTimeDetails(ctx, a.shift_code, a.assignment_id), branch_id: branch?.id ?? a.branch_id, employeeId: emp?.id ?? a.employee_id, employeeCode: emp?.employee_code ?? a.employee_id, employeeName: emp ? `${emp.full_name} (${emp.employee_code})` : a.employee_id, branchName: branch?.name ?? 'Chi nhánh', punchTypeLabel: ADJUSTMENT_PUNCH_TYPE_LABELS[a.punch_type], evidencePhotoUrl: photo };
}

export function registerAttendanceAdjustmentRoutes(app: FastifyInstance, ctx: AppContext): void {
  const handleGetAdjustments = async (request: Parameters<typeof sendPaginated>[0]) => {
    const query = zListQueryBase.extend({ branch_id: z.string().trim().optional(), status: z.string().trim().optional() }).parse(request.query ?? {});
    const scoped = filterByBranch(request, ctx.db.attendanceAdjustments.all(), (a) => resolveEmployeeBranchId(ctx, a.employee_id, a.branch_id));
    const mapped = scoped.map((a) => mapAdjustmentRecord(ctx, a)).filter((a) => (!query.branch_id || query.branch_id === 'ALL' || a.branch_id === query.branch_id) && (!query.status || query.status === 'ALL' || a.status === query.status));
    return sendPaginated(request, 'Lấy danh sách phiếu bổ sung và điều chỉnh công thành công', paginateAndSort(mapped, { page: query.page, perPage: query.per_page, defaultSortBy: 'created_at', defaultSortOrder: 'desc', allowedSortFields: ['created_at', 'work_date', 'status'], q: query.q, searchExtractor: (i) => [i.adjustment_code, i.employeeCode, i.employeeName, i.reason, i.work_date], filters: { branch_id: query.branch_id, status: query.status } }));
  };
  const perms = requirePermission('attendance.read', 'adjustment.approve', 'attendance.confirm', 'self.adjustment');
  app.get('/api/admin/attendance/adjustments', { preHandler: perms }, handleGetAdjustments);
  app.get('/api/admin/attendance-adjustments', { preHandler: perms }, handleGetAdjustments);

  app.post('/api/admin/attendance/adjustments', { preHandler: requireAuth() }, async (request, reply) => {
    const body = zCreateAdjustmentBody.parse(request.body), emp = ctx.db.employees.get(body.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === body.employee_id);
    if (!emp) throw Errors.fieldValidation('employee_id', 'INVALID_VALUE', 'Không tìm thấy nhân sự', body.employee_id);
    const caller = request.auth!.user, perms = request.auth!.permissions;
    const isSelfEmp = emp.user_id === caller.id || Boolean(caller.employee_id && (emp.id === caller.employee_id || emp.employee_code === caller.employee_id));
    if (!isSelfEmp && !perms.has('attendance.confirm') && !perms.has('adjustment.approve')) {
      throw Errors.forbidden('Vai trò của bạn chỉ có quyền xem lịch và điểm danh, không được phép tạo phiếu bổ sung công cho nhân sự khác');
    }
    const punchType = body.punch_type ?? inferPunchType(body.kind);
    const hasEvidence = /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(body.evidence_photo_base64);
    if (isSelfEmp && isEmployeeRole(caller.role) && !hasEvidence) throw Errors.fieldValidation('evidence_photo_base64', 'REQUIRED_FIELD', 'Vui lòng chụp hoặc tải lên ảnh minh chứng để HR xem xét phiếu chấm công lỗi', '');
    const matchedShift = (body.assignment_id ? ctx.db.shiftAssignments.get(body.assignment_id) : undefined) ?? ctx.db.shiftAssignments.find((a) => (a.employee_id === emp.id || a.employee_id === emp.employee_code) && a.work_date === body.work_date && a.shift_code === body.shift_code);
    const effectiveBranchId = resolveEmployeeBranchId(ctx, emp.id, matchedShift?.branch_id || emp.branch_id);
    assertBranchAccess(request, effectiveBranchId);
    const workDate = matchedShift?.work_date ?? body.work_date, shiftCode = matchedShift?.shift_code ?? body.shift_code;
    assertDateNotLockedByPayroll(ctx.db, workDate, 'tạo phiếu bổ sung công');
    assertNoDuplicateAdjustment(ctx.db, emp, matchedShift?.id ?? body.assignment_id, workDate, shiftCode, punchType);
    const shiftStart = matchedShift?.start_at || body.requested_check_in_at, shiftEnd = matchedShift?.end_at || body.requested_check_out_at, shiftHours = matchedShift?.scheduled_hours || body.requested_hours;
    const meta = resolveShiftTimeDetails(ctx, shiftCode, matchedShift?.id ?? '', effectiveBranchId);
    const evidence = hasEvidence ? await persistAttendancePhoto(ctx, { base64: body.evidence_photo_base64, employeeCode: emp.employee_code, checkType: 'EVIDENCE', workDate, shiftFolder: buildShiftFolderName(meta.shiftLabel, shiftCode, shiftStart, shiftEnd), rootFolder: 'EVIDENCE' }) : null;
    const created = await ctx.db.attendanceAdjustments.insert({
      adjustment_code: `ADJ-${String(ctx.db.attendanceAdjustments.all(true).length + 1).padStart(4, '0')}`, event_id: body.event_id, assignment_id: matchedShift?.id ?? body.assignment_id, employee_id: emp.id, branch_id: effectiveBranchId,
      work_date: workDate, shift_code: shiftCode, kind: body.kind, punch_type: punchType, requested_time: punchType === 'CHECK_IN' ? shiftStart : shiftEnd,
      requested_check_in_at: punchType === 'CHECK_OUT' ? shiftStart : (body.requested_check_in_at || shiftStart), requested_check_out_at: punchType === 'CHECK_IN' ? shiftEnd : (body.requested_check_out_at || shiftEnd), requested_hours: shiftHours,
      reason: body.reason, evidence_file_id: evidence?.fileId ?? '', exception_source: isSelfEmp ? 'EMPLOYEE' : 'MANAGER', status: 'PENDING', store_confirmed_by: '', store_confirmed_at: '', store_note: '', hr_decision: 'PENDING', decided_by: '', decision_reason: '', decided_at: '', record_id: '', applied_to_record: false,
    }, caller.id);
    queueAttendanceAdjustmentCreatedEmail(ctx, created, caller.id);
    await ensureSyncedNotifications(ctx);
    await ctx.audit.record(auditContext(request), { action: 'attendance.adjustment.create', entity: 'ATTENDANCE_ADJUSTMENTS', entityId: created.id, after: { adjustment_code: created.adjustment_code, assignment_id: created.assignment_id, punch_type: created.punch_type, has_evidence: Boolean(evidence) } });
    emitScheduleRealtime(ctx, SocketEvents.ATTENDANCE, { branchId: effectiveBranchId, employeeIds: [emp.id], kind: 'ADJUSTMENT_CREATED', message: `${emp.full_name} (${emp.employee_code}) vừa gửi ${ADJUSTMENT_PUNCH_TYPE_LABELS[punchType].toLowerCase()} ${created.adjustment_code} chờ duyệt`, actorId: caller.id });
    return reply.code(201), sendSuccess(request, `Đã gửi phiếu ${ADJUSTMENT_PUNCH_TYPE_LABELS[punchType].toLowerCase()} kèm minh chứng — chờ HR phê duyệt`, mapAdjustmentRecord(ctx, created));
  });

  app.post('/api/admin/attendance/adjustments/:id/decide', { preHandler: requirePermission('attendance.confirm', 'adjustment.approve') }, async (request) => {
    const { id } = request.params as { id: string }, body = zDecideAdjustmentBody.parse(request.body), before = ctx.db.attendanceAdjustments.get(id);
    if (!before) throw Errors.notFound('Phiếu bổ sung công', id);
    assertBranchAccess(request, resolveEmployeeBranchId(ctx, before.employee_id, before.branch_id));
    assertDateNotLockedByPayroll(ctx.db, before.work_date, 'xử lý phiếu bổ sung công');
    const actorId = request.auth!.user.id;
    const patch = body.action === 'STORE_CONFIRM' ? { status: 'STORE_CONFIRMED' as const, store_confirmed_by: actorId, store_confirmed_at: nowIso(), store_note: body.decision_reason } : body.action === 'HR_APPROVE' ? { status: 'APPROVED' as const, hr_decision: 'APPROVED', decided_by: actorId, decision_reason: body.decision_reason, decided_at: nowIso(), applied_to_record: true } : { status: 'REJECTED' as const, hr_decision: 'REJECTED', decided_by: actorId, decision_reason: body.decision_reason, decided_at: nowIso(), applied_to_record: false };
    const updated = await ctx.db.attendanceAdjustments.update(id, body.version, patch, actorId);
    if (body.action === 'HR_APPROVE') await applyApprovedAdjustmentToShift(ctx.db, id, actorId);
    queueAttendanceAdjustmentDecidedEmails(ctx, updated, body.action, actorId);
    await ensureSyncedNotifications(ctx);
    await ctx.audit.record(auditContext(request), { action: 'attendance.adjustment.decide', entity: 'ATTENDANCE_ADJUSTMENTS', entityId: id, before: { status: before.status }, after: { status: updated.status, hr_decision: updated.hr_decision } });
    emitScheduleRealtime(ctx, SocketEvents.ATTENDANCE, { branchId: before.branch_id, employeeIds: [before.employee_id], kind: body.action === 'STORE_CONFIRM' ? 'ADJUSTMENT_STORE_CONFIRMED' : 'ADJUSTMENT_DECIDED', message: `Phiếu bổ sung công ${updated.adjustment_code} ngày ${updated.work_date} đã ${body.action === 'STORE_CONFIRM' ? 'được Cửa hàng xác nhận' : body.action === 'HR_APPROVE' ? 'được HR phê duyệt' : 'bị từ chối'}`, actorId });
    const approvedMsg = before.punch_type === 'CHECK_IN' ? 'Đã phê duyệt minh chứng — ghi nhận Vào ca thành công' : before.punch_type === 'CHECK_OUT' ? 'Đã phê duyệt minh chứng — ghi nhận Ra ca, ca làm việc hoàn thành' : 'Đã phê duyệt phiếu bổ sung công và cập nhật trạng thái hoàn thành ca làm việc';
    return sendSuccess(request, body.action === 'STORE_CONFIRM' ? 'Cửa hàng đã xác nhận phiếu bổ sung công để chuyển HR duyệt' : body.action === 'HR_APPROVE' ? approvedMsg : 'Đã từ chối phiếu bổ sung công', mapAdjustmentRecord(ctx, updated));
  });
}
