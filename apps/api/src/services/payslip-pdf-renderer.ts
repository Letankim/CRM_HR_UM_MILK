import { readFileSync } from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { SYSTEM_CONFIG } from '@umbm/shared';
import { dayjs } from '../lib/time.js';

export interface PayslipPdfLineItem { label: string; detail: string; amountVnd: number; }
export interface PayslipPdfSignatureSlot { roleTitle: string; roleSubtitle: string; signerName: string; signedAt: string | null; imageBytes?: Buffer | null; }
export interface PayslipPdfInput {
  payslipCode: string; periodCode: string; periodName: string; fromDate: string; toDate: string; statusLabel: string; revision: number;
  employeeCode: string; fullName: string; branchName: string; stageLabel: string; rateSummary: string; workSummary: string; attendanceSummary: string;
  bankName: string; bankAccountNumber: string; bankAccountHolder: string; paymentReference: string;
  lines: PayslipPdfLineItem[]; grossVnd: number; totalDeductionsVnd: number; netVnd: number;
  signatures: [PayslipPdfSignatureSlot, PayslipPdfSignatureSlot, PayslipPdfSignatureSlot];
}

let cachedRegularFont: Uint8Array | null = null;
let cachedBoldFont: Uint8Array | null = null;

function loadFontBytes(): { regular: Uint8Array; bold: Uint8Array } {
  if (!cachedRegularFont) cachedRegularFont = new Uint8Array(readFileSync(new URL('../../assets/fonts/Roboto-Regular.ttf', import.meta.url)));
  if (!cachedBoldFont) cachedBoldFont = new Uint8Array(readFileSync(new URL('../../assets/fonts/Roboto-Bold.ttf', import.meta.url)));
  return { regular: cachedRegularFont, bold: cachedBoldFont };
}

const fmtMoney = (n: number) => `${Math.round(n || 0).toLocaleString('vi-VN')} đ`;
const fmtDate = (d: string) => (/^\d{4}-\d{2}-\d{2}/.test(d) ? dayjs(d).format('DD/MM/YYYY') : d || '—');
const fmtTs = (d: string | null) => (d ? dayjs(d).format('HH:mm DD/MM/YYYY') : '');

const C = {
  navy: rgb(0.06, 0.09, 0.16),
  blue: rgb(0.145, 0.388, 0.922),
  blueSoft: rgb(0.937, 0.965, 1),
  slate: rgb(0.39, 0.45, 0.55),
  border: rgb(0.82, 0.85, 0.9),
  bgSoft: rgb(0.973, 0.98, 0.988),
  green: rgb(0.082, 0.502, 0.239),
  red: rgb(0.863, 0.149, 0.149),
  white: rgb(1, 1, 1),
};

