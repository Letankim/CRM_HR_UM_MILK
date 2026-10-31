import { readFileSync } from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, type PDFFont, type PDFImage } from 'pdf-lib';
import { SYSTEM_CONFIG } from '@umbm/shared';
import { dayjs } from '../lib/time.js';
import {
  BLACK, BORDER_W, docSoTienBangChu, drawBorderedTableRow, embedPdfSignatureImage,
  ensurePageSpace, PDF_A4_H, PDF_A4_W, PDF_MARGIN, PDF_TABLE_W, WHITE, wrapPdfText, type PdfCursor,
} from './payslip-pdf-table-helpers.js';

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

function drawThreeSignatureTableRow(
  cursor: PdfCursor,
  slots: [PayslipPdfSignatureSlot, PayslipPdfSignatureSlot, PayslipPdfSignatureSlot],
  images: (PDFImage | null)[],
  fReg: PDFFont,
  fBold: PDFFont,
): void {
  const w1 = Math.floor((PDF_TABLE_W / 3) * 100) / 100;
  const widths = [w1, w1, PDF_TABLE_W - w1 * 2];
  const padX = 6, padY = 7, imgBoxH = 54;

  const prepared = slots.map((slot, idx) => {
    const cellW = widths[idx]!, innerW = cellW - padX * 2;
    const titleLines = wrapPdfText(slot.roleTitle, fBold, 8.8, innerW);
    const subLines = wrapPdfText('Ký và ghi rõ họ tên', fReg, 7.8, innerW);
    const nameLines = wrapPdfText(slot.signerName || '—', fBold, 8.8, innerW);
    const tsLines = wrapPdfText(slot.signedAt ? `Ngày ký: ${fmtTs(slot.signedAt)}` : 'Chưa ký', fReg, 7.6, innerW);
    const topH = titleLines.length * 12 + subLines.length * 10.5;
    const botH = nameLines.length * 12 + tsLines.length * 10.5;
    return { cellW, titleLines, subLines, nameLines, tsLines, topH, botH, totalH: padY * 2 + topH + imgBoxH + botH + 6 };
  });

  const rowH = Math.max(122, ...prepared.map((p) => p.totalH));
  ensurePageSpace(cursor, rowH + 18);

  let curX = PDF_MARGIN;
  const bottomY = cursor.y - rowH;
  prepared.forEach((cell, idx) => {
    cursor.page.drawRectangle({ x: curX, y: bottomY, width: cell.cellW, height: rowH, color: WHITE, borderColor: BLACK, borderWidth: BORDER_W });
    let ty = cursor.y - padY - 8;
    for (const line of cell.titleLines) {
      const tw = fBold.widthOfTextAtSize(line, 8.8);
      cursor.page.drawText(line, { x: curX + Math.max(padX, (cell.cellW - tw) / 2), y: ty, size: 8.8, font: fBold, color: BLACK });
      ty -= 12;
    }
    for (const line of cell.subLines) {
      const tw = fReg.widthOfTextAtSize(line, 7.8);
      cursor.page.drawText(line, { x: curX + Math.max(padX, (cell.cellW - tw) / 2), y: ty, size: 7.8, font: fReg, color: BLACK });
      ty -= 10.5;
    }

    const img = images[idx] ?? null;
    const imgZoneBottom = bottomY + padY + cell.botH + 4;
    const imgZoneH = Math.max(44, ty - imgZoneBottom + 4);
    if (img) {
      const maxW = cell.cellW - 22, maxH = Math.min(50, imgZoneH - 4);
      const scale = Math.min(maxW / img.width, maxH / img.height, 1.35);
      const drawW = img.width * scale, drawH = img.height * scale;
      cursor.page.drawImage(img, { x: curX + (cell.cellW - drawW) / 2, y: imgZoneBottom + (imgZoneH - drawH) / 2, width: drawW, height: drawH });
    }

    let by = bottomY + padY + cell.botH - 9;
    for (const line of cell.nameLines) {
      const tw = fBold.widthOfTextAtSize(line, 8.8);
      cursor.page.drawText(line, { x: curX + Math.max(padX, (cell.cellW - tw) / 2), y: by, size: 8.8, font: fBold, color: BLACK });
      by -= 12;
    }
    for (const line of cell.tsLines) {
      const tw = fReg.widthOfTextAtSize(line, 7.6);
      cursor.page.drawText(line, { x: curX + Math.max(padX, (cell.cellW - tw) / 2), y: by, size: 7.6, font: fReg, color: BLACK });
      by -= 10.5;
    }
    curX += cell.cellW;
  });

  cursor.y = bottomY;
}

