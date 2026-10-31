import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SHIFT_SWAP_KIND_LABELS, SHIFT_SWAP_STATUS_LABELS, SYSTEM_CONFIG, type Branch, type ShiftSwap } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { assertBranchAccess, auditContext, requirePermission } from '../plugins/auth-context.js';
import { SocketEvents } from '../realtime/realtime.js';
import { recalculateOpenPeriods } from '../services/payroll-snapshot.service.js';
import { assertDateNotLockedByPayroll } from '../services/salary-profile.service.js';
import { emitScheduleRealtime, resolveEmployeeBranchId, resolveShiftTimeDetails } from './account-employee-sync.js';

export const zDecideSwapBody = z.object({
  version: z.coerce.number().int().min(1, 'Phiên bản bản ghi không hợp lệ'),
  decision: z.enum(['APPROVED', 'REJECTED']),
  decision_reason: z.string().trim().max(300, 'Ghi chú phê duyệt tối đa 300 ký tự').optional().default(''),
  allowance_eligible: z.boolean({ invalid_type_error: 'Trạng thái tính phụ cấp đổi ca không hợp lệ' }).optional(),
  allowance_amount_vnd: z.coerce
    .number({ invalid_type_error: 'Số tiền phụ cấp đổi ca phải là số hợp lệ' })
    .int('Số tiền phụ cấp đổi ca phải là số nguyên')
    .min(0, 'Số tiền phụ cấp đổi ca không được âm')
    .max(5_000_000, 'Số tiền phụ cấp đổi ca không vượt quá 5.000.000 đ')
    .optional(),
});

export const zUpdateSwapAllowanceBody = z.object({
  version: z.coerce.number().int().min(1, 'Phiên bản bản ghi không hợp lệ'),
  allowance_eligible: z.boolean({
    required_error: 'Vui lòng chọn trạng thái tính phụ cấp đổi ca',
    invalid_type_error: 'Trạng thái tính phụ cấp đổi ca không hợp lệ',
  }),
  allowance_amount_vnd: z.coerce
    .number({ invalid_type_error: 'Số tiền phụ cấp đổi ca phải là số hợp lệ' })
    .int('Số tiền phụ cấp đổi ca phải là số nguyên')
    .min(0, 'Số tiền phụ cấp đổi ca không được âm')
    .max(5_000_000, 'Số tiền phụ cấp đổi ca không vượt quá 5.000.000 đ')
    .optional(),
  decision_reason: z.string().trim().max(300, 'Ghi chú tối đa 300 ký tự').optional(),
});

export function resolveSwapAllowance(opts: {
  decision: 'APPROVED' | 'REJECTED';
  allowance_eligible?: boolean;
  allowance_amount_vnd?: number;
}): { allowance_eligible: boolean; allowance_amount_vnd: number } {
  if (opts.decision !== 'APPROVED') {
    return { allowance_eligible: false, allowance_amount_vnd: 0 };
  }
  const ticked = opts.allowance_eligible ?? true;
  const raw = opts.allowance_amount_vnd ?? SYSTEM_CONFIG.defaults.shiftSwapAllowanceVnd;
  const amount = ticked ? Math.max(0, Math.round(raw)) : 0;
  return {
    allowance_eligible: ticked && amount > 0,
    allowance_amount_vnd: amount,
  };
}

export function formatSwapAllowanceSummary(s: Pick<ShiftSwap, 'status' | 'allowance_eligible' | 'allowance_amount_vnd'>): string {
  if (s.status === 'APPROVED') {
    const amt = s.allowance_eligible ? Math.max(0, Math.round(Number(s.allowance_amount_vnd ?? 0))) : 0;
    return s.allowance_eligible && amt > 0 ? `+${amt.toLocaleString('vi-VN')} đ` : 'Không phụ cấp (0 đ)';
  }
  if (s.status === 'REJECTED' || s.status === 'PEER_DECLINED' || s.status === 'CANCELLED') return 'Không áp dụng';
  return `Chờ duyệt (MĐ ${SYSTEM_CONFIG.defaults.shiftSwapAllowanceVnd.toLocaleString('vi-VN')} đ)`;
}

