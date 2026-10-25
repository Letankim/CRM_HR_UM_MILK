'use client';

import { SYSTEM_CONFIG } from '@umbm/shared';

export interface ExcelColumn<TRow> {
  header: string;
  key?: keyof TRow;
  render?: (row: TRow, index: number) => string | number | null | undefined;
  align?: 'left' | 'center' | 'right';
  isCurrency?: boolean;
}

export interface ExportExcelOptions<TRow> {
  fileName: string;
  sheetTitle: string;
  subtitle?: string;
  columns: ExcelColumn<TRow>[];
  rows: TRow[];
  summaryRow?: (string | number)[];
}

function escapeHtml(val: unknown): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Xuất bảng dữ liệu ra định dạng Microsoft Excel (.xls) có tiêu đề doanh nghiệp,
 * định dạng cột, căn lề số tiền VNĐ và dòng tổng cộng cuối bảng.
 */
export function exportToExcel<TRow>({
  fileName,
  sheetTitle,
  subtitle,
  columns,
  rows,
  summaryRow,
}: ExportExcelOptions<TRow>): void {
  const colSpan = Math.max(columns.length, 2);
  const exportedAt = new Date().toLocaleString('vi-VN');

  const headerCells = columns
    .map(
      (col) =>
        `<th style="background-color:#0F172A;color:#FFFFFF;font-weight:700;padding:8px 10px;border:1px solid #CBD5E1;text-align:${col.align ?? (col.isCurrency ? 'right' : 'left')};">${escapeHtml(col.header)}</th>`,
    )
    .join('');

  const bodyRows = rows
    .map((row, idx) => {
      const cells = columns
        .map((col) => {
          const raw = col.render ? col.render(row, idx) : col.key ? row[col.key] : '';
          const align = col.align ?? (col.isCurrency ? 'right' : 'left');
          const formatted =
            col.isCurrency && typeof raw === 'number'
              ? `${raw.toLocaleString('vi-VN')} đ`
              : escapeHtml(raw ?? '');
          const bg = idx % 2 === 1 ? '#F8FAFC' : '#FFFFFF';
          return `<td style="background-color:${bg};padding:6px 10px;border:1px solid #E2E8F0;text-align:${align};mso-number-format:'\\@';">${formatted}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  const footerHtml = summaryRow
    ? `<tr>${summaryRow
        .map(
          (cell, i) =>
            `<td style="background-color:#EFF6FF;color:#0F172A;font-weight:700;padding:8px 10px;border:1px solid #93C5FD;text-align:${columns[i]?.isCurrency ? 'right' : 'left'};">${
              typeof cell === 'number' ? `${cell.toLocaleString('vi-VN')} đ` : escapeHtml(cell)
            }</td>`,
        )
        .join('')}</tr>`
    : '';

  const html = `\uFEFF<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8" /></head>
<body style="font-family:Inter,Arial,sans-serif;font-size:12px;color:#0F172A;">
  <table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;">
    <tr>
      <td colspan="${colSpan}" style="background-color:#0F172A;color:#FFFFFF;font-size:15px;font-weight:800;padding:10px;">
        ${escapeHtml(SYSTEM_CONFIG.brandName)} — ${escapeHtml(sheetTitle.toUpperCase())}
      </td>
    </tr>
    <tr>
      <td colspan="${colSpan}" style="background-color:#F8FAFC;color:#475569;font-size:11px;padding:6px 10px;border:1px solid #E2E8F0;">
        ${escapeHtml(subtitle ?? `Tổng số bản ghi: ${rows.length}`)} | Thời điểm xuất báo cáo: ${escapeHtml(exportedAt)}
      </td>
    </tr>
    <tr>${headerCells}</tr>
    ${bodyRows}
    ${footerHtml}
  </table>
</body>
</html>`;

  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.xls') ? fileName : `${fileName}.xls`;
  a.click();
  URL.revokeObjectURL(url);
}
