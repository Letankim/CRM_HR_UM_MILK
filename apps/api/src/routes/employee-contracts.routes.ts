import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CONTRACT_MAX_SIZE_BYTES, CONTRACT_TYPE_LABELS, CONTRACT_TYPES, DRIVE_FOLDERS,
  isEmployeeRole, verifyContractMagicBytes, type Employee, type EmployeeContractItem,
} from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { nowIso } from '../lib/time.js';
import { assertBranchAccess, auditContext, requireAuth, requirePermission } from '../plugins/auth-context.js';
import { findLinkedEmployeeForUser, mapEmployeeRecord } from './employee-mapper.js';
import {
  deleteContractFromDisk,
  evictContractCache,
  parseEmployeeContracts,
  putContractCache,
  resolveContractFileBuffer,
  saveContractToDisk,
  syncEmployeeContractsWithDrive,
} from './employee-contract-storage.js';

export { parseEmployeeContracts } from './employee-contract-storage.js';

const zUploadContractBody = z.object({
  contract_type: z.enum(CONTRACT_TYPES, { errorMap: () => ({ message: 'Loại hợp đồng phải là Hợp đồng Thử việc hoặc Hợp đồng Chính thức' }) }).default('PROBATION_CONTRACT'),
  file_name: z.string({ required_error: 'Tên tệp hợp đồng là bắt buộc' }).trim().min(1, 'Tên tệp hợp đồng là bắt buộc').max(180),
  data_url: z.string().trim().optional(),
  base64: z.string().trim().optional(),
  file_base64: z.string().trim().optional(),
  note: z.string().trim().max(300).optional().default(''),
});

const zGrantEmergencyLeaveBody = z.object({
  grant_count: z.coerce.number().int().min(1).max(5).optional().default(1),
  note: z.string().trim().max(300).optional().default('Cấp 1 lượt quyền xin nghỉ đột xuất cho nhân viên thử việc'),
});

const zMeetEvaluationBody = z.object({
  probation_meet_done: z.boolean().optional().default(true),
  probation_meet_note: z.string().trim().max(500).optional(),
  note: z.string().trim().max(500).optional(),
});

function findEmployeeOrThrow(ctx: AppContext, idOrCode: string): Employee {
  const clean = idOrCode.trim(), emp = ctx.db.employees.get(clean) ?? ctx.db.employees.find((e) => e.employee_code.trim().toUpperCase() === clean.toUpperCase());
  if (!emp) throw Errors.notFound('Không tìm thấy hồ sơ nhân sự');
  return emp;
}

export async function cleanupProbationShiftsAfterOfficial(ctx: AppContext, emp: Employee, officialFrom: string, actorId: string): Promise<number> {
  const isEmp = (eid: string) => eid === emp.id || eid === emp.employee_code;
  const stale = ctx.db.shiftAssignments.filter((a) => isEmp(a.employee_id) && a.employee_stage === 'PROBATION' && a.work_date >= officialFrom && a.status !== 'COMPLETED');
  let removed = 0;
  for (const s of stale) {
    if (ctx.db.attendanceEvents.find((e) => e.assignment_id === s.id)) continue;
    await ctx.db.shiftAssignments.softDelete(s.id, s.version, actorId);
    removed++;
  }
  return removed;
}

