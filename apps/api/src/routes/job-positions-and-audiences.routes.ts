import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { STAFF_GROUP_LABELS } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { requireAuth, requirePermission } from '../plugins/auth-context.js';

export interface JobPositionConfigItem { code: string; label: string; department: string; description: string; isDefault?: boolean; deleted?: boolean }
export interface AudienceGroupConfigItem { id: string; key: string; scope: string; target: string; branch_id?: string; stage?: string; staff_group?: string; label: string; note: string; isCustom?: boolean; deleted?: boolean }

const DEFAULT_POSITIONS: JobPositionConfigItem[] = [
  { code: 'BARISTA', label: 'Pha chế', department: 'Cửa hàng (Vận hành)', description: 'Pha chế thức uống theo quy chuẩn công thức SOP', isDefault: true },
  { code: 'CASHIER', label: 'Thu ngân', department: 'Cửa hàng (Vận hành)', description: 'Tiếp nhận order, thanh toán POS và chăm sóc khách hàng', isDefault: true },
  { code: 'SERVICE', label: 'Phục vụ', department: 'Cửa hàng (Vận hành)', description: 'Phục vụ tại quầy, giữ vệ sinh không gian cửa hàng', isDefault: true },
  { code: 'SHIFT_LEADER', label: 'Ca trưởng', department: 'Cửa hàng (Quản lý ca)', description: 'Điều phối nhân sự trong ca, kiểm kê nguyên vật liệu ca', isDefault: true },
  { code: 'STORE_MANAGER', label: 'Quản lý cửa hàng', department: 'Cửa hàng (Quản lý)', description: 'Quản lý vận hành toàn diện chi nhánh, duyệt công & lịch ca', isDefault: true },
  { code: 'BACKOFFICE', label: 'Khối văn phòng', department: 'Văn phòng (Backoffice)', description: 'Nhân sự Hành chính, Nhân sự (HR), Kế toán, Truyền thông (MKT)', isDefault: true },
  { code: 'FACTORY', label: 'Khối xưởng sản xuất', department: 'Xưởng & Kho trung tâm', description: 'Chế biến nguyên liệu trung tâm, đóng gói và vận chuyển nội bộ', isDefault: true },
  { code: 'SALES', label: 'Khối kinh doanh (Sale)', department: 'Kinh doanh & Phát triển', description: 'Phát triển thị trường, đối tác B2B và sự kiện bán hàng', isDefault: true },
];

export function getJobPositions(ctx: AppContext) {
  const row = ctx.db.systemSettings.find((s) => s.key === 'JOB_POSITIONS_CONFIG');
  let custom: JobPositionConfigItem[] = [];
  if (row?.value) {
    try { custom = JSON.parse(row.value); } catch { custom = []; }
  }
  const map = new Map<string, JobPositionConfigItem>();
  for (const d of DEFAULT_POSITIONS) map.set(d.code, { ...d });
  for (const c of custom) {
    if (c.deleted) map.delete(c.code);
    else map.set(c.code, { ...(map.get(c.code) ?? {}), ...c });
  }
  const activeEmps = ctx.db.employees.filter((e) => e.status === 'ACTIVE');
  return Array.from(map.values()).map((p) => ({
    ...p,
    employeeCount: activeEmps.filter((e) => e.staff_group === p.code).length,
  }));
}

async function saveJobPositionsConfig(ctx: AppContext, list: JobPositionConfigItem[], actorId: string) {
  const existing = ctx.db.systemSettings.find((s) => s.key === 'JOB_POSITIONS_CONFIG');
  const json = JSON.stringify(list);
  if (existing) await ctx.db.systemSettings.update(existing.id, existing.version, { value: json }, actorId);
  else await ctx.db.systemSettings.insert({ key: 'JOB_POSITIONS_CONFIG', value: json, label: 'Danh mục Vị trí công việc', category: 'HR', value_type: 'JSON', note: 'Cấu hình danh mục vị trí công việc toàn hệ thống' }, actorId);
}

