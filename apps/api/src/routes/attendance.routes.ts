import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isEmployeeRole, zListQueryBase } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { paginateAndSort } from '../lib/list-query.js';
import { sendPaginated, sendSuccess } from '../lib/response.js';
import { dayjs, nowIso } from '../lib/time.js';
import { assertBranchAccess, auditContext, filterByBranch, requireAuth, requirePermission } from '../plugins/auth-context.js';
import { assertDateNotLockedByPayroll } from '../services/salary-profile.service.js';
import { runBackgroundSideEffect } from '../services/background-write.js';
import { formatGraceLabel, getShiftCheckoutWindow } from '../services/schedule-staffing-helper.js';
import { getOperationSettings } from '../services/operations-settings.service.js';
import { getVnNowDateAndHm } from '../services/shift-absent-scanner.js';
import { healBranchConsistency, resolveEmployeeBranchId, resolveShiftTimeDetails } from './account-employee-sync.js';
import { buildPaginatedAttendanceSessions, buildShiftFolderName, calculateHaversineMeters, describePunctuality, loadAttendancePhotoBuffer, mapAttendanceEvent, migrateLegacyBase64Photos, parseHm, persistAttendancePhoto } from './attendance-helpers.js';
import { registerShiftAttendanceDetailRoute } from './attendance-shift-detail.js';
import { registerAttendanceAdjustmentRoutes } from './attendance-adjustments.routes.js';
export { calculateHaversineMeters } from './attendance-helpers.js';

