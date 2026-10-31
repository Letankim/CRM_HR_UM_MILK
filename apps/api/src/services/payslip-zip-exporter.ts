import JSZip from 'jszip';
import { PAYSLIP_STATUS_LABELS, PAY_PERIOD_STATUS_LABELS, type PayPeriod, type Payslip, type PayrollSnapshot } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { dayjs } from '../lib/time.js';
import { getConfiguredAdminSignature, loadPayrollMediaBuffer } from './payroll-media-storage.js';
import { mapSnapshot, recalculatePeriodSnapshots } from './payroll-snapshot.service.js';
import { renderPayslipPdf, type PayslipPdfInput, type PayslipPdfLineItem } from './payslip-pdf-renderer.js';

/** Chuẩn hóa tên file PDF: <MaKyLuong>_<MaNhanVien>_<TenNhanVien>.pdf (an toàn tuyệt đối trên mọi HĐH, giữ nguyên dấu tiếng Việt UTF-8) */
export function buildPayslipPdfFileName(periodCode: string, employeeCode: string, fullName: string): string {
  const cleanPart = (s: string, fb: string) =>
    (s || fb)
      .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || fb;
  return `${cleanPart(periodCode, 'KY_LUONG')}_${cleanPart(employeeCode, 'NV')}_${cleanPart(fullName, 'Nhan_Su')}.pdf`;
}

function buildPdfLineItems(mapped: ReturnType<typeof mapSnapshot>, slip?: Payslip): PayslipPdfLineItem[] {
  const lines: PayslipPdfLineItem[] = [];
  const segs = (mapped.segments ?? []) as Array<{ stage: string; percent: number; quantity: number; unit: string; unitRateVnd: number; fromDate: string; toDate: string; hours: number; amountVnd: number }>;
  for (const seg of segs) {
    lines.push({
      label: `Lương ${seg.stage === 'PROBATION' ? `thử việc (${seg.percent}%)` : 'chính thức'}`,
      detail: `${seg.quantity} ${seg.unit} x ${Math.round(seg.unitRateVnd).toLocaleString('vi-VN')} đ (${dayjs(seg.fromDate).format('DD/MM')} - ${dayjs(seg.toDate).format('DD/MM')}, ${seg.hours}h)`,
      amountVnd: seg.amountVnd,
    });
  }
  if (lines.length === 0 && mapped.baseSalaryVnd > 0) {
    lines.push({ label: 'Lương ca làm việc trong kỳ', detail: `${mapped.totalShiftsCount} ca (${mapped.approvedHours} giờ công)`, amountVnd: mapped.baseSalaryVnd });
  }
  if (mapped.otPayVnd > 0) lines.push({ label: 'Lương tăng ca (OT)', detail: `${mapped.otHours} giờ x ${Math.round(mapped.otRateVnd).toLocaleString('vi-VN')} đ`, amountVnd: mapped.otPayVnd });
  for (const a of mapped.allowanceLines) {
    lines.push({
      label: a.label,
      detail: a.code === 'ALLOWANCE_SWAP' ? `${mapped.paidSwapCount ?? mapped.shiftSwapCount} ca nhận đổi có phụ cấp` : 'Theo hồ sơ lương / chính sách đã duyệt',
      amountVnd: a.amount,
    });
  }
  if (mapped.kpiBonusVnd > 0) lines.push({ label: 'Thưởng hiệu suất (KPI / Doanh số)', detail: 'Khoản thưởng được phê duyệt trong kỳ', amountVnd: mapped.kpiBonusVnd });
  if (mapped.positiveAdjustmentsVnd > 0) lines.push({ label: 'Điều chỉnh cộng thêm (+)', detail: 'Khoản bổ sung lương đã phê duyệt', amountVnd: mapped.positiveAdjustmentsVnd });
  const totalDed = mapped.approvedDeductionsVnd + mapped.advanceDeductionVnd;
  if (totalDed > 0) lines.push({ label: 'Khấu trừ & tạm ứng (-)', detail: 'Khoản khấu trừ đã được phê duyệt', amountVnd: -totalDed });
  if (slip && slip.net_vnd !== mapped.netVnd) {
    const diff = slip.net_vnd - mapped.netVnd;
    lines.push({ label: diff > 0 ? 'Điều chỉnh sau phát hành (+)' : 'Khấu trừ điều chỉnh sau phát hành (-)', detail: `Phiếu điều chỉnh lần #${slip.revision}`, amountVnd: diff });
  }
  if (lines.length === 0) lines.push({ label: 'Chưa phát sinh giờ công tính lương trong kỳ', detail: `${mapped.totalShiftsCount} ca · 0 giờ`, amountVnd: 0 });
  return lines;
}

