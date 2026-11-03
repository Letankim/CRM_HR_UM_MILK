import { DRIVE_FOLDERS, SYSTEM_CONFIG, type Employee, type Payslip, type User } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { dayjs, nowIso } from '../lib/time.js';
import { SocketEvents } from '../realtime/realtime.js';
import { findLinkedUserForEmployee } from '../routes/employee-mapper.js';
import { resolveSystemHrMailbox, resolveUserPersonalRealEmail, webOrigin } from './account-email-dispatcher.js';
import { queuePayslipPublishedEmails } from './action-email-dispatcher.js';
import { runBackgroundSideEffect } from './background-write.js';
import { ensureSyncedNotifications } from './notification-sync.service.js';
import { persistPayrollMedia, toCleanDriveSlug } from './payroll-media-storage.js';
import { mapPayslip } from './payslip.service.js';

/** Thông báo Chuông + Realtime + Email DUY NHẤT cho bộ phận Kế toán (FINANCE) khi nhân viên ký / xác nhận phiếu lương */
export async function notifyFinancePayslipConfirmed(ctx: AppContext, slip: Payslip, actor: User, viaDirectSign: boolean) {
  const rt = ctx.realtime();
  rt?.toTargets({ roles: ['FINANCE', 'ADMIN'], userIds: [actor.id] }, SocketEvents.PAYROLL_UPDATED, {
    periodId: slip.period_id, payslipId: slip.id, action: viaDirectSign ? 'SIGNED' : 'CONFIRMED',
  });
  const title = `Nhân sự ${slip.full_name} (${slip.employee_code}) đã ${viaDirectSign ? 'ký trực tiếp' : 'xác nhận'} phiếu lương`;
  rt?.toTargets({ roles: ['FINANCE'], excludeUserId: actor.id }, SocketEvents.NOTIFICATION, {
    kind: 'PAYROLL_CONFIRMED', entityId: slip.id, code: slip.payslip_code, title,
  });
  const financeUsers = ctx.db.users.filter((u) => u.role === 'FINANCE' && u.status === 'ACTIVE' && u.id !== actor.id);
  const seenEmails = new Set<string>(), origin = webOrigin(ctx), actorEmail = resolveUserPersonalRealEmail(ctx, actor);
  for (const u of financeUsers) {
    const to = resolveUserPersonalRealEmail(ctx, u);
    if (!to || to === actorEmail || seenEmails.has(to)) continue;
    seenEmails.add(to);
    ctx.email.enqueue({
      to, recipientName: u.display_name || u.username, template: 'PAYSLIP_PUBLISHED', referenceCode: `${slip.payslip_code}-SIGNED`,
      subject: `${SYSTEM_CONFIG.emailSubjectPrefix} ${title} (${slip.payslip_code})`,
      summary: `${slip.full_name} (${slip.employee_code}) đã ${viaDirectSign ? 'ký tay trực tiếp' : 'xác nhận đồng ý'} phiếu lương ${slip.payslip_code} (${slip.period_name}) — Thực lĩnh ${Number(slip.net_vnd || 0).toLocaleString('vi-VN')} đ. Bộ phận Kế toán đã có thể đối chiếu mã QR để chuyển khoản thanh toán.`,
      metadata: [
        { label: 'Nhân sự xác nhận', value: `${slip.full_name} (${slip.employee_code})` },
        { label: 'Mã phiếu & Kỳ lương', value: `${slip.payslip_code} · ${slip.period_name}` },
        { label: 'Thực lĩnh (NET)', value: `${Number(slip.net_vnd || 0).toLocaleString('vi-VN')} đ` },
        { label: 'Thời gian ký xác nhận', value: dayjs(slip.employee_confirmed_at || undefined).format('HH:mm DD/MM/YYYY') },
      ],
      actionLabel: 'Mở Bảng lương & Quét QR Thanh toán', actionUrl: `${origin}/admin/payroll`,
    }, { dedupeKey: `payslip_confirm_fin:${slip.id}:${to}` });
  }
  if (seenEmails.size === 0) {
    const fallback = resolveSystemHrMailbox(ctx);
    if (fallback && fallback !== actorEmail) {
      seenEmails.add(fallback);
      ctx.email.enqueue({
        to: fallback, recipientName: `Bộ phận Kế toán — ${SYSTEM_CONFIG.brandName}`, template: 'PAYSLIP_PUBLISHED', referenceCode: `${slip.payslip_code}-SIGNED`,
        subject: `${SYSTEM_CONFIG.emailSubjectPrefix} ${title} (${slip.payslip_code})`,
        summary: `${slip.full_name} (${slip.employee_code}) đã xác nhận phiếu lương ${slip.payslip_code} (${slip.period_name}) — Thực lĩnh ${Number(slip.net_vnd || 0).toLocaleString('vi-VN')} đ.`,
        metadata: [{ label: 'Nhân sự', value: `${slip.full_name} (${slip.employee_code})` }, { label: 'Mã phiếu lương', value: slip.payslip_code }, { label: 'Thực lĩnh (NET)', value: `${Number(slip.net_vnd || 0).toLocaleString('vi-VN')} đ` }],
        actionLabel: 'Mở Bảng lương & Quét QR Thanh toán', actionUrl: `${origin}/admin/payroll`,
      }, { dedupeKey: `payslip_confirm_fin:${slip.id}:${fallback}` });
    }
  }
  if (seenEmails.size > 0) void ctx.email.processQueueBatch(Math.min(6, seenEmails.size));
  await runBackgroundSideEffect(() => ensureSyncedNotifications(ctx));
}