const zCheckInOutBody = z.object({
  assignment_id: z.string({ required_error: 'Vui lòng chọn ca làm việc đã phát hành' }).trim().min(1), type: z.enum(['CHECK_IN', 'CHECK_OUT']).optional(), kind: z.enum(['CHECK_IN', 'CHECK_OUT']).optional(),
  lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180), accuracy_m: z.coerce.number().min(0).max(5000).default(15),
  selfie_source: z.enum(['LIVE_CAMERA'], { message: 'Chỉ cho phép chụp ảnh trực tiếp từ Camera (LIVE_CAMERA), cấm tải ảnh từ thư viện' }).default('LIVE_CAMERA'),
  photo_base64: z.string().min(10, 'Vui lòng chụp ảnh khuôn mặt trực tiếp từ Camera').default('data:image/jpeg;base64,umbm_live_camera_selfie'),
  device_info: z.string().trim().max(200).optional().default('Mobile Browser HTTPS'), enforce_shift_state: z.boolean().optional().default(false), idempotency_key: z.string().trim().optional(),
});
const zUpdateAttendanceEventBody = z.object({
  version: z.coerce.number().int().min(1), type: z.enum(['CHECK_IN', 'CHECK_OUT']).optional(), work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  shift_code: z.string().trim().optional(), check_time_hm: z.string().regex(/^\d{2}:\d{2}$/).optional(), distance_m: z.coerce.number().int().min(0).max(5000).optional(), note: z.string().trim().max(300).optional(),
});
export async function attendanceRoutes(app: FastifyInstance, ctx: AppContext) {
  registerShiftAttendanceDetailRoute(app, ctx);
  registerAttendanceAdjustmentRoutes(app, ctx);
  app.get('/api/attendance/photos/:fileId', async (request, reply) => {
    const { fileId } = request.params as { fileId: string }, buf = await loadAttendancePhotoBuffer(ctx, fileId);
    if (!buf) throw Errors.notFound('Ảnh điểm danh trên Google Drive', fileId);
    return reply.header('Content-Type', 'image/jpeg').header('Cache-Control', 'public, max-age=31536000, immutable').send(buf);
  });
  app.get('/api/admin/attendance', { preHandler: requirePermission('attendance.read', 'self.attendance') }, async (request) => {
    void migrateLegacyBase64Photos(ctx); await runBackgroundSideEffect(() => healBranchConsistency(ctx));
    const rawEvents = [...filterByBranch(request, ctx.db.attendanceEvents.all(), (e) => resolveEmployeeBranchId(ctx, e.employee_id, e.branch_id))].reverse().slice(0, 200);
    const events = rawEvents.map((e) => mapAttendanceEvent(e, ctx));
    const adjustments = [...filterByBranch(request, ctx.db.attendanceAdjustments.all(), (a) => resolveEmployeeBranchId(ctx, a.employee_id, a.branch_id))].reverse().map((a) => {
      const emp = ctx.db.employees.get(a.employee_id) ?? ctx.db.employees.find((x) => x.employee_code === a.employee_id);
      const branch = (emp ? ctx.db.branches.get(emp.branch_id) : undefined) ?? ctx.db.branches.get(a.branch_id);
      return { ...a, ...resolveShiftTimeDetails(ctx, a.shift_code, a.assignment_id), branch_id: branch?.id ?? a.branch_id, employeeId: emp?.id ?? a.employee_id, employeeCode: emp?.employee_code ?? a.employee_id, employeeName: emp ? `${emp.full_name} (${emp.employee_code})` : a.employee_id, branchName: branch?.name ?? 'Chi nhánh' };
    });
    return sendSuccess(request, 'Lấy dữ liệu sự kiện chấm công gốc và phiếu bổ sung công thành công', { events, adjustments });
  });
  app.get('/api/admin/attendance/sessions', { preHandler: requirePermission('attendance.read', 'schedule.read', 'self.attendance') }, async (request) => {
    const query = zListQueryBase.extend({ branch_id: z.string().trim().optional(), shift_code: z.string().trim().optional(), status: z.string().trim().optional(), from_date: z.string().trim().optional(), to_date: z.string().trim().optional(), refresh: z.string().trim().optional() }).parse(request.query ?? {});
    if (query.refresh === '1') { await ctx.db.attendanceEvents.refreshIfIdle(); await healBranchConsistency(ctx); }
    else { await runBackgroundSideEffect(() => healBranchConsistency(ctx)); }
    void migrateLegacyBase64Photos(ctx);
    const scoped = filterByBranch(request, ctx.db.attendanceEvents.all(), (e) => resolveEmployeeBranchId(ctx, e.employee_id, e.branch_id));
    return sendPaginated(request, 'Lấy danh sách điểm danh Vào/Ra ca theo phiên làm việc thành công', buildPaginatedAttendanceSessions(ctx, scoped, query));
  });

  const handleGetEvents = async (request: Parameters<typeof sendPaginated>[0]) => {
    const query = zListQueryBase.parse(request.query ?? {});
    const scoped = filterByBranch(request, ctx.db.attendanceEvents.all(), (e) => resolveEmployeeBranchId(ctx, e.employee_id, e.branch_id));
    const pageRes = paginateAndSort(scoped, { page: query.page, perPage: query.per_page, defaultSortBy: 'server_time', defaultSortOrder: 'desc', allowedSortFields: ['server_time', 'work_date', 'distance_m'], q: query.q, searchExtractor: (i) => { const emp = ctx.db.employees.get(i.employee_id); return [i.employee_id, emp?.employee_code, emp?.full_name, i.work_date, i.shift_code, i.result]; } });
    return sendPaginated(request, 'Lấy danh sách sự kiện chấm công thành công', { items: pageRes.items.map((e) => mapAttendanceEvent(e, ctx)), meta: pageRes.meta });
  };
  app.get('/api/admin/attendance/events', { preHandler: requirePermission('attendance.read', 'schedule.read') }, handleGetEvents);
  app.get('/api/admin/attendance-events', { preHandler: requirePermission('attendance.read', 'schedule.read') }, handleGetEvents);

  app.post('/api/attendance/check', { preHandler: requireAuth() }, async (request, reply) => {
    if (request.auth!.user.role === 'MKT') throw Errors.forbidden('Tài khoản Truyền thông (MKT) không được phép truy cập chức năng điểm danh GPS');
    const body = zCheckInOutBody.parse(request.body);
    getOperationSettings(ctx.db);
    const checkType = body.type ?? body.kind ?? 'CHECK_IN';
    const assign = ctx.db.shiftAssignments.get(body.assignment_id);
    if (!assign) throw Errors.fieldValidation('assignment_id', 'INVALID_VALUE', 'Không tìm thấy ca phân công', body.assignment_id);
    if (assign.status === 'ABSENT') throw Errors.badRequest(`Ca làm việc (${assign.start_at || '07:00'} – ${assign.end_at || '12:00'} ngày ${dayjs(assign.work_date).format('DD/MM/YYYY')}) đã quá giờ kết thúc ca mà chưa điểm danh vào ca nên đã bị khóa và chuyển sang trạng thái Vắng mặt. Nếu muốn bù công, vui lòng gửi Phiếu bổ sung công.`);
    if (assign.status !== 'PUBLISHED' && assign.status !== 'COMPLETED') throw Errors.badRequest('Ca đăng ký này đang ở trạng thái Chờ duyệt. Phải được Quản lý cửa hàng (chi nhánh trực thuộc) hoặc HR duyệt sang Đã phân ca chính thức thì mới được phép chấm công Vào/Ra ca.');
    const findBranch = (raw?: string) => raw ? (ctx.db.branches.get(raw) ?? ctx.db.branches.find((b) => b.code === raw)) : undefined;
    const empRecord = ctx.db.employees.get(assign.employee_id) ?? ctx.db.employees.find((x) => x.employee_code === assign.employee_id);
    if (!empRecord || !empRecord.branch_id) throw Errors.badRequest('Hồ sơ nhân sự chưa được gán thuộc chi nhánh làm việc nào nên không thể điểm danh Vào/Ra ca');
    const empBranch = findBranch(empRecord.branch_id);
    const branch = findBranch(assign.branch_id) ?? empBranch;
    if (!branch || branch.status !== 'ACTIVE') throw Errors.notFound('Chi nhánh hoạt động', assign.branch_id || empRecord.branch_id);
    if (empBranch && empBranch.id !== branch.id) throw Errors.forbidden(`Nhân sự thuộc chi nhánh "${empBranch.name}", không được phép điểm danh Vào/Ra ca tại chi nhánh khác ("${branch.name}")`);
    if (body.enforce_shift_state || isEmployeeRole(request.auth!.user.role)) {
      const matchAssignEmp = (eid: string) => eid === assign.employee_id || eid === empRecord.id || eid === empRecord.employee_code;
      const blockingAdj = ctx.db.attendanceAdjustments.find((a) =>
        (a.status === 'PENDING' || a.status === 'STORE_CONFIRMED') &&
        (a.assignment_id === assign.id || (matchAssignEmp(a.employee_id) && a.work_date === assign.work_date && a.shift_code === assign.shift_code)) &&
        (a.punch_type === 'FULL_SHIFT' || a.punch_type === checkType),
      );
      if (blockingAdj) {
        const actionLabel = checkType === 'CHECK_IN' ? 'Vào ca' : 'Ra ca';
        throw Errors.badRequest(`Ca làm việc này đã gửi yêu cầu ${actionLabel} qua phiếu ${blockingAdj.adjustment_code} và đang chờ phê duyệt nên tạm khóa nút ${actionLabel}. Nếu phiếu bị từ chối khi vẫn còn trong khung giờ hợp lệ, hệ thống sẽ mở lại để bạn chấm công hoặc gửi lại minh chứng.`);
      }
    }

    if (body.enforce_shift_state) {
      const user = request.auth!.user;
      const myEmp = ctx.db.employees.find((e) => e.user_id === user.id || Boolean(user.employee_id && (e.employee_code === user.employee_id || e.id === user.employee_id)));
      if (!myEmp || (assign.employee_id !== myEmp.id && assign.employee_id !== myEmp.employee_code)) throw Errors.forbidden('Ca làm việc này không thuộc lịch đăng ký / phân công của bạn, không được phép điểm danh');
      const myBranch = findBranch(myEmp.branch_id);
      if (!myBranch || myBranch.id !== branch.id) throw Errors.forbidden(`Bạn thuộc chi nhánh "${myBranch?.name ?? myEmp.branch_id}", chỉ được phép Vào/Ra ca tại đúng chi nhánh trực thuộc của mình`);
      const { todayStr, nowHm } = getVnNowDateAndHm(), win = getShiftCheckoutWindow(assign.work_date, assign.start_at || '07:00', assign.end_at || '12:00', todayStr, nowHm);
      const existingEvents = ctx.db.attendanceEvents.filter((e) => e.assignment_id === assign.id);
      const hasIn = existingEvents.some((e) => e.type === 'CHECK_IN'), hasOut = existingEvents.some((e) => e.type === 'CHECK_OUT');
      if (checkType === 'CHECK_IN' && !hasIn && win.isPastEnd) {
        await ctx.db.shiftAssignments.update(assign.id, assign.version, { status: 'ABSENT', note: 'Quá giờ kết thúc ca chưa điểm danh — Tự động chuyển Vắng mặt' }, user.id);
        throw Errors.badRequest(`Ca làm việc (${assign.start_at || '07:00'} – ${assign.end_at || '12:00'}) đã qua giờ kết thúc ca (hiện tại ${nowHm}) mà chưa vào ca nên hệ thống đã khóa điểm danh và chuyển sang Vắng mặt. Vui lòng làm Phiếu bổ sung công để bù ca.`);
      }
      if (checkType === 'CHECK_OUT' && hasIn && !hasOut && win.isCheckoutLocked) {
        throw Errors.badRequest(`Ca làm việc (${assign.start_at || '07:00'} – ${assign.end_at || '12:00'}) đã quá thời hạn ${formatGraceLabel()} cho phép chấm công Ra ca sau khi hết ca (hạn chót ${win.graceDeadlineHm}, hiện tại ${nowHm}). Vui lòng gửi Phiếu lỗi chấm công Ra ca kèm ảnh minh chứng để HR duyệt.`);
      }
      if (checkType === 'CHECK_OUT' && hasIn && !hasOut && !win.isPastEnd && (assign.work_date > todayStr || nowHm < (assign.end_at || '12:00'))) {
        throw Errors.badRequest(`Chưa đến giờ kết thúc ca (${assign.end_at || '12:00'}). Theo quy định không được Ra ca sớm — chỉ được chấm công Ra ca từ ${assign.end_at || '12:00'} đến ${win.graceDeadlineHm}.`);
      }
      if (assign.work_date !== todayStr && !(checkType === 'CHECK_OUT' && hasIn && !hasOut && win.isWithinCheckoutGrace)) {
        throw Errors.fieldValidation('assignment_id', 'OUT_OF_RANGE', `Chỉ được phép điểm danh đúng ngày đăng ký ca (${dayjs(assign.work_date).format('DD/MM/YYYY')}). Hôm nay là ngày ${dayjs(todayStr).format('DD/MM/YYYY')}.`, assign.work_date);
      }
      if (checkType === 'CHECK_IN' && hasIn) throw Errors.badRequest('Ca làm việc này đã được điểm danh vào ca rồi');
      if (checkType === 'CHECK_OUT' && !hasIn) throw Errors.badRequest('Vui lòng điểm danh vào ca trước khi điểm danh ra ca');
      if (checkType === 'CHECK_OUT' && hasOut) throw Errors.badRequest('Ca làm việc này đã được điểm danh ra ca rồi');
    }
    const distanceM = calculateHaversineMeters(body.lat, body.lng, branch.lat, branch.lng);
    const withinRadius = distanceM <= branch.radius_m;
    if (!withinRadius) {
      const distLabel = distanceM >= 1000 ? `${(distanceM / 1000).toFixed(2).replace('.', ',')} km` : `${distanceM}m`;
      throw Errors.fieldValidation('lat', 'OUT_OF_RANGE', `Vị trí hiện tại cách ${branch.name} ${distLabel}, vượt quá bán kính cho phép (${branch.radius_m}m). Bạn bắt buộc phải có mặt đúng tại ${branch.name} để Vào/Ra ca (hoặc gửi Phiếu bổ sung công nếu thiết bị lỗi GPS).`, `${body.lat},${body.lng}`);
    }
    const accuracyOk = body.accuracy_m <= branch.max_accuracy_m, result = !accuracyOk ? 'LOW_ACCURACY' : 'VALID';
    const serverNow = nowIso(), serverDt = dayjs(serverNow), schedTime = checkType === 'CHECK_IN' ? assign.start_at : assign.end_at;
    const checkWin = getShiftCheckoutWindow(assign.work_date, assign.start_at || '07:00', assign.end_at || '12:00', serverDt.format('YYYY-MM-DD'), serverDt.format('HH:mm'));
    const lateMinutes = checkType === 'CHECK_IN' ? (body.enforce_shift_state ? checkWin.lateCheckInMinutes : Math.max(0, parseHm(serverDt.format('HH:mm')) - parseHm(schedTime))) : 0;
    const earlyLeaveMinutes = checkType === 'CHECK_OUT' ? checkWin.earlyLeaveMinutes : 0;
    const punc = describePunctuality(checkType, lateMinutes, earlyLeaveMinutes);
    const shiftMeta = resolveShiftTimeDetails(ctx, assign.shift_code, assign.id, branch.id);
    const uploadedPhoto = await persistAttendancePhoto(ctx, { base64: body.photo_base64, employeeCode: empRecord.employee_code, checkType, workDate: assign.work_date, shiftFolder: buildShiftFolderName(shiftMeta.shiftLabel, assign.shift_code, assign.start_at, assign.end_at) });

    const created = await ctx.db.attendanceEvents.insert({
      idempotency_key: body.idempotency_key || `chk_${assign.id}_${checkType}_${Date.now()}`, employee_id: assign.employee_id, assignment_id: assign.id, branch_id: branch.id, type: checkType, server_time: serverNow,
      lat: body.lat, lng: body.lng, accuracy_m: body.accuracy_m, distance_m: distanceM, within_radius: withinRadius, photo_id: `photo_${Date.now()}`, photo_sha256: uploadedPhoto.sha256, device_info: body.device_info, result,
      work_date: assign.work_date, shift_code: assign.shift_code, scheduled_time: schedTime, late_minutes: lateMinutes, early_leave_minutes: earlyLeaveMinutes, allowed_radius_m: branch.radius_m, gps_status: accuracyOk ? 'OK' : 'WARNING',
      photo_drive_file_id: uploadedPhoto.fileId, ip_address: request.ip, anomaly_flags_json: '[]', note: `${punc.punctualityLabel} · Khoảng cách GPS ${distanceM}m`,
    }, request.auth!.user.id);
    uploadedPhoto.syncDrive?.(async (driveFileId) => {
      const cur = ctx.db.attendanceEvents.get(created.id);
      if (cur) await ctx.db.attendanceEvents.update(cur.id, cur.version, { photo_drive_file_id: driveFileId }, 'system-drive-sync');
    });
    if (checkType === 'CHECK_OUT' && assign.status !== 'COMPLETED') await ctx.db.shiftAssignments.update(assign.id, assign.version, { status: 'COMPLETED' }, request.auth!.user.id);
    const reqAuditCtx = auditContext(request);
    ctx.realtime()?.toBranch(branch.id, 'attendance:event', { id: created.id, type: created.type, result, distanceM, lateMinutes, earlyLeaveMinutes, message: '' });
    await runBackgroundSideEffect(() => ctx.audit.record(reqAuditCtx, { action: checkType === 'CHECK_IN' ? 'attendance.check_in' : 'attendance.check_out', entity: 'ATTENDANCE_EVENTS', entityId: created.id, after: { type: created.type, distance_m: distanceM, within_radius: withinRadius, result, late_minutes: lateMinutes, early_leave_minutes: earlyLeaveMinutes } }));
    return reply.code(201), sendSuccess(request, `Điểm danh ${checkType === 'CHECK_IN' ? 'vào ca' : 'ra ca'} thành công (${punc.punctualityLabel} · GPS ${distanceM}m)`, mapAttendanceEvent(created, ctx));
  });

  app.put('/api/admin/attendance/events/:id', { preHandler: requirePermission('system.config') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zUpdateAttendanceEventBody.parse(request.body);
    const before = ctx.db.attendanceEvents.get(id);
    if (!before) throw Errors.notFound('Sự kiện điểm danh', id);
    assertBranchAccess(request, before.branch_id);
    assertDateNotLockedByPayroll(ctx.db, before.work_date, 'chỉnh sửa điểm danh');
    const nextType = body.type ?? before.type, nextDate = body.work_date ?? before.work_date, nextShiftCode = body.shift_code ?? before.shift_code;
    const nextHm = body.check_time_hm ?? dayjs(before.server_time).format('HH:mm'), nextServerTime = `${nextDate}T${nextHm}:00+07:00`;
    const assign = ctx.db.shiftAssignments.get(before.assignment_id);
    const startAt = assign?.start_at || '07:00', endAt = assign?.end_at || '12:00', actualMins = parseHm(nextHm);
    const lateMins = nextType === 'CHECK_IN' ? Math.max(0, actualMins - parseHm(startAt)) : 0;
    const earlyMins = nextType === 'CHECK_OUT' ? Math.max(0, parseHm(endAt) - actualMins) : 0;
    const punc = describePunctuality(nextType, lateMins, earlyMins), nextDistance = body.distance_m ?? before.distance_m;
    const updated = await ctx.db.attendanceEvents.update(id, body.version, { type: nextType, work_date: nextDate, shift_code: nextShiftCode, server_time: nextServerTime, distance_m: nextDistance, late_minutes: lateMins, early_leave_minutes: earlyMins, note: body.note ?? `${punc.punctualityLabel} · Khoảng cách GPS ${nextDistance}m` }, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'attendance.event.update', entity: 'ATTENDANCE_EVENTS', entityId: id, before: { type: before.type, server_time: before.server_time }, after: { type: updated.type, server_time: updated.server_time } });
    return sendSuccess(request, 'Đã cập nhật bản ghi điểm danh thành công', mapAttendanceEvent(updated, ctx));
  });

  app.delete('/api/admin/attendance/events/:id', { preHandler: requirePermission('system.config') }, async (request) => {
    const { id } = request.params as { id: string }, body = z.object({ version: z.coerce.number().int().min(1).optional() }).parse(request.body ?? {}), before = ctx.db.attendanceEvents.get(id);
    if (!before) throw Errors.notFound('Sự kiện điểm danh', id);
    assertBranchAccess(request, before.branch_id); assertDateNotLockedByPayroll(ctx.db, before.work_date, 'xóa điểm danh');
    await ctx.db.attendanceEvents.softDelete(id, body.version ?? before.version, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'attendance.event.delete', entity: 'ATTENDANCE_EVENTS', entityId: id, before: { type: before.type, work_date: before.work_date } });
    return sendSuccess(request, 'Đã xóa bản ghi điểm danh', { id });
  });
}