export async function renderPayslipPdf(input: PayslipPdfInput): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const { regular, bold } = loadFontBytes();
  const fReg = await pdfDoc.embedFont(regular, { subset: true });
  const fBold = await pdfDoc.embedFont(bold, { subset: true });

  const cursor: PdfCursor = { doc: pdfDoc, page: pdfDoc.addPage([PDF_A4_W, PDF_A4_H]), y: PDF_A4_H - PDF_MARGIN };

  // 1. Đầu bảng: Đơn vị & Mã phiếu + Tiêu đề PHIẾU LƯƠNG
  drawBorderedTableRow(cursor, [
    { width: 330, lines: [`Đơn vị: ${SYSTEM_CONFIG.brandName}`, 'Hệ thống Quản trị Nhân sự & Tiền lương'], font: fBold, size: 9.2 },
    { width: PDF_TABLE_W - 330, lines: [`Mã phiếu: ${input.payslipCode}`, 'Đơn vị tính: VNĐ'], font: fReg, size: 8.8, align: 'right' },
  ], { padY: 6 });

  drawBorderedTableRow(cursor, [{
    width: PDF_TABLE_W,
    lines: ['PHIẾU LƯƠNG NHÂN VIÊN', `Kỳ lương: ${input.periodName} (${input.periodCode}) — Từ ngày ${fmtDate(input.fromDate)} đến ngày ${fmtDate(input.toDate)}`],
    font: fBold, size: 11.2, align: 'center',
  }], { padY: 7 });

  // 2. Bảng thông tin Nhân sự, Công lương & Ngân hàng (tự động xuống dòng khi dài, không bao giờ cắt "...")
  const cL1 = 92, cV1 = 169.64, cL2 = 104, cV2 = PDF_TABLE_W - cL1 - cV1 - cL2;
  const statusDetail = `${input.statusLabel}${input.revision > 1 ? ` (Điều chỉnh lần ${input.revision})` : ''}${input.paymentReference ? ` — Mã GD: ${input.paymentReference}` : ''}`;
  const bankHolderText = [input.bankAccountNumber || 'Chưa cập nhật', input.bankAccountHolder || input.fullName].filter(Boolean).join(' — ');
  const infoRows: Array<[string, string, PDFFont, string, string]> = [
    ['Mã nhân viên', input.employeeCode, fBold, 'Trạng thái phiếu', statusDetail],
    ['Họ và tên', input.fullName, fBold, 'Mức lương áp dụng', input.rateSummary],
    ['Chi nhánh', input.branchName, fReg, 'Ngày công / Giờ công', input.workSummary],
    ['Chức danh', input.stageLabel, fReg, 'Đối soát chấm công', input.attendanceSummary],
    ['Ngân hàng', input.bankName || 'Chưa cập nhật', fReg, 'Số TK / Chủ TK', bankHolderText],
  ];
  for (const [l1, v1, font1, l2, v2] of infoRows) {
    drawBorderedTableRow(cursor, [
      { width: cL1, lines: [l1], font: fBold, size: 8.6 },
      { width: cV1, lines: [v1 || '—'], font: font1, size: 8.8 },
      { width: cL2, lines: [l2], font: fBold, size: 8.6 },
      { width: cV2, lines: [v2 || '—'], font: fReg, size: 8.6 },
    ]);
  }

  // 3. Bảng chi tiết các khoản thu nhập, phụ cấp & khấu trừ
  const wStt = 34, wLabel = 166, wDetail = 219.28, wAmt = PDF_TABLE_W - wStt - wLabel - wDetail;
  drawBorderedTableRow(cursor, [
    { width: wStt, lines: ['STT'], font: fBold, size: 8.8, align: 'center' },
    { width: wLabel, lines: ['Các khoản thu nhập / Khấu trừ'], font: fBold, size: 8.8, align: 'center' },
    { width: wDetail, lines: ['Diễn giải chi tiết cách tính'], font: fBold, size: 8.8, align: 'center' },
    { width: wAmt, lines: ['Số tiền (VNĐ)'], font: fBold, size: 8.8, align: 'center' },
  ], { padY: 6 });

  input.lines.forEach((line, idx) => {
    drawBorderedTableRow(cursor, [
      { width: wStt, lines: [String(idx + 1)], font: fReg, size: 8.6, align: 'center' },
      { width: wLabel, lines: [line.label], font: fReg, size: 8.8 },
      { width: wDetail, lines: [line.detail], font: fReg, size: 8.5 },
      { width: wAmt, lines: [fmtMoney(line.amountVnd)], font: fBold, size: 8.8, align: 'right' },
    ]);
  });

  // 4. Các dòng tổng cộng & Thực nhận + Bằng chữ
  const wSumLabel = wStt + wLabel + wDetail;
  drawBorderedTableRow(cursor, [{ width: wSumLabel, lines: ['Tổng cộng các khoản thu nhập'], font: fBold, size: 9 }, { width: wAmt, lines: [fmtMoney(input.grossVnd)], font: fBold, size: 9, align: 'right' }]);
  drawBorderedTableRow(cursor, [{ width: wSumLabel, lines: ['Tổng các khoản trừ vào lương'], font: fBold, size: 9 }, { width: wAmt, lines: [input.totalDeductionsVnd > 0 ? `-${fmtMoney(Math.abs(input.totalDeductionsVnd))}` : fmtMoney(0)], font: fBold, size: 9, align: 'right' }]);
  drawBorderedTableRow(cursor, [{ width: wSumLabel, lines: ['Tổng số tiền lương thực nhận'], font: fBold, size: 9.8 }, { width: wAmt, lines: [fmtMoney(input.netVnd)], font: fBold, size: 10.2, align: 'right' }], { padY: 6 });
  drawBorderedTableRow(cursor, [{ width: cL1, lines: ['Bằng chữ'], font: fBold, size: 8.8 }, { width: PDF_TABLE_W - cL1, lines: [docSoTienBangChu(input.netVnd)], font: fReg, size: 8.8 }]);

  // 5. Ô chữ ký 3 bên ngay trong khung bảng (Quản trị — Kế toán — Nhân viên)
  const embeddedSigs = await Promise.all(input.signatures.map((s) => embedPdfSignatureImage(pdfDoc, s.imageBytes)));
  drawThreeSignatureTableRow(cursor, input.signatures, embeddedSigs, fReg, fBold);

  if (cursor.y - 14 >= 18) {
    cursor.page.drawText(`Ngày xuất phiếu: ${dayjs().format('HH:mm DD/MM/YYYY')} — ${SYSTEM_CONFIG.brandName}`, { x: PDF_MARGIN, y: cursor.y - 12, size: 7.5, font: fReg, color: BLACK });
  }
  return Buffer.from(await pdfDoc.save());
}