/** Bước 4: Nhân viên ký tay trực tiếp trên màn hình (CẤM tải ảnh lên) & xác nhận phiếu lương */
export async function employeeDirectSignPayslip(
  ctx: AppContext,
  slip: Payslip,
  params: { signatureBase64: string; signatureSource: string },
  actor: User,
) {
  if (params.signatureSource !== 'DIRECT_CANVAS') {
    throw Errors.fieldValidation('signature_source', 'INVALID_VALUE', 'Nhân viên bắt buộc ký tay trực tiếp trên màn hình, không được phép tải ảnh chữ ký lên', params.signatureSource);
  }
  const period = ctx.db.payPeriods.get(slip.period_id);
  if (!period || (period.status !== 'PUBLISHED' && period.status !== 'PAID')) throw Errors.forbidden('Phiếu lương chưa được phát hành');
  if (slip.employee_confirmed_at) return slip;
  if (period.status === 'PAID' || slip.status === 'PAID') throw Errors.conflict('Phiếu lương này đã thanh toán hoàn tất.');
  const hasPendingRev = Boolean(ctx.db.payslipRevisions.find((r) => r.period_id === slip.period_id && (r.employee_id === slip.employee_id || r.employee_id === slip.employee_code) && r.status === 'PENDING'));
  if (hasPendingRev) throw Errors.conflict('Phiếu lương này đang có điều chỉnh của Kế toán chờ Ban Quản trị phê duyệt. Vui lòng đợi Quản trị duyệt xong trước khi ký xác nhận.');

  const savedSig = await persistPayrollMedia(ctx, {
    base64: params.signatureBase64,
    rootFolder: DRIVE_FOLDERS.PAYROLL_SIGNATURES,
    folderSegments: ['03_NHAN_VIEN', period.period_code],
    fileBaseName: `${period.period_code}_${slip.employee_code}_${toCleanDriveSlug(slip.full_name, 'NV')}_CHU_KY_NV`,
    fieldName: 'signature_base64',
    labelVi: 'Chữ ký tay trực tiếp của nhân viên',
    asyncDrive: true,
  });
  const now = nowIso();
  const updated = await ctx.db.payslips.update(slip.id, slip.version, {
    viewed_by_employee_at: slip.viewed_by_employee_at || now,
    employee_confirmed_at: now,
    employee_signature_file_id: savedSig.fileId,
    dispute_status: 'NONE',
  }, actor.id);
  savedSig.syncDrive?.(async (driveFileId) => {
    const cur = ctx.db.payslips.get(updated.id);
    if (cur && cur.employee_signature_file_id === savedSig.fileId) {
      await ctx.db.payslips.update(cur.id, cur.version, { employee_signature_file_id: driveFileId }, 'system-drive-sync');
    }
  });
  const openTck = ctx.db.supportTickets.find((t) => t.related_entity_type === 'PAYSLIP' && t.related_entity_id === slip.id && t.status !== 'CLOSED');
  if (openTck) {
    await ctx.db.supportTickets.update(openTck.id, openTck.version, { status: 'CLOSED', closed_at: now, resolved_by: openTck.resolved_by || actor.id, resolved_at: openTck.resolved_at || now }, actor.id);
  }
  await notifyFinancePayslipConfirmed(ctx, updated, actor, true);
  return updated;
}