async function assemblePdfInputForEmployee(
  ctx: AppContext,
  period: PayPeriod,
  snap: PayrollSnapshot,
  slip: Payslip | undefined,
  sharedSigs: { adminBuf: Buffer | null; financeBuf: Buffer | null; adminSigner: string; financeSigner: string },
): Promise<PayslipPdfInput> {
  const mapped = mapSnapshot(snap, ctx);
  const empSigId = slip?.employee_signature_file_id || '';
  const empMedia = empSigId ? await loadPayrollMediaBuffer(ctx, empSigId) : null;
  const adminBuf = slip?.admin_signature_file_id && slip.admin_signature_file_id !== period.admin_signature_file_id
    ? (await loadPayrollMediaBuffer(ctx, slip.admin_signature_file_id))?.buffer ?? sharedSigs.adminBuf
    : sharedSigs.adminBuf;
  const financeBuf = slip?.finance_signature_file_id && slip.finance_signature_file_id !== period.finance_signature_file_id
    ? (await loadPayrollMediaBuffer(ctx, slip.finance_signature_file_id))?.buffer ?? sharedSigs.financeBuf
    : sharedSigs.financeBuf;

  const isPaid = period.status === 'PAID' || slip?.status === 'PAID';
  const statusLabel = isPaid ? 'Đã thanh toán' : slip ? PAYSLIP_STATUS_LABELS[slip.status] : PAY_PERIOD_STATUS_LABELS[period.status];
  return {
    payslipCode: slip?.payslip_code || `PL-${period.period_code}-${snap.employee_code}`,
    periodCode: period.period_code,
    periodName: period.name,
    fromDate: period.from_date,
    toDate: period.to_date,
    statusLabel,
    revision: slip?.revision || 1,
    employeeCode: snap.employee_code,
    fullName: snap.full_name,
    branchName: mapped.branchName,
    stageLabel: mapped.stageLabel,
    rateSummary: `${mapped.rateTypeLabel} — ${Math.round(mapped.rateVnd).toLocaleString('vi-VN')} đ/${mapped.unitLabel}${mapped.probationPercent ? ` (TV ${mapped.probationPercent}%)` : ''}`,
    workSummary: `${mapped.totalShiftsCount} ca · ${mapped.workedDays} ngày · ${mapped.approvedHours} giờ${mapped.otHours > 0 ? ` (+${mapped.otHours}h OT)` : ''}`,
    attendanceSummary: `GPS: ${mapped.checkedInShiftsCount ?? 0} ca · Bù công: ${mapped.adjustedShiftsCount ?? 0} · OFF: ${mapped.leaveOffCount ?? 0} · Đổi ca: +${mapped.shiftSwapCount}`,
    bankName: mapped.bankName,
    bankAccountNumber: mapped.bankAccountNumber,
    bankAccountHolder: mapped.bankAccountHolder,
    paymentReference: mapped.paymentReference,
    lines: buildPdfLineItems(mapped, slip),
    grossVnd: slip ? slip.gross_vnd : mapped.grossVnd,
    totalDeductionsVnd: slip ? slip.total_deductions_vnd : mapped.approvedDeductionsVnd + mapped.advanceDeductionVnd,
    netVnd: slip ? slip.net_vnd : mapped.netVnd,
    signatures: [
      {
        roleTitle: 'BAN QUẢN TRỊ PHÊ DUYỆT',
        roleSubtitle: 'Chữ ký số hệ thống Quản trị',
        signerName: period.admin_signed_by || sharedSigs.adminSigner || 'Ban Quản trị Ụm Bò Milk',
        signedAt: period.admin_signed_at || period.approved_at || null,
        imageBytes: adminBuf,
      },
      {
        roleTitle: 'KẾ TOÁN LẬP & PHÁT HÀNH',
        roleSubtitle: 'Chữ ký Kế toán tiền lương',
        signerName: period.finance_signed_by || sharedSigs.financeSigner || 'Phòng Kế toán',
        signedAt: period.finance_signed_at || period.published_at || null,
        imageBytes: financeBuf,
      },
      {
        roleTitle: 'NHÂN SỰ XÁC NHẬN',
        roleSubtitle: 'Chữ ký trực tiếp nhân viên',
        signerName: `${snap.full_name} (${snap.employee_code})`,
        signedAt: slip?.employee_confirmed_at || null,
        imageBytes: empMedia?.buffer ?? null,
      },
    ],
  };
}

async function resolveSharedPeriodSignatures(ctx: AppContext, period: PayPeriod) {
  const cfgAdmin = getConfiguredAdminSignature(ctx);
  const adminFileId = period.admin_signature_file_id || (period.approved_at ? cfgAdmin.fileId : '');
  const adminMedia = adminFileId ? await loadPayrollMediaBuffer(ctx, adminFileId) : null;
  const financeMedia = period.finance_signature_file_id ? await loadPayrollMediaBuffer(ctx, period.finance_signature_file_id) : null;
  const finUser = period.published_by ? ctx.db.users.get(period.published_by) : undefined;
  const admUser = period.approved_by ? ctx.db.users.get(period.approved_by) : undefined;
  return {
    adminBuf: adminMedia?.buffer ?? null,
    financeBuf: financeMedia?.buffer ?? null,
    adminSigner: period.admin_signed_by || admUser?.display_name || cfgAdmin.signerName || '',
    financeSigner: period.finance_signed_by || finUser?.display_name || '',
  };
}

