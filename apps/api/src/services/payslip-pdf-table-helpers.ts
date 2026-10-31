import { rgb, type PDFDocument, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';

export const PDF_A4_W = 595.28;
export const PDF_A4_H = 841.89;
export const PDF_MARGIN = 36;
export const PDF_TABLE_W = PDF_A4_W - PDF_MARGIN * 2;
export const BLACK = rgb(0, 0, 0);
export const WHITE = rgb(1, 1, 1);
export const BORDER_W = 0.65;

export interface PdfCursor {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
}

export interface TableCellSpec {
  width: number;
  lines: string[];
  font: PDFFont;
  size?: number;
  align?: 'left' | 'center' | 'right';
  padX?: number;
}

/** Ngắt dòng tự động chuẩn tiếng Việt — tuyệt đối không cắt chữ bằng "..." */
export function wrapPdfText(rawText: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const safeMax = Math.max(16, maxWidth);
  const normalized = String(rawText ?? '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return ['—'];

  const breakLongWord = (word: string): string[] => {
    if (font.widthOfTextAtSize(word, size) <= safeMax) return [word];
    const parts: string[] = [];
    let cur = '';
    for (const ch of word) {
      const next = cur + ch;
      if (cur && font.widthOfTextAtSize(next, size) > safeMax) {
        parts.push(cur);
        cur = ch;
      } else {
        cur = next;
      }
    }
    if (cur) parts.push(cur);
    return parts;
  };

  const out: string[] = [];
  for (const para of normalized.split('\n')) {
    const cleanPara = para.replace(/\s+/g, ' ').trim();
    if (!cleanPara) {
      out.push('');
      continue;
    }
    const tokens = cleanPara.split(' ').flatMap(breakLongWord);
    let current = '';
    for (const tok of tokens) {
      const candidate = current ? `${current} ${tok}` : tok;
      if (!current || font.widthOfTextAtSize(candidate, size) <= safeMax) {
        current = candidate;
      } else {
        out.push(current);
        current = tok;
      }
    }
    if (current) out.push(current);
  }
  return out.length > 0 ? out : ['—'];
}

export function ensurePageSpace(cursor: PdfCursor, neededHeight: number): void {
  if (cursor.y - neededHeight >= PDF_MARGIN) return;
  cursor.page = cursor.doc.addPage([PDF_A4_W, PDF_A4_H]);
  cursor.y = PDF_A4_H - PDF_MARGIN;
}

/** Vẽ 1 dòng bảng kế toán đen trắng liền mạch, tự động giãn chiều cao theo số dòng chữ đã xuống dòng. */
export function drawBorderedTableRow(
  cursor: PdfCursor,
  cells: TableCellSpec[],
  opts?: { minHeight?: number; padY?: number; lineGap?: number },
): void {
  const padY = opts?.padY ?? 5;
  const lineGap = opts?.lineGap ?? 3.4;
  const prepared = cells.map((cell) => {
    const size = cell.size ?? 9;
    const padX = cell.padX ?? 6;
    const wrapped = cell.lines.flatMap((line) => wrapPdfText(line, cell.font, size, cell.width - padX * 2));
    const lineH = size + lineGap;
    return { ...cell, size, padX, wrapped, lineH, contentH: wrapped.length * lineH };
  });

  const maxContentH = prepared.reduce((m, c) => Math.max(m, c.contentH), 0);
  const rowH = Math.max(opts?.minHeight ?? 20, maxContentH + padY * 2);
  ensurePageSpace(cursor, rowH);

  let curX = PDF_MARGIN;
  const rowBottomY = cursor.y - rowH;
  for (const cell of prepared) {
    cursor.page.drawRectangle({
      x: curX,
      y: rowBottomY,
      width: cell.width,
      height: rowH,
      color: WHITE,
      borderColor: BLACK,
      borderWidth: BORDER_W,
    });
    let textY = cursor.y - padY - cell.size + 1;
    for (const line of cell.wrapped) {
      if (line) {
        const tw = cell.font.widthOfTextAtSize(line, cell.size);
        const tx =
          cell.align === 'center'
            ? curX + Math.max(cell.padX, (cell.width - tw) / 2)
            : cell.align === 'right'
              ? curX + Math.max(cell.padX, cell.width - cell.padX - tw)
              : curX + cell.padX;
        cursor.page.drawText(line, { x: tx, y: textY, size: cell.size, font: cell.font, color: BLACK });
      }
      textY -= cell.lineH;
    }
    curX += cell.width;
  }
  cursor.y = rowBottomY;
}

export async function embedPdfSignatureImage(pdfDoc: PDFDocument, raw?: Buffer | null): Promise<PDFImage | null> {
  if (!raw || raw.length < 32) return null;
  try {
    if (raw[0] === 0x89 && raw[1] === 0x50 && raw[2] === 0x4e && raw[3] === 0x47) return await pdfDoc.embedPng(raw);
    if (raw[0] === 0xff && raw[1] === 0xd8 && raw[2] === 0xff) return await pdfDoc.embedJpg(raw);
    return await pdfDoc.embedPng(raw).catch(() => pdfDoc.embedJpg(raw));
  } catch {
    return null;
  }
}

const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
const UNITS = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ'];

function readThreeDigits(num: number, fullGroup: boolean): string {
  const h = Math.floor(num / 100);
  const t = Math.floor((num % 100) / 10);
  const u = num % 10;
  const parts: string[] = [];
  if (h > 0 || fullGroup) parts.push(`${DIGITS[h]} trăm`);
  if (t > 1) {
    parts.push(`${DIGITS[t]} mươi`);
    if (u === 1) parts.push('mốt');
    else if (u === 5) parts.push('lăm');
    else if (u > 0) parts.push(DIGITS[u]!);
  } else if (t === 1) {
    parts.push('mười');
    if (u === 5) parts.push('lăm');
    else if (u > 0) parts.push(DIGITS[u]!);
  } else if (u > 0) {
    if (h > 0 || fullGroup) parts.push('lẻ');
    parts.push(DIGITS[u]!);
  }
  return parts.join(' ');
}

/** Đọc số tiền VNĐ thành chữ tiếng Việt chuẩn kế toán (VD: "Một triệu ba trăm chín mươi ba nghìn đồng chẵn"). */
export function docSoTienBangChu(amountVnd: number): string {
  const rounded = Math.round(amountVnd || 0);
  if (rounded === 0) return 'Không đồng';
  const isNeg = rounded < 0;
  let n = Math.abs(rounded);
  const groups: number[] = [];
  while (n > 0) {
    groups.push(n % 1000);
    n = Math.floor(n / 1000);
  }
  const chunks: string[] = [];
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const g = groups[i]!;
    if (g === 0) continue;
    const text = readThreeDigits(g, i < groups.length - 1);
    const unit = UNITS[i] ?? '';
    chunks.push(unit ? `${text} ${unit}` : text);
  }
  const body = chunks.join(' ').replace(/\s+/g, ' ').trim();
  const suffix = Math.abs(rounded) % 1000 === 0 ? 'đồng chẵn' : 'đồng';
  const full = `${isNeg ? 'Âm ' : ''}${body} ${suffix}`;
  return full.charAt(0).toUpperCase() + full.slice(1);
}