/** Bước 5: Quản trị / Kế toán đánh dấu Đã thanh toán cho từng phiếu lương (hoặc hàng loạt qua 1 lần batchUpdate) */
export async function markPayslipsPaid(ctx: AppContext, ids: string[], paymentReference: string, actor: User) {
  const uniqueIds = Array.from(new Set(ids.map((x) => x.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) throw Errors.fieldValidation('ids', 'REQUIRED_FIELD', 'Vui lòng chọn ít nhất 1 phiếu lương cần đánh dấu đã thanh toán', []);
  const now = nowIso(), touchedPeriods = new Set<string>(), orderedIds: string[] = [];
  const toPay: Array<{ slip: Payslip; periodCode: string; periodName: string; periodId: string; emp?: Employee; ref: string }> = [];

  for (const rawId of uniqueIds) {
    const snap = ctx.db.payrollSnapshots.get(rawId);
    const slip = ctx.db.payslips.get(rawId)
      ?? ctx.db.payslips.find((p) => p.status !== 'REVISED' && p.snapshot_id === rawId)
      ?? (snap ? ctx.db.payslips.find((p) => p.status !== 'REVISED' && p.period_id === snap.period_id && (p.employee_id === snap.employee_id || p.employee_code === snap.employee_code)) : undefined);
    if (!slip) throw Errors.notFound('Không tìm thấy phiếu lương đã phát hành cho nhân sự được chọn');
    const period = ctx.db.payPeriods.get(slip.period_id);
    if (!period || (period.status !== 'PUBLISHED' && period.status !== 'PAID')) {
      throw Errors.conflict('Chỉ có thể đánh dấu Đã thanh toán cho phiếu lương thuộc kỳ đã Phát hành');
    }
    touchedPeriods.add(period.id);
    if (!orderedIds.includes(slip.id)) orderedIds.push(slip.id);
    if (slip.status === 'PAID' || toPay.some((x) => x.slip.id === slip.id)) continue;
    const emp = ctx.db.employees.get(slip.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === slip.employee_code);
    toPay.push({ slip, periodCode: period.period_code, periodName: period.name, periodId: period.id, emp, ref: paymentReference.trim() || `QR-${period.period_code}-${slip.employee_code}` });
  }

  const paidUserIds: string[] = [];
  if (toPay.length > 0) {
    const updatedSlips = await ctx.db.payslips.batchUpdate(
      toPay.map(({ slip, ref }) => ({ id: slip.id, expectedVersion: slip.version, patch: { status: 'PAID' as const, paid_at: now, paid_by: actor.id, payment_reference: ref } })),
      actor.id,
    );
    await Promise.all(toPay.map(({ slip, periodCode, periodId, emp, ref }) =>
      ctx.db.payments.insert({
        period_id: periodId, employee_id: slip.employee_id, amount_vnd: slip.net_vnd, paid_at: now,
        reference: ref, recorded_by: actor.id, payment_code: `PAY-${periodCode}-${slip.employee_code}`,
        payslip_id: slip.id, branch_id: slip.branch_id, payment_method: 'BANK_QR_TRANSFER',
        bank_name: emp?.bank_name || '', bank_account_number: emp?.bank_account_number || '',
        bank_account_holder: emp?.bank_account_holder || slip.full_name, evidence_file_id: emp?.bank_qr_file_id || '',
        status: 'COMPLETED', note: paymentReference.trim(),
      }, actor.id),
    ));
    const slipsByPeriod = new Map<string, Payslip[]>();
    for (const item of toPay) {
      const freshSlip = updatedSlips.find((u) => u.id === item.slip.id) ?? ctx.db.payslips.get(item.slip.id) ?? item.slip;
      slipsByPeriod.set(item.periodId, [...(slipsByPeriod.get(item.periodId) ?? []), freshSlip]);
      const empUser = item.emp ? findLinkedUserForEmployee(item.emp, ctx) : undefined;
      if (empUser) {
        paidUserIds.push(empUser.id);
        if (empUser.id !== actor.id) {
          ctx.realtime()?.toUser(empUser.id, SocketEvents.NOTIFICATION, { kind: 'PAYROLL_PAID', entityId: item.slip.id, code: item.slip.payslip_code, title: `Đã chuyển khoản lương kỳ ${item.periodName}` });
        }
      }
    }
    for (const [pid, periodSlips] of slipsByPeriod.entries()) {
      const p = ctx.db.payPeriods.get(pid);
      if (p) queuePayslipPublishedEmails(ctx, p, periodSlips, { actorEmail: actor.email, isPaid: true });
    }
    await runBackgroundSideEffect(() => ensureSyncedNotifications(ctx));
  }

  for (const pid of touchedPeriods) {
    const p = ctx.db.payPeriods.get(pid);
    if (!p) continue;
    if (p.status === 'PUBLISHED') {
      const activeSlips = ctx.db.payslips.filter((x) => x.period_id === pid && x.status !== 'REVISED');
      if (activeSlips.length > 0 && activeSlips.every((x) => x.status === 'PAID')) {
        await ctx.db.payPeriods.update(pid, p.version, { status: 'PAID', paid_at: now, paid_by: actor.id, ...(paymentReference.trim() ? { note: paymentReference.trim() } : {}) }, actor.id);
      }
    }
    ctx.realtime()?.toTargets({ roles: ['ADMIN', 'FINANCE', 'HR'], userIds: paidUserIds }, SocketEvents.PAYROLL_UPDATED, { periodId: pid, action: 'PAID' });
  }
  return orderedIds.map((id) => ctx.db.payslips.get(id)!).filter(Boolean).map((s) => mapPayslip(s, ctx));
}