export function mapShiftSwapRecord(ctx: AppContext, s: ShiftSwap, fallbackBranch?: Branch) {
  const reqEmp = ctx.db.employees.get(s.requester_id) ?? ctx.db.employees.find((e) => e.employee_code === s.requester_id);
  const peerEmp = ctx.db.employees.get(s.peer_id) ?? ctx.db.employees.find((e) => e.employee_code === s.peer_id);
  const branch = (reqEmp ? ctx.db.branches.get(reqEmp.branch_id) : undefined) ?? ctx.db.branches.get(s.branch_id) ?? fallbackBranch;
  const branchId = branch?.id ?? s.branch_id;
  const isApproved = s.status === 'APPROVED';
  const effAmt = isApproved
    ? (s.allowance_eligible ? Math.max(0, Math.round(Number(s.allowance_amount_vnd ?? 0))) : 0)
    : Math.max(0, Math.round(Number(s.allowance_amount_vnd ?? SYSTEM_CONFIG.defaults.shiftSwapAllowanceVnd)));
  const effEligible = isApproved ? Boolean(s.allowance_eligible && effAmt > 0) : false;

  return {
    ...s,
    allowance_eligible: effEligible,
    allowance_amount_vnd: isApproved ? effAmt : s.allowance_amount_vnd,
    ...resolveShiftTimeDetails(ctx, s.from_shift_code, s.from_assignment_id, branchId, s.requester_id, s.from_work_date),
    branch_id: branchId,
    branchName: branch?.name ?? 'Chi nhánh',
    requesterCode: reqEmp?.employee_code ?? s.requester_id,
    peerCode: peerEmp?.employee_code ?? s.peer_id,
    requesterName: reqEmp ? `${reqEmp.full_name} (${reqEmp.employee_code})` : s.requester_id,
    peerName: peerEmp ? `${peerEmp.full_name} (${peerEmp.employee_code})` : s.peer_id,
    statusLabel: s.status === 'PENDING_PEER' && s.kind === 'GIVE' ? 'Chờ người nhận xác nhận' : SHIFT_SWAP_STATUS_LABELS[s.status],
    kindLabel: SHIFT_SWAP_KIND_LABELS[s.kind],
    requiresHrApproval: s.requires_hr_approval,
    toShiftDetails: s.kind === 'SWAP' && s.to_assignment_id ? resolveShiftTimeDetails(ctx, s.to_shift_code, s.to_assignment_id, branchId, s.peer_id, s.to_work_date) : null,
    allowanceEligible: effEligible,
    allowanceAmountVnd: isApproved ? effAmt : 0,
    allowanceLabel: formatSwapAllowanceSummary({ status: s.status, allowance_eligible: effEligible, allowance_amount_vnd: effAmt }),
  };
}

export function registerShiftSwapAllowanceRoute(app: FastifyInstance, ctx: AppContext): void {
  app.put('/api/admin/shift-swaps/:id/allowance', { preHandler: requirePermission('swap.approve') }, async (request) => {
    const { id } = request.params as { id: string }, body = zUpdateSwapAllowanceBody.parse(request.body), before = ctx.db.shiftSwaps.get(id);
    if (!before) throw Errors.notFound('Yêu cầu đổi ca', id);
    assertBranchAccess(request, resolveEmployeeBranchId(ctx, before.requester_id, before.branch_id));
    assertDateNotLockedByPayroll(ctx.db, before.from_work_date, 'cập nhật phụ cấp đổi ca');
    if (before.status !== 'APPROVED') throw Errors.badRequest('Chỉ được phép cập nhật phụ cấp đối với yêu cầu đổi / nhường ca đã cập nhật lịch');
    const actorId = request.auth!.user.id;
    const patch = resolveSwapAllowance({ decision: 'APPROVED', allowance_eligible: body.allowance_eligible, allowance_amount_vnd: body.allowance_amount_vnd });
    const updated = await ctx.db.shiftSwaps.update(id, body.version, { ...patch, ...(body.decision_reason !== undefined ? { decision_reason: body.decision_reason } : {}) }, actorId);
    await recalculateOpenPeriods(ctx, actorId);
    await ctx.audit.record(auditContext(request), { action: 'swap.update_allowance', entity: 'SHIFT_SWAPS', entityId: id, before: { allowance_eligible: before.allowance_eligible, allowance_amount_vnd: before.allowance_amount_vnd }, after: { allowance_eligible: updated.allowance_eligible, allowance_amount_vnd: updated.allowance_amount_vnd } });
    emitScheduleRealtime(ctx, SocketEvents.SWAP_UPDATED, { branchId: before.branch_id, employeeIds: [before.requester_id, before.peer_id], kind: 'SWAP_ALLOWANCE_UPDATED', actorId });
    return sendSuccess(request, updated.allowance_eligible && updated.allowance_amount_vnd > 0 ? `Đã cập nhật phụ cấp nhận đổi ca thành +${updated.allowance_amount_vnd.toLocaleString('vi-VN')} đ và đồng bộ bảng lương` : 'Đã cập nhật không tính phụ cấp đổi ca (0 đ) và đồng bộ bảng lương', mapShiftSwapRecord(ctx, updated));
  });
}