function fitText(text: string, font: PDFFont, size: number, maxWidth: number): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean || font.widthOfTextAtSize(clean, size) <= maxWidth) return clean;
  let lo = 0, hi = clean.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (font.widthOfTextAtSize(`${clean.slice(0, mid)}...`, size) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${clean.slice(0, Math.max(1, lo))}...`;
}

async function embedSignatureImage(pdfDoc: PDFDocument, raw?: Buffer | null): Promise<PDFImage | null> {
  if (!raw || raw.length < 32) return null;
  try {
    if (raw[0] === 0x89 && raw[1] === 0x50 && raw[2] === 0x4e && raw[3] === 0x47) return await pdfDoc.embedPng(raw);
    if (raw[0] === 0xff && raw[1] === 0xd8 && raw[2] === 0xff) return await pdfDoc.embedJpg(raw);
    return await pdfDoc.embedPng(raw).catch(() => pdfDoc.embedJpg(raw));
  } catch {
    return null;
  }
}

function drawSignatureBox(
  page: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  slot: PayslipPdfSignatureSlot,
  img: PDFImage | null,
  fReg: PDFFont,
  fBold: PDFFont,
) {
  page.drawRectangle({ x, y, width: w, height: h, color: C.white, borderColor: C.border, borderWidth: 0.8 });
  page.drawRectangle({ x, y: y + h - 22, width: w, height: 22, color: C.bgSoft, borderColor: C.border, borderWidth: 0.8 });
  const titleW = fBold.widthOfTextAtSize(slot.roleTitle, 8.2);
  page.drawText(slot.roleTitle, { x: x + Math.max(6, (w - titleW) / 2), y: y + h - 14, size: 8.2, font: fBold, color: C.navy });
  const sub = fitText(slot.roleSubtitle, fReg, 7, w - 10);
  page.drawText(sub, { x: x + Math.max(5, (w - fReg.widthOfTextAtSize(sub, 7)) / 2), y: y + h - 32, size: 7, font: fReg, color: C.slate });

  if (img) {
    const maxW = w - 24, maxH = 46;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1.4);
    const drawW = img.width * scale, drawH = img.height * scale;
    page.drawImage(img, { x: x + (w - drawW) / 2, y: y + 32 + (maxH - drawH) / 2, width: drawW, height: drawH });
  } else {
    const placeholder = slot.signedAt ? '(Đã xác nhận điện tử)' : '(Chưa có chữ ký)';
    page.drawText(placeholder, { x: x + (w - fReg.widthOfTextAtSize(placeholder, 7.5)) / 2, y: y + 52, size: 7.5, font: fReg, color: C.slate });
  }

  const name = fitText(slot.signerName || '—', fBold, 8.5, w - 12);
  page.drawText(name, { x: x + Math.max(6, (w - fBold.widthOfTextAtSize(name, 8.5)) / 2), y: y + 18, size: 8.5, font: fBold, color: C.navy });
  const tsText = slot.signedAt ? `Đã ký: ${fmtTs(slot.signedAt)}` : 'Trạng thái: Chờ ký';
  page.drawText(tsText, { x: x + Math.max(6, (w - fReg.widthOfTextAtSize(tsText, 7)) / 2), y: y + 7, size: 7, font: fReg, color: slot.signedAt ? C.green : C.slate });
}

export async function renderPayslipPdf(input: PayslipPdfInput): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const { regular, bold } = loadFontBytes();
  const fReg = await pdfDoc.embedFont(regular, { subset: true });
  const fBold = await pdfDoc.embedFont(bold, { subset: true });

  const W = 595.28, H = 841.89, M = 34, CW = W - M * 2;
  const page = pdfDoc.addPage([W, H]);

  // 1. Thanh tiêu đề thương hiệu doanh nghiệp
  page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: C.blue });
  page.drawRectangle({ x: M, y: H - 56, width: 34, height: 34, color: C.blue });
  const shortBrand = SYSTEM_CONFIG.brandShortCode || 'UB';
  page.drawText(shortBrand, { x: M + (34 - fBold.widthOfTextAtSize(shortBrand, 13)) / 2, y: H - 44, size: 13, font: fBold, color: C.white });
  page.drawText(SYSTEM_CONFIG.brandName, { x: M + 42, y: H - 35, size: 14, font: fBold, color: C.navy });
  page.drawText('HỆ THỐNG QUẢN TRỊ NHÂN SỰ & TIỀN LƯƠNG', { x: M + 42, y: H - 49, size: 8, font: fReg, color: C.slate });

  const docTitle = 'PHIẾU LƯƠNG NHÂN SỰ';
  page.drawText(docTitle, { x: W - M - fBold.widthOfTextAtSize(docTitle, 14), y: H - 34, size: 14, font: fBold, color: C.blue });
  const subRight = `Mã phiếu: ${input.payslipCode}  |  Kỳ: ${input.periodCode} (${fmtDate(input.fromDate)} - ${fmtDate(input.toDate)})`;
  page.drawText(subRight, { x: W - M - fReg.widthOfTextAtSize(subRight, 8), y: H - 48, size: 8, font: fReg, color: C.slate });
  page.drawLine({ start: { x: M, y: H - 64 }, end: { x: W - M, y: H - 64 }, thickness: 0.9, color: C.border });

  // 2. Khung 2 cột Thông tin Nhân sự & Tài khoản Ngân hàng
  const infoTop = H - 74, infoH = 98, halfW = (CW - 10) / 2;
  const drawInfoCard = (bx: number, header: string, pairs: [string, string][]) => {
    page.drawRectangle({ x: bx, y: infoTop - infoH, width: halfW, height: infoH, color: C.white, borderColor: C.border, borderWidth: 0.8 });
    page.drawRectangle({ x: bx, y: infoTop - 19, width: halfW, height: 19, color: C.bgSoft, borderColor: C.border, borderWidth: 0.8 });
    page.drawText(header, { x: bx + 8, y: infoTop - 13, size: 8.2, font: fBold, color: C.navy });
    pairs.forEach(([k, v], idx) => {
      const ry = infoTop - 32 - idx * 14.5;
      page.drawText(k, { x: bx + 8, y: ry, size: 7.8, font: fReg, color: C.slate });
      page.drawText(fitText(v || '—', fBold, 8, halfW - 92), { x: bx + 86, y: ry, size: 8, font: fBold, color: C.navy });
    });
  };
  drawInfoCard(M, 'THÔNG TIN NHÂN SỰ & CÔNG LƯƠNG', [
    ['Họ và tên:', `${input.fullName} (${input.employeeCode})`],
    ['Chi nhánh:', `${input.branchName} · ${input.stageLabel}`],
    ['Mức lương:', input.rateSummary],
    ['Tổng công:', input.workSummary],
    ['Đối soát ca:', input.attendanceSummary],
  ]);
  drawInfoCard(M + halfW + 10, 'THÔNG TIN NGÂN HÀNG & TRẠNG THÁI', [
    ['Kỳ lương:', input.periodName],
    ['Ngân hàng:', input.bankName || 'Chưa cập nhật'],
    ['Số tài khoản:', input.bankAccountNumber || '—'],
    ['Chủ tài khoản:', input.bankAccountHolder || input.fullName],
    ['Trạng thái:', `${input.statusLabel}${input.revision > 1 ? ` (Điều chỉnh #${input.revision})` : ''}${input.paymentReference ? ` · ${input.paymentReference}` : ''}`],
  ]);

  // 3. Bảng chi tiết các khoản mục thu nhập & khấu trừ
  let curY = infoTop - infoH - 14;
  page.drawRectangle({ x: M, y: curY - 20, width: CW, height: 20, color: C.navy });
  page.drawText('STT', { x: M + 8, y: curY - 13, size: 8, font: fBold, color: C.white });
  page.drawText('KHOẢN MỤC THU NHẬP / PHỤ CẤP / KHẤU TRỪ', { x: M + 36, y: curY - 13, size: 8, font: fBold, color: C.white });
  page.drawText('DIỄN GIẢI CÁCH TÍNH', { x: M + 225, y: curY - 13, size: 8, font: fBold, color: C.white });
  const amtHdr = 'SỐ TIỀN (VNĐ)';
  page.drawText(amtHdr, { x: W - M - 8 - fBold.widthOfTextAtSize(amtHdr, 8), y: curY - 13, size: 8, font: fBold, color: C.white });
  curY -= 20;

  const displayLines = input.lines.slice(0, 14);
  const rowH = displayLines.length > 10 ? 18 : 20;
  displayLines.forEach((line, idx) => {
    curY -= rowH;
    page.drawRectangle({ x: M, y: curY, width: CW, height: rowH, color: idx % 2 === 1 ? C.bgSoft : C.white, borderColor: C.border, borderWidth: 0.5 });
    const ty = curY + (rowH - 8) / 2 + 1;
    page.drawText(String(idx + 1).padStart(2, '0'), { x: M + 9, y: ty, size: 8, font: fReg, color: C.slate });
    page.drawText(fitText(line.label, fBold, 8.2, 182), { x: M + 36, y: ty, size: 8.2, font: fBold, color: C.navy });
    page.drawText(fitText(line.detail, fReg, 7.8, 200), { x: M + 225, y: ty, size: 7.8, font: fReg, color: C.slate });
    const valStr = line.amountVnd > 0 ? fmtMoney(line.amountVnd) : fmtMoney(line.amountVnd);
    page.drawText(valStr, { x: W - M - 8 - fBold.widthOfTextAtSize(valStr, 8.4), y: ty, size: 8.4, font: fBold, color: line.amountVnd < 0 ? C.red : C.navy });
  });

  // 4. Khối tổng hợp Gross / Khấu trừ / Thực lĩnh Net
  curY -= 20;
  page.drawRectangle({ x: M, y: curY, width: CW, height: 20, color: C.bgSoft, borderColor: C.border, borderWidth: 0.7 });
  page.drawText(`Tổng thu nhập gộp (Gross): ${fmtMoney(input.grossVnd)}`, { x: M + 10, y: curY + 6, size: 8.3, font: fBold, color: C.navy });
  const dedStr = `Tổng khấu trừ: -${fmtMoney(Math.abs(input.totalDeductionsVnd))}`;
  page.drawText(dedStr, { x: W - M - 8 - fBold.widthOfTextAtSize(dedStr, 8.3), y: curY + 6, size: 8.3, font: fBold, color: input.totalDeductionsVnd > 0 ? C.red : C.slate });

  curY -= 30;
  page.drawRectangle({ x: M, y: curY, width: CW, height: 26, color: C.blueSoft, borderColor: C.blue, borderWidth: 1.1 });
  page.drawText('THỰC LĨNH NHẬN VỀ (NET PAY)', { x: M + 10, y: curY + 8, size: 10, font: fBold, color: C.blue });
  const netStr = fmtMoney(input.netVnd);
  page.drawText(netStr, { x: W - M - 10 - fBold.widthOfTextAtSize(netStr, 12), y: curY + 7, size: 12, font: fBold, color: C.green });

  // 5. Khối 3 chữ ký điện tử chính thức (Quản trị - Kế toán - Nhân sự)
  const sigH = 114, sigY = Math.max(46, Math.min(curY - sigH - 18, 170));
  page.drawText('XÁC NHẬN & CHỮ KÝ ĐIỆN TỬ BA BÊN (QUẢN TRỊ — KẾ TOÁN — NHÂN SỰ)', { x: M, y: sigY + sigH + 6, size: 8, font: fBold, color: C.slate });
  const sigGap = 9, sigW = (CW - sigGap * 2) / 3;
  const embeddedSigs = await Promise.all(input.signatures.map((s) => embedSignatureImage(pdfDoc, s.imageBytes)));
  input.signatures.forEach((slot, i) => {
    drawSignatureBox(page, M + i * (sigW + sigGap), sigY, sigW, sigH, slot, embeddedSigs[i] ?? null, fReg, fBold);
  });

  // 6. Chân trang bảo mật doanh nghiệp
  page.drawLine({ start: { x: M, y: 34 }, end: { x: W - M, y: 34 }, thickness: 0.6, color: C.border });
  const footer = `Tài liệu bảo mật nội bộ ${SYSTEM_CONFIG.brandName} · Kết xuất tự động từ Hệ thống Nhân sự ${SYSTEM_CONFIG.version} lúc ${dayjs().format('HH:mm DD/MM/YYYY')}`;
  page.drawText(footer, { x: M, y: 21, size: 7.2, font: fReg, color: C.slate });

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