export function buildConfiguredAudienceGroups(ctx: AppContext, branchScope: 'ALL' | string[] = 'ALL') {
  const activeEmps = ctx.db.employees.filter((e) => e.status === 'ACTIVE' && (branchScope === 'ALL' || branchScope.includes(e.branch_id)));
  const positions = getJobPositions(ctx);
  const base: AudienceGroupConfigItem[] = [
    { id: 'ALL:ALL', key: 'ALL:ALL', scope: 'ALL', target: 'ALL', label: 'Toàn công ty (Tất cả nhân sự)', note: 'Phát thông báo tới toàn bộ tài khoản nhân sự đang hoạt động (ẩn lương/GPS/CCCD)' },
    { id: 'STAGE:THU_VIEC', key: 'STAGE:THU_VIEC', scope: 'STAGE', target: 'THU_VIEC', stage: 'PROBATION', label: 'Nhóm Nhân viên Thử việc', note: 'Nhân sự đang trong chu kỳ thử việc 12 ngày (không lộ dữ liệu HR nhạy cảm)' },
    { id: 'STAGE:CHINH_THUC', key: 'STAGE:CHINH_THUC', scope: 'STAGE', target: 'CHINH_THUC', stage: 'OFFICIAL', label: 'Nhóm Nhân viên Chính thức', note: 'Nhân sự đã ký hợp đồng chính thức tại chuỗi (không lộ dữ liệu HR nhạy cảm)' },
  ];
  for (const b of ctx.db.branches.all()) {
    if (branchScope !== 'ALL' && !branchScope.includes(b.id) && !branchScope.includes(b.code)) continue;
    base.push({ id: `BRANCH:${b.id}`, key: `BRANCH:${b.id}`, scope: 'BRANCH', target: b.id, branch_id: b.id, label: `Chi nhánh ${b.code} — ${b.name}`, note: `Nhân sự thuộc phạm vi ${b.name}` });
  }
  for (const p of positions) {
    const lbl = p.label.startsWith('Khối') ? p.label : `Khối ${p.label}`;
    base.push({ id: `STAFF_GROUP:${p.code}`, key: `STAFF_GROUP:${p.code}`, scope: 'STAFF_GROUP', target: p.code, staff_group: p.code, label: lbl, note: p.description || `Nhân sự thuộc vị trí ${p.label}` });
  }

  const row = ctx.db.systemSettings.find((s) => s.key === 'MKT_AUDIENCE_GROUPS');
  let custom: AudienceGroupConfigItem[] = [];
  if (row?.value) {
    try { custom = JSON.parse(row.value); } catch { custom = []; }
  }
  const map = new Map<string, AudienceGroupConfigItem>();
  for (const g of base) map.set(g.id, g);
  for (const c of custom) {
    if (c.deleted) map.delete(c.id);
    else if (branchScope === 'ALL' || !c.branch_id || c.branch_id === 'ALL' || branchScope.includes(c.branch_id)) {
      map.set(c.id, { ...(map.get(c.id) ?? {}), ...c });
    }
  }

  return Array.from(map.values()).map((g) => {
    const count = activeEmps.filter((e) => {
      if (g.scope === 'BRANCH') return e.branch_id === (g.branch_id || g.target);
      if (g.scope === 'STAGE') return g.target === 'THU_VIEC' || g.stage === 'PROBATION' ? e.stage === 'PROBATION' : e.stage === 'OFFICIAL';
      if (g.scope === 'STAFF_GROUP') return e.staff_group === (g.staff_group || g.target);
      if (g.scope === 'CUSTOM') {
        if (g.branch_id && g.branch_id !== 'ALL' && e.branch_id !== g.branch_id) return false;
        if (g.stage && g.stage !== 'ALL' && e.stage !== g.stage) return false;
        if (g.staff_group && g.staff_group !== 'ALL' && e.staff_group !== g.staff_group) return false;
        return true;
      }
      return true;
    }).length;
    return { ...g, recipientCount: count };
  });
}

async function saveAudienceConfig(ctx: AppContext, list: AudienceGroupConfigItem[], actorId: string) {
  const existing = ctx.db.systemSettings.find((s) => s.key === 'MKT_AUDIENCE_GROUPS');
  const json = JSON.stringify(list);
  if (existing) await ctx.db.systemSettings.update(existing.id, existing.version, { value: json }, actorId);
  else await ctx.db.systemSettings.insert({ key: 'MKT_AUDIENCE_GROUPS', value: json, label: 'Nhóm người nhận truyền thông', category: 'COMMS', value_type: 'JSON', note: 'Cấu hình nhóm người nhận MKT' }, actorId);
}

