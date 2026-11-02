/**
 * Bộ giải mã chuẩn EMVCo TLV VietQR (30 mã BIN ngân hàng Việt Nam),
 * trích xuất dự phòng từ văn bản OCR và sinh liên kết VietQR động chuẩn Napas247 (Mục 4.3 & 11.6).
 */

export interface VietQrBankInfo {
  bin: string;
  code: string;
  shortName: string;
  fullName: string;
}

export const VIETQR_BANKS: readonly VietQrBankInfo[] = [
  { bin: '970436', code: 'VCB', shortName: 'Vietcombank', fullName: 'Ngân hàng TMCP Ngoại thương Việt Nam (Vietcombank)' },
  { bin: '970415', code: 'ICB', shortName: 'VietinBank', fullName: 'Ngân hàng TMCP Công thương Việt Nam (VietinBank)' },
  { bin: '970418', code: 'BIDV', shortName: 'BIDV', fullName: 'Ngân hàng TMCP Đầu tư và Phát triển Việt Nam (BIDV)' },
  { bin: '970405', code: 'VBA', shortName: 'Agribank', fullName: 'Ngân hàng Nông nghiệp và Phát triển Nông thôn (Agribank)' },
  { bin: '970407', code: 'TCB', shortName: 'Techcombank', fullName: 'Ngân hàng TMCP Kỹ thương Việt Nam (Techcombank)' },
  { bin: '970422', code: 'MB', shortName: 'MB Bank', fullName: 'Ngân hàng TMCP Quân đội (MB Bank)' },
  { bin: '970416', code: 'ACB', shortName: 'ACB', fullName: 'Ngân hàng TMCP Á Châu (ACB)' },
  { bin: '970432', code: 'VPB', shortName: 'VPBank', fullName: 'Ngân hàng TMCP Việt Nam Thịnh Vượng (VPBank)' },
  { bin: '970423', code: 'TPB', shortName: 'TPBank', fullName: 'Ngân hàng TMCP Tiên Phong (TPBank)' },
  { bin: '970403', code: 'STB', shortName: 'Sacombank', fullName: 'Ngân hàng TMCP Sài Gòn Thương Tín (Sacombank)' },
  { bin: '970437', code: 'HDB', shortName: 'HDBank', fullName: 'Ngân hàng TMCP Phát triển TP.HCM (HDBank)' },
  { bin: '970441', code: 'VIB', shortName: 'VIB', fullName: 'Ngân hàng TMCP Quốc tế Việt Nam (VIB)' },
  { bin: '970443', code: 'SHB', shortName: 'SHB', fullName: 'Ngân hàng TMCP Sài Gòn - Hà Nội (SHB)' },
  { bin: '970431', code: 'EIB', shortName: 'Eximbank', fullName: 'Ngân hàng TMCP Xuất Nhập khẩu Việt Nam (Eximbank)' },
  { bin: '970426', code: 'MSB', shortName: 'MSB', fullName: 'Ngân hàng TMCP Hàng Hải Việt Nam (MSB)' },
  { bin: '970448', code: 'OCB', shortName: 'OCB', fullName: 'Ngân hàng TMCP Phương Đông (OCB)' },
  { bin: '970440', code: 'SEAB', shortName: 'SeABank', fullName: 'Ngân hàng TMCP Đông Nam Á (SeABank)' },
  { bin: '970449', code: 'LPB', shortName: 'LPBank', fullName: 'Ngân hàng TMCP Lộc Phát Việt Nam (LPBank)' },
  { bin: '970428', code: 'NAB', shortName: 'Nam A Bank', fullName: 'Ngân hàng TMCP Nam Á (Nam A Bank)' },
  { bin: '970425', code: 'ABB', shortName: 'ABBank', fullName: 'Ngân hàng TMCP An Bình (ABBank)' },
  { bin: '970409', code: 'BAB', shortName: 'Bac A Bank', fullName: 'Ngân hàng TMCP Bắc Á (Bac A Bank)' },
  { bin: '970433', code: 'VIETBANK', shortName: 'VietBank', fullName: 'Ngân hàng TMCP Việt Nam Thương Tín (VietBank)' },
  { bin: '970454', code: 'BVB', shortName: 'BVBank (Timo)', fullName: 'Ngân hàng TMCP Bản Việt (BVBank / Timo)' },
  { bin: '546034', code: 'CAKE', shortName: 'CAKE by VPBank', fullName: 'Ngân hàng số CAKE by VPBank' },
  { bin: '546035', code: 'UBANK', shortName: 'Ubank by VPBank', fullName: 'Ngân hàng số Ubank by VPBank' },
  { bin: '970424', code: 'SHBVN', shortName: 'Shinhan Bank', fullName: 'Ngân hàng TNHH MTV Shinhan Việt Nam' },
  { bin: '970457', code: 'WVN', shortName: 'Woori Bank', fullName: 'Ngân hàng TNHH MTV Woori Việt Nam' },
  { bin: '458761', code: 'HSBC', shortName: 'HSBC', fullName: 'Ngân hàng TNHH MTV HSBC Việt Nam' },
  { bin: '970410', code: 'SCVN', shortName: 'Standard Chartered', fullName: 'Ngân hàng Standard Chartered Việt Nam' },
  { bin: '970452', code: 'KLB', shortName: 'KienlongBank', fullName: 'Ngân hàng TMCP Kiên Long (KienlongBank)' },
] as const;