export function registerEmployeeContractRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/admin/employees/:id/contracts', { preHandler: requireAuth() }, async (request) => {
    const { id } = request.params as { id: string }, user = request.auth!.user, emp = findEmployeeOrThrow(ctx, id);
    if (isEmployeeRole(user.role)) {
      const myEmp = findLinkedEmployeeForUser(user, ctx);
      if (!myEmp || myEmp.id !== emp.id) throw Errors.forbidden('Bạn chỉ được phép xem hợp đồng lao động của chính mình');
    } else assertBranchAccess(request, emp.branch_id);
    const synced = await syncEmployeeContractsWithDrive(ctx, emp);
    const items = synced.map((c) => ({ ...c, contractTypeLabel: CONTRACT_TYPE_LABELS[c.contractType] ?? c.contractType }));
    return sendSuccess(request, 'Lấy danh sách hợp đồng lao động thành công', items);
  });

  app.get('/api/admin/employees/:id/contracts/:contractId', { preHandler: requireAuth() }, async (request) => {
    const { id, contractId } = request.params as { id: string; contractId: string }, user = request.auth!.user, emp = findEmployeeOrThrow(ctx, id);
    if (isEmployeeRole(user.role)) {
      const myEmp = findLinkedEmployeeForUser(user, ctx);
      if (!myEmp || myEmp.id !== emp.id) throw Errors.forbidden('Bạn chỉ được phép xem hợp đồng lao động của chính mình');
    } else assertBranchAccess(request, emp.branch_id);
    const items = await syncEmployeeContractsWithDrive(ctx, emp);
    const target = contractId === 'electronic' ? (items[0] ?? null) : items.find((c) => c.id === contractId);
    if (contractId !== 'electronic' && !target) throw Errors.notFound('Hợp đồng lao động', contractId);
    const { buffer, mime } = await resolveContractFileBuffer(ctx, emp, target);
    const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`, cId = target?.id || 'electronic';
    return sendSuccess(request, 'Lấy chi tiết hợp đồng lao động thành công', {
      contract: target ? { ...target, mimeType: mime, contractTypeLabel: CONTRACT_TYPE_LABELS[target.contractType] ?? target.contractType } : null,
      actualMimeType: mime, dataUrl, fileUrl: `/api/admin/employees/${emp.id}/contracts/${cId}/file`,
      downloadUrl: `/api/admin/employees/${emp.id}/contracts/${cId}/file?download=1`, employee: mapEmployeeRecord(emp, ctx),
    });
  });

  app.get('/api/admin/employees/:id/contracts/:contractId/file', { preHandler: requireAuth() }, async (request, reply) => {
    const { id, contractId } = request.params as { id: string; contractId: string }, { download } = (request.query as { download?: string }) ?? {};
    const user = request.auth!.user, emp = findEmployeeOrThrow(ctx, id);
    if (isEmployeeRole(user.role)) {
      const myEmp = findLinkedEmployeeForUser(user, ctx);
      if (!myEmp || myEmp.id !== emp.id) throw Errors.forbidden('Bạn chỉ được phép tải hợp đồng lao động của chính mình');
    } else assertBranchAccess(request, emp.branch_id);
    const items = await syncEmployeeContractsWithDrive(ctx, emp);
    const target = contractId === 'electronic' ? (items[0] ?? null) : items.find((c) => c.id === contractId);
    if (contractId !== 'electronic' && !target) throw Errors.notFound('Hợp đồng lao động', contractId);
    const { buffer, mime } = await resolveContractFileBuffer(ctx, emp, target);
    const fileName = target?.fileName || `${emp.employee_code}_Hop_dong_lao_dong.pdf`, disp = download === '1' || download === 'true' ? 'attachment' : 'inline';
    reply.header('Content-Type', mime).header('Content-Length', buffer.length).header('Content-Disposition', `${disp}; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    return reply.send(buffer);
  });

  app.post('/api/admin/employees/:id/contracts', { preHandler: requirePermission('employee.manage') }, async (request, reply) => {
    const { id } = request.params as { id: string }, body = zUploadContractBody.parse(request.body ?? {}), emp = findEmployeeOrThrow(ctx, id);
    assertBranchAccess(request, emp.branch_id);
    const rawPayload = (body.data_url || body.base64 || body.file_base64 || '').trim();
    if (!rawPayload) throw Errors.fieldValidation('data_url', 'REQUIRED_FIELD', 'Vui lòng chọn tệp hợp đồng lao động để tải lên', '');
    const b64Part = rawPayload.includes(';base64,') ? rawPayload.split(';base64,')[1]! : rawPayload.replace(/^data:[^,]+,/, '');
    const buffer = Buffer.from(b64Part.replace(/\s+/g, ''), 'base64');
    const check = verifyContractMagicBytes(new Uint8Array(buffer), body.file_name);
    if (!check.valid) throw Errors.fieldValidation('data_url', buffer.length > CONTRACT_MAX_SIZE_BYTES ? 'OUT_OF_RANGE' : 'INVALID_FORMAT', check.message, body.file_name);

    const safeCode = emp.employee_code.replace(/[^a-zA-Z0-9_-]/g, ''), safeName = body.file_name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const contractId = `ctr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, fileDiskName = `${contractId}_${safeName}`;
    const localBackupPath = `storage/contracts/${safeCode}/${fileDiskName}`;
    await saveContractToDisk(ctx, safeCode, fileDiskName, buffer);
    let driveFileId = `local_${contractId}`;
    if (ctx.google.uploadDriveMedia) {
      try {
        const up = await ctx.google.uploadDriveMedia({ rootFolder: DRIVE_FOLDERS.EMPLOYEE_DOCUMENTS, folderSegments: [safeCode], fileName: `${safeCode}_${body.contract_type}_${safeName}`, mimeType: check.detectedMime, data: buffer });
        if (up?.fileId) driveFileId = up.fileId;
      } catch { /* fallback local */ }
    }
    putContractCache([contractId, driveFileId], buffer, check.detectedMime);
    const actor = request.auth!.user;
    const item: EmployeeContractItem = { id: contractId, contractType: body.contract_type, fileName: body.file_name, mimeType: check.detectedMime, sizeBytes: buffer.length, driveFileId, localBackupPath, uploadedBy: actor.username || actor.id, uploadedAt: nowIso(), note: body.note };
    const existing = parseEmployeeContracts(emp.contracts_json).filter((c) => !c.driveFileId?.startsWith('drv_ctr_'));
    const nextContracts = [item, ...existing];
    await ctx.db.employees.update(emp.id, emp.version, { contracts_json: JSON.stringify(nextContracts) }, actor.id);
    await ctx.audit.record(auditContext(request), { action: 'employee.contract.upload', entity: 'EMPLOYEES', entityId: emp.id, after: { contractId: item.id, contractType: item.contractType, fileName: item.fileName, sizeBytes: item.sizeBytes, driveFileId: item.driveFileId } });
    reply.code(201);
    return sendSuccess(request, `Đã tải lên ${CONTRACT_TYPE_LABELS[body.contract_type]} thành công`, { ...item, contractTypeLabel: CONTRACT_TYPE_LABELS[body.contract_type], contracts: nextContracts });
  });

  app.delete('/api/admin/employees/:id/contracts/:contractId', { preHandler: requirePermission('employee.manage') }, async (request) => {
    const { id, contractId } = request.params as { id: string; contractId: string }, emp = findEmployeeOrThrow(ctx, id);
    assertBranchAccess(request, emp.branch_id);
    const current = parseEmployeeContracts(emp.contracts_json), target = current.find((c) => c.id === contractId);
    if (!target) throw Errors.notFound('Hợp đồng lao động', contractId);
    const next = current.filter((c) => c.id !== contractId);
    evictContractCache([contractId, target.driveFileId]);
    if (target.localBackupPath) {
      await deleteContractFromDisk(ctx, emp.employee_code.replace(/[^a-zA-Z0-9_-]/g, ''), target.localBackupPath.split('/').pop());
    }
    await ctx.db.employees.update(emp.id, emp.version, { contracts_json: JSON.stringify(next) }, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'employee.contract.delete', entity: 'EMPLOYEES', entityId: emp.id, before: { contractId, fileName: target.fileName } });
    return sendSuccess(request, 'Đã xóa hợp đồng lao động khỏi hồ sơ nhân sự', { id: contractId, contracts: next });
  });

  app.post('/api/admin/employees/:id/grant-emergency-leave', { preHandler: requirePermission('employee.manage', 'leave.approve') }, async (request) => {
    const { id } = request.params as { id: string }, body = zGrantEmergencyLeaveBody.parse(request.body ?? {}), emp = findEmployeeOrThrow(ctx, id);
    assertBranchAccess(request, emp.branch_id);
    const updated = await ctx.db.employees.update(emp.id, emp.version, { emergency_leave_grant_count: body.grant_count }, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'employee.grant_emergency_leave', entity: 'EMPLOYEES', entityId: emp.id, after: { emergency_leave_grant_count: updated.emergency_leave_grant_count, note: body.note } });
    return sendSuccess(request, `Đã cấp ${body.grant_count} lượt quyền xin nghỉ đột xuất cho ${updated.full_name}`, { ...mapEmployeeRecord(updated, ctx), emergency_leave_grant_count: updated.emergency_leave_grant_count, emergencyLeaveGrantCount: updated.emergency_leave_grant_count });
  });

  app.post('/api/admin/employees/:id/meet-evaluation', { preHandler: requirePermission('employee.manage', 'employee.promote', 'interview.manage') }, async (request) => {
    const { id } = request.params as { id: string }, body = zMeetEvaluationBody.parse(request.body ?? {}), emp = findEmployeeOrThrow(ctx, id);
    assertBranchAccess(request, emp.branch_id);
    const meetNote = (body.probation_meet_note ?? body.note ?? 'Đã hoàn tất đánh giá vấn đáp Google Meet cuối kỳ thử việc').trim();
    const updated = await ctx.db.employees.update(emp.id, emp.version, { probation_meet_done: body.probation_meet_done, probation_meet_note: meetNote }, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'employee.meet_evaluation', entity: 'EMPLOYEES', entityId: emp.id, after: { probation_meet_done: updated.probation_meet_done, probation_meet_note: updated.probation_meet_note } });
    return sendSuccess(request, `Đã ghi nhận kết quả vấn đáp Google Meet cho ${updated.full_name}`, { ...mapEmployeeRecord(updated, ctx), probation_meet_done: updated.probation_meet_done, probation_meet_note: updated.probation_meet_note, probationMeetDone: updated.probation_meet_done, probationMeetNote: updated.probation_meet_note });
  });
}