export function doesUserMatchAudience(ctx: AppContext, u: { id: string; role: string; employee_id?: string; branch_scope?: string }, rawScope: string, rawJsonOrTarget: string): boolean {
  let scope = rawScope || 'ALL', target = 'ALL', branch_id = 'ALL', stage = 'ALL', staff_group = 'ALL';
  if (rawJsonOrTarget?.trim().startsWith('{')) {
    try {
      const obj = JSON.parse(rawJsonOrTarget);
      if (obj.scope) scope = String(obj.scope);
      if (obj.target) target = String(obj.target);
      if (obj.branch_id) branch_id = String(obj.branch_id);
      if (obj.stage) stage = String(obj.stage);
      if (obj.staff_group) staff_group = String(obj.staff_group);
    } catch { target = rawJsonOrTarget; }
  } else if (rawJsonOrTarget) target = rawJsonOrTarget;
  if (scope === 'CUSTOM' && target.includes('|')) {
    const [b = 'ALL', s = 'ALL', g = 'ALL'] = target.split('|');
    branch_id = b; stage = s; staff_group = g;
  }
  if (!scope || scope === 'ALL') return true;
  const emp = (u.employee_id ? (ctx.db.employees.get(u.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === u.employee_id)) : undefined) ?? ctx.db.employees.find((e) => e.user_id === u.id);
  const matchBranch = (bt: string) => {
    if (!bt || bt === 'ALL') return true;
    const br = ctx.db.branches.get(bt) ?? ctx.db.branches.find((x) => x.code === bt);
    const tokens = new Set([bt, br?.id, br?.code].filter(Boolean) as string[]);
    if (emp?.branch_id) return tokens.has(emp.branch_id);
    if (u.branch_scope && u.branch_scope !== 'ALL') return u.branch_scope.split(',').map((s) => s.trim()).some((x) => tokens.has(x));
    return false;
  };
  const matchStage = (st: string) => !st || st === 'ALL' ? true : (st === 'THU_VIEC' || st === 'PROBATION') ? (emp ? emp.stage === 'PROBATION' : u.role === 'THU_VIEC') : (st === 'CHINH_THUC' || st === 'OFFICIAL') ? (emp ? emp.stage === 'OFFICIAL' : u.role === 'CHINH_THUC') : (emp?.stage === st || u.role === st);
  const matchGroup = (gt: string) => !gt || gt === 'ALL' ? true : emp ? emp.staff_group === gt : gt === 'STORE_MANAGER' ? u.role === 'STORE' : gt === 'BACKOFFICE' ? ['HR', 'FINANCE', 'MKT'].includes(u.role) : false;
  if (scope === 'BRANCH') return matchBranch(target);
  if (scope === 'STAGE') return matchStage(target);
  if (scope === 'STAFF_GROUP') return matchGroup(target);
  if (scope === 'CUSTOM') return matchBranch(branch_id) && matchStage(stage) && matchGroup(staff_group);
  return true;
}

export function getMatchingUsersForAudience(ctx: AppContext, scope: string, rawJsonOrTarget: string) {
  return ctx.db.users.filter((u) => u.status === 'ACTIVE' && doesUserMatchAudience(ctx, u, scope, rawJsonOrTarget));
}

const zJobPosBody = z.object({
  code: z.string().trim().min(2, 'Mã vị trí tối thiểu 2 ký tự').max(40), label: z.string().trim().min(2, 'Tên vị trí công việc tối thiểu 2 ký tự').max(80),
  department: z.string().trim().max(80).optional().default('Cửa hàng (Vận hành)'), description: z.string().trim().max(250).optional().default(''),
});
const zAudienceBody = z.object({
  id: z.string().trim().optional(), label: z.string().trim().min(2, 'Tên nhóm người nhận tối thiểu 2 ký tự').max(120),
  scope: z.enum(['ALL', 'BRANCH', 'STAGE', 'STAFF_GROUP', 'CUSTOM']).default('CUSTOM'), target: z.string().trim().optional().default('ALL'),
  branch_id: z.string().trim().optional().default('ALL'), stage: z.string().trim().optional().default('ALL'),
  staff_group: z.string().trim().optional().default('ALL'), note: z.string().trim().max(250).optional().default(''),
});