/** Phân tích cấu trúc TLV (Tag-Length-Value) chuẩn EMVCo (2 ký tự Tag + 2 ký tự Độ dài + Value). */
export function parseEmvcoTlvMap(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  let idx = 0;
  while (idx + 4 <= raw.length) {
    const tag = raw.slice(idx, idx + 2);
    const len = Number.parseInt(raw.slice(idx + 2, idx + 4), 10);
    if (!Number.isFinite(len) || len < 0 || idx + 4 + len > raw.length) break;
    const val = raw.slice(idx + 4, idx + 4 + len);
    map.set(tag, val);
    idx += 4 + len;
  }
  return map;
}

export function findVietQrBank(query: string): VietQrBankInfo | null {
  const q = String(query ?? '').trim().toUpperCase();
  if (!q) return null;
  for (const b of VIETQR_BANKS) {
    if (
      b.bin === q ||
      b.code.toUpperCase() === q ||
      b.shortName.toUpperCase() === q ||
      q.includes(b.bin) ||
      q.includes(b.shortName.toUpperCase()) ||
      q.includes(b.code.toUpperCase())
    ) {
      return b;
    }
  }
  return null;
}

export interface ParsedVietQrResult {
  bankBin: string;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
}

/**
 * Giải mã chuỗi dữ liệu mã QR ngân hàng theo chuẩn EMVCo TLV VietQR (Napas247).
 * Tag 38 chứa thông tin định tuyến Napas -> Subtag 01 chứa Subtag 00 (Mã BIN 6 số) và Subtag 01 (Số tài khoản).
 */
export function parseVietQrEmvcoPayload(qrRaw: string): ParsedVietQrResult | null {
  const raw = String(qrRaw ?? '').trim();
  if (!raw.startsWith('000201')) return null;
  const root = parseEmvcoTlvMap(raw);
  const tag38 = root.get('38');
  if (!tag38) return null;
  const sub38 = parseEmvcoTlvMap(tag38);
  const beneficiary = sub38.get('01');
  if (!beneficiary) return null;
  const subBen = parseEmvcoTlvMap(beneficiary);
  const bankBin = (subBen.get('00') ?? '').trim();
  const accountNumber = (subBen.get('01') ?? '').trim();
  if (!bankBin || !accountNumber) return null;
  const bank = findVietQrBank(bankBin);
  const holder = (root.get('59') ?? '').trim().toUpperCase();
  return {
    bankBin,
    bankCode: bank?.code ?? bankBin,
    bankName: bank?.shortName ?? `Ngân hàng (${bankBin})`,
    accountNumber,
    accountHolder: holder,
  };
}

/**
 * Dự phòng trích xuất thông tin ngân hàng từ văn bản OCR (khi ảnh chỉ là ảnh chụp màn hình STK hoặc thẻ).
 * Quét chuỗi số từ 8 - 19 chữ số và tên ngân hàng trong danh sách 30 ngân hàng Việt Nam.
 */
export function extractBankAccountFromOcrText(text: string): ParsedVietQrResult | null {
  const clean = String(text ?? '').trim();
  if (!clean) return null;
  const bank = findVietQrBank(clean);
  const accMatch = clean.replace(/[.\-]/g, '').match(/\b(\d{8,19})\b/);
  if (!accMatch?.[1]) return null;
  const lines = clean
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const holderLine =
    lines.find((l) => /^[A-Z\s]{5,40}$/.test(l) && !/\b(NGAN HANG|BANK|VIETQR|NAPAS)\b/.test(l)) ?? '';
  return {
    bankBin: bank?.bin ?? '970436',
    bankCode: bank?.code ?? 'VCB',
    bankName: bank?.shortName ?? 'Vietcombank',
    accountNumber: accMatch[1],
    accountHolder: holderLine,
  };
}

/**
 * Sinh đường dẫn ảnh VietQR động chuẩn Napas247 cho Kế toán quét thanh toán lương (Mục 11.6):
 * https://img.vietqr.io/image/{Ngân_hàng}-{STK}-compact2.png?amount={Thực_lãnh}&addInfo=LUONG {Kỳ} {Mã_NV}
 */
export function buildDynamicVietQrUrl(params: {
  bankNameOrBin: string;
  accountNumber: string;
  accountHolder?: string;
  amountVnd: number;
  periodCode: string;
  employeeCode: string;
}): string {
  const acct = String(params.accountNumber ?? '').replace(/\s+/g, '');
  if (!acct) return '';
  const bank = findVietQrBank(params.bankNameOrBin);
  const bankId = bank?.bin ?? bank?.code ?? (String(params.bankNameOrBin || 'VCB').trim() || 'VCB');
  const amount = Math.max(0, Math.round(Number(params.amountVnd) || 0));
  const addInfo = `LUONG ${String(params.periodCode || '').trim()} ${String(params.employeeCode || '').trim()}`.trim();
  const parts = [`amount=${encodeURIComponent(String(amount))}`, `addInfo=${encodeURIComponent(addInfo)}`];
  if (params.accountHolder?.trim()) {
    parts.push(`accountName=${encodeURIComponent(params.accountHolder.trim().toUpperCase())}`);
  }
  return `https://img.vietqr.io/image/${encodeURIComponent(bankId)}-${encodeURIComponent(acct)}-compact2.png?${parts.join('&')}`;
}