export async function exportSinglePayslipPdf(ctx: AppContext, id: string): Promise<{ fileName: string; pdfBuffer: Buffer }> {
  const slip = ctx.db.payslips.get(id) ?? ctx.db.payslips.find((p) => p.status !== 'REVISED' && p.snapshot_id === id);
  const snap = ctx.db.payrollSnapshots.get(id)
    ?? (slip ? ctx.db.payrollSnapshots.get(slip.snapshot_id) ?? ctx.db.payrollSnapshots.find((s) => s.period_id === slip.period_id && (s.employee_id === slip.employee_id || s.employee_code === slip.employee_code)) : undefined);
  const period = ctx.db.payPeriods.get(slip?.period_id ?? snap?.period_id ?? '');
  if (!period || !snap) throw Errors.notFound('Không tìm thấy dữ liệu phiếu lương cần kết xuất PDF');
  const sharedSigs = await resolveSharedPeriodSignatures(ctx, period);
  const pdfInput = await assemblePdfInputForEmployee(ctx, period, snap, slip, sharedSigs);
  const pdfBuffer = await renderPayslipPdf(pdfInput);
  return { fileName: buildPayslipPdfFileName(period.period_code, snap.employee_code, snap.full_name), pdfBuffer };
}

export async function exportPeriodPayslipsZip(
  ctx: AppContext,
  periodId: string,
  selectedIds?: string[],
  actorId = 'system',
): Promise<{ zipFileName: string; zipBuffer: Buffer; count: number; fileNames: string[] }> {
  let period = ctx.db.payPeriods.get(periodId);
  if (!period) throw Errors.notFound('Không tìm thấy kỳ lương cần xuất PDF');
  let snaps = ctx.db.payrollSnapshots.filter((s) => s.period_id === periodId);
  if (snaps.length === 0 && (period.status === 'DRAFT' || period.status === 'RECONCILE')) {
    period = await recalculatePeriodSnapshots(ctx, period, actorId, true);
    snaps = ctx.db.payrollSnapshots.filter((s) => s.period_id === periodId);
  }
  const activeSlips = ctx.db.payslips.filter((p) => p.period_id === periodId && p.status !== 'REVISED');
  const filterSet = new Set((selectedIds ?? []).map((x) => x.trim()).filter(Boolean));
  const targetSnaps = (filterSet.size > 0
    ? snaps.filter((s) => {
        if (filterSet.has(s.id) || filterSet.has(s.employee_id) || filterSet.has(s.employee_code)) return true;
        const sl = activeSlips.find((p) => p.snapshot_id === s.id || p.employee_id === s.employee_id || p.employee_code === s.employee_code);
        return Boolean(sl && filterSet.has(sl.id));
      })
    : snaps
  ).sort((a, b) => a.employee_code.localeCompare(b.employee_code));

  if (targetSnaps.length === 0) throw Errors.badRequest('Không có nhân sự nào trong danh sách cần xuất phiếu lương PDF');

  const sharedSigs = await resolveSharedPeriodSignatures(ctx, period);
  const zip = new JSZip();
  const usedNames = new Set<string>();
  const fileNames: string[] = [];

  for (const snap of targetSnaps) {
    const slip = activeSlips.find((p) => p.snapshot_id === snap.id || p.employee_id === snap.employee_id || (Boolean(snap.employee_code) && p.employee_code === snap.employee_code));
    const pdfInput = await assemblePdfInputForEmployee(ctx, period, snap, slip, sharedSigs);
    const pdfBuffer = await renderPayslipPdf(pdfInput);
    if (pdfBuffer.length < 200 || pdfBuffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw Errors.badRequest(`Lỗi kiểm tra toàn vẹn tệp PDF của nhân sự ${snap.full_name} (${snap.employee_code})`);
    }
    let fileName = buildPayslipPdfFileName(period.period_code, snap.employee_code, snap.full_name);
    if (usedNames.has(fileName)) {
      fileName = fileName.replace(/\.pdf$/i, `_${snap.id.slice(-4)}.pdf`);
    }
    usedNames.add(fileName);
    fileNames.push(fileName);
    zip.file(fileName, pdfBuffer, { binary: true, compression: 'DEFLATE', compressionOptions: { level: 6 } });
  }

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const scopeSuffix = filterSet.size > 0 ? `_${targetSnaps.length}_Nhan_Su` : '_Toan_Bo';
  return {
    zipFileName: `${period.period_code}_Phieu_Luong_PDF${scopeSuffix}.zip`,
    zipBuffer,
    count: targetSnaps.length,
    fileNames,
  };
}