export async function jobPositionsAndAudiencesRoutes(app: FastifyInstance, ctx: AppContext) {
  const POS_PERMS = ['employee.manage', 'system.config'] as const;
  const AUD_PERMS = ['comms.manage', 'notification.send', 'employee.manage', 'system.config'] as const;

  app.get('/api/admin/job-positions', { preHandler: requireAuth() }, async (req) =>
    sendSuccess(req, 'Lấy danh mục vị trí công việc thành công', getJobPositions(ctx)));

  app.post('/api/admin/job-positions', { preHandler: requirePermission(...POS_PERMS) }, async (req, reply) => {
    const body = zJobPosBody.parse(req.body), code = body.code.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const row = ctx.db.systemSettings.find((s) => s.key === 'JOB_POSITIONS_CONFIG'), list: JobPositionConfigItem[] = row?.value ? JSON.parse(row.value) : [];
    const idx = list.findIndex((x) => x.code === code), item: JobPositionConfigItem = { code, label: body.label, department: body.department, description: body.description, deleted: false };
    if (idx >= 0) list[idx] = item; else list.push(item);
    (STAFF_GROUP_LABELS as Record<string, string>)[code] = body.label;
    await saveJobPositionsConfig(ctx, list, req.auth!.user.id);
    reply.code(201);
    return sendSuccess(req, `Đã lưu vị trí công việc "${body.label}" (${code})`, getJobPositions(ctx));
  });

  app.put('/api/admin/job-positions/:code', { preHandler: requirePermission(...POS_PERMS) }, async (req) => {
    const { code } = req.params as { code: string }, body = zJobPosBody.partial().parse(req.body);
    const current = getJobPositions(ctx).find((p) => p.code === code);
    if (!current) throw Errors.notFound('Vị trí công việc', code);
    const row = ctx.db.systemSettings.find((s) => s.key === 'JOB_POSITIONS_CONFIG'), list: JobPositionConfigItem[] = row?.value ? JSON.parse(row.value) : [];
    const updated: JobPositionConfigItem = { code, label: body.label || current.label, department: body.department ?? current.department, description: body.description ?? current.description, deleted: false };
    const idx = list.findIndex((x) => x.code === code);
    if (idx >= 0) list[idx] = updated; else list.push(updated);
    (STAFF_GROUP_LABELS as Record<string, string>)[code] = updated.label;
    await saveJobPositionsConfig(ctx, list, req.auth!.user.id);
    return sendSuccess(req, `Đã cập nhật vị trí công việc "${updated.label}"`, getJobPositions(ctx));
  });

  app.delete('/api/admin/job-positions/:code', { preHandler: requirePermission(...POS_PERMS) }, async (req) => {
    const { code } = req.params as { code: string }, row = ctx.db.systemSettings.find((s) => s.key === 'JOB_POSITIONS_CONFIG');
    const list: JobPositionConfigItem[] = row?.value ? JSON.parse(row.value) : [], idx = list.findIndex((x) => x.code === code);
    if (idx >= 0) list[idx] = { ...list[idx]!, deleted: true }; else list.push({ code, label: code, department: '', description: '', deleted: true });
    await saveJobPositionsConfig(ctx, list, req.auth!.user.id);
    return sendSuccess(req, `Đã xóa vị trí công việc "${code}"`, getJobPositions(ctx));
  });

  const upsertAudienceGroup = async (id: string, body: z.infer<typeof zAudienceBody>, actorId: string) => {
    const target = body.scope === 'BRANCH' ? body.branch_id : body.scope === 'STAGE' ? body.stage : body.scope === 'STAFF_GROUP' ? body.staff_group : body.target || `${body.branch_id}|${body.stage}|${body.staff_group}`;
    const row = ctx.db.systemSettings.find((s) => s.key === 'MKT_AUDIENCE_GROUPS'), list: AudienceGroupConfigItem[] = row?.value ? JSON.parse(row.value) : [];
    const item: AudienceGroupConfigItem = { id, key: id, scope: body.scope, target, branch_id: body.branch_id, stage: body.stage, staff_group: body.staff_group, label: body.label, note: body.note || 'Nhóm người nhận được cấu hình', isCustom: true, deleted: false };
    const idx = list.findIndex((x) => x.id === id);
    if (idx >= 0) list[idx] = item; else list.push(item);
    await saveAudienceConfig(ctx, list, actorId);
  };

  app.post('/api/mkt/audience-groups', { preHandler: requirePermission(...AUD_PERMS) }, async (req, reply) => {
    const body = zAudienceBody.parse(req.body), id = body.id || `CUSTOM:${Date.now().toString(36).toUpperCase()}`;
    await upsertAudienceGroup(id, body, req.auth!.user.id);
    reply.code(201);
    return sendSuccess(req, `Đã lưu cấu hình nhóm người nhận "${body.label}"`, buildConfiguredAudienceGroups(ctx));
  });

  app.put('/api/mkt/audience-groups/:id', { preHandler: requirePermission(...AUD_PERMS) }, async (req) => {
    const { id } = req.params as { id: string }, body = zAudienceBody.parse(req.body);
    await upsertAudienceGroup(id, body, req.auth!.user.id);
    return sendSuccess(req, `Đã cập nhật nhóm người nhận "${body.label}"`, buildConfiguredAudienceGroups(ctx));
  });

  app.delete('/api/mkt/audience-groups/:id', { preHandler: requirePermission(...AUD_PERMS) }, async (req) => {
    const { id } = req.params as { id: string }, row = ctx.db.systemSettings.find((s) => s.key === 'MKT_AUDIENCE_GROUPS');
    const list: AudienceGroupConfigItem[] = row?.value ? JSON.parse(row.value) : [], idx = list.findIndex((x) => x.id === id);
    if (idx >= 0) list[idx] = { ...list[idx]!, deleted: true }; else list.push({ id, key: id, scope: 'CUSTOM', target: 'ALL', label: id, note: '', deleted: true });
    await saveAudienceConfig(ctx, list, req.auth!.user.id);
    return sendSuccess(req, 'Đã xóa nhóm người nhận khỏi danh sách cấu hình', buildConfiguredAudienceGroups(ctx));
  });
}
