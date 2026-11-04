import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { auditContext, requireAuth, requirePermission } from '../plugins/auth-context.js';
import { loadAvatarBuffer, removeEmployeeAvatar, saveEmployeeAvatar } from '../services/employee-avatar.service.js';
import { findLinkedEmployeeForUser } from './employee-mapper.js';

const zAvatarUploadBody = z.object({
  avatar_base64: z.string({ required_error: 'Dữ liệu ảnh đại diện là bắt buộc' }).min(10, 'Ảnh không hợp lệ'),
});

export async function employeeAvatarRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/employees/avatars/:fileId', async (request, reply) => {
    const { fileId } = request.params as { fileId: string };
    const media = await loadAvatarBuffer(ctx, fileId);
    if (!media) throw Errors.notFound('Ảnh đại diện trên Google Drive', fileId);
    return reply
      .header('Content-Type', media.mimeType || 'image/jpeg')
      .header('Cache-Control', 'public, max-age=86400')
      .send(media.buffer);
  });

  app.post('/api/admin/employees/:id/avatar', { preHandler: requirePermission('employee.manage') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zAvatarUploadBody.parse(request.body);
    const emp = ctx.db.employees.get(id) ?? ctx.db.employees.find((e) => e.employee_code === id);
    if (!emp) throw Errors.notFound('Hồ sơ nhân sự', id);

    const saved = await saveEmployeeAvatar(ctx, { employeeId: emp.id, base64: body.avatar_base64, actorId: request.auth!.user.id });
    await ctx.audit.record(auditContext(request), {
      action: 'employee.avatar.upload',
      entity: 'EMPLOYEES',
      entityId: emp.id,
      after: { avatar_file_id: saved.fileId },
    });
    return sendSuccess(request, 'Cập nhật ảnh đại diện nhân sự thành công', saved);
  });

  app.delete('/api/admin/employees/:id/avatar', { preHandler: requirePermission('employee.manage') }, async (request) => {
    const { id } = request.params as { id: string };
    const emp = ctx.db.employees.get(id) ?? ctx.db.employees.find((e) => e.employee_code === id);
    if (!emp) throw Errors.notFound('Hồ sơ nhân sự', id);

    await removeEmployeeAvatar(ctx, emp.id, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), {
      action: 'employee.avatar.delete',
      entity: 'EMPLOYEES',
      entityId: emp.id,
      after: { avatar_file_id: '' },
    });
    return sendSuccess(request, 'Đã xóa ảnh đại diện của nhân sự', { fileId: null, url: null });
  });

  app.post('/api/auth/profile/avatar', { preHandler: requireAuth() }, async (request) => {
    const user = request.auth!.user;
    const emp = findLinkedEmployeeForUser(user, ctx);
    if (!emp) throw Errors.badRequest('Tài khoản của bạn chưa được liên kết với hồ sơ nhân sự nào để gắn ảnh đại diện');

    const body = zAvatarUploadBody.parse(request.body);
    const saved = await saveEmployeeAvatar(ctx, { employeeId: emp.id, base64: body.avatar_base64, actorId: user.id });
    await ctx.audit.record(auditContext(request), {
      action: 'auth.avatar.upload',
      entity: 'EMPLOYEES',
      entityId: emp.id,
      after: { avatar_file_id: saved.fileId },
    });
    return sendSuccess(request, 'Cập nhật ảnh đại diện cá nhân thành công', saved);
  });

  app.delete('/api/auth/profile/avatar', { preHandler: requireAuth() }, async (request) => {
    const user = request.auth!.user;
    const emp = findLinkedEmployeeForUser(user, ctx);
    if (!emp) throw Errors.badRequest('Tài khoản của bạn chưa được liên kết với hồ sơ nhân sự nào');

    await removeEmployeeAvatar(ctx, emp.id, user.id);
    await ctx.audit.record(auditContext(request), {
      action: 'auth.avatar.delete',
      entity: 'EMPLOYEES',
      entityId: emp.id,
      after: { avatar_file_id: '' },
    });
    return sendSuccess(request, 'Đã xóa ảnh đại diện cá nhân', { fileId: null, url: null });
  });
}
