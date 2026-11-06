/**
 * Bộ giải mã chuẩn EMVCo TLV VietQR (30 mã BIN ngân hàng Việt Nam),
 * trích xuất dự phòng từ văn bản OCR và sinh liên kết VietQR động chuẩn Napas247 (Mục 4.3 & 11.6).
 */

export interface VietQrBankInfo {
  bin: string; code: string; shortName: string; fullName: string;
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

interface EncLike { encode(s?: string): Uint8Array; }
interface DecLike { decode(b?: Uint8Array): string; }
interface UrlLike { pathname: string; searchParams: { get(k: string): string | null }; }
const getEnc = (): EncLike | null => { const C = (globalThis as unknown as { TextEncoder?: new () => EncLike }).TextEncoder; return C ? new C() : null; };
const getDec = (): DecLike | null => { const C = (globalThis as unknown as { TextDecoder?: new (l?: string) => DecLike }).TextDecoder; return C ? new C('utf-8') : null; };
const parseUrl = (raw: string): UrlLike | null => { try { const C = (globalThis as unknown as { URL?: new (s: string) => UrlLike }).URL; return C ? new C(raw) : null; } catch { return null; } };

export function cleanAccountHolder(raw?: string | null): string {
  if (!raw) return '';
  let str = String(raw).trim();
  str = str.replace(/^(?:CH[ỦU]\s*(?:T[ÀA]I\s*KHO[ẢA]N|TK)|T[ÊE]N\s*(?:CH[ỦU]\s*)?(?:T[ÀA]I\s*KHO[ẢA]N|TK|TH[ẺE])|NG[ƯU][ỜO]I\s*TH[ỤU]\s*H[ƯU][ỞO]NG|ACCOUNT\s*(?:NAME|HOLDER)|BENEFICIARY|CTK)\s*[:：\-]?\s*/i, '');
  str = str.replace(/\s*[-–(]\s*(?:MB|VCB|TCB|ACB|BIDV|CTG|VPB|TPB|VIB|SHB|OCB|MSB|AGRI|VIETIN|VIETCOM|TECHCOM|SACOM|MBBANK|SEABANK|LPBANK|CAKE|TIMO|NAPAS|NAPAS247|BANK)\b.*$/i, '');
  str = str.trim().replace(/\s+/g, ' ').toUpperCase();
  const INVALID = /^(?:NA|N\/A|NULL|VIETQR|NAPAS|KHACH\s*HANG|CUSTOMER|PERSONAL|KHONG\s*XAC\s*DINH|\d+)$/i;
  return INVALID.test(str) || str.length < 3 ? '' : str;
}

/** Phân tích cấu trúc TLV chuẩn EMVCo an toàn với byte UTF-8. */
export function parseEmvcoTlvMap(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw) return map;
  const enc = getEnc(), dec = getDec();
  if (enc && dec) {
    const bytes = enc.encode(raw);
    let idx = 0;
    while (idx + 4 <= bytes.length) {
      const tag = dec.decode(bytes.subarray(idx, idx + 2));
      const len = Number.parseInt(dec.decode(bytes.subarray(idx + 2, idx + 4)), 10);
      if (!Number.isFinite(len) || len < 0 || idx + 4 + len > bytes.length) break;
      map.set(tag, dec.decode(bytes.subarray(idx + 4, idx + 4 + len)));
      idx += 4 + len;
    }
    return map;
  }
  let idx = 0;
  while (idx + 4 <= raw.length) {
    const tag = raw.slice(idx, idx + 2), len = Number.parseInt(raw.slice(idx + 2, idx + 4), 10);
    if (!Number.isFinite(len) || len < 0 || idx + 4 + len > raw.length) break;
    map.set(tag, raw.slice(idx + 4, idx + 4 + len));
    idx += 4 + len;
  }
  return map;
}

export function findVietQrBank(query: string): VietQrBankInfo | null {
  const q = String(query ?? '').trim().toUpperCase();
  if (!q) return null;
  for (const b of VIETQR_BANKS) {
    if (b.bin === q || b.code.toUpperCase() === q || b.shortName.toUpperCase() === q || q.includes(b.bin) || q.includes(b.shortName.toUpperCase()) || q.includes(b.code.toUpperCase())) return b;
  }
  return null;
}

export interface ParsedVietQrResult {
  bankBin: string; bankCode: string; bankName: string; accountNumber: string; accountHolder: string;
}

/** Trích xuất tên chủ tài khoản từ URL parameters, nhãn tiền tố hoặc dòng tên người tiếng Việt. */
export function extractHolderFromText(text: string): string {
  const clean = String(text ?? '').trim(), urlMatch = clean.match(/https?:\/\/[^\s]+/i);
  if (urlMatch) {
    const u = parseUrl(urlMatch[0]);
    const p = u?.searchParams.get('accountName') || u?.searchParams.get('name') || u?.searchParams.get('accountHolder') || u?.searchParams.get('holder');
    if (p) return cleanAccountHolder(decodeURIComponent(p));
  }
  const prefixRegex = /(?:Ch[ủu]\s*(?:t[àa]i\s*kho[ảa]n|TK)|T[êe]n\s*(?:ch[ủu]\s*)?(?:t[àa]i\s*kho[ảa]n|TK|th[ẻe])|Ng[ưu][ờo]i\s*th[ụu]\s*h[ưu][ởo]ng|Account\s*(?:Name|Holder)|Beneficiary|CTK)\s*[:：\-]?\s*([A-Za-zÀ-ỹĐđ\s]+?)(?=$|[\r\n,;.]|\s+(?:STK|S[ốo]|Ng[âa]n|Bank|\d{4,}))/i;
  const pMatch = clean.match(prefixRegex);
  if (pMatch?.[1]) {
    const name = cleanAccountHolder(pMatch[1]);
    if (name) return name;
  }
  const lines = clean.replace(/[_\-]/g, ' ').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const EXCLUDED = /\b(NGAN HANG|BANK|VIETQR|NAPAS|QUET MA|CHUYEN TIEN|SO TAI KHOAN|STK|VND|THANH TOAN|CONG TY|CHI NHANH|TAI KHOAN|VIETINBANK|VIETCOMBANK|TECHCOMBANK|AGRIBANK|SACOMBANK|VPBANK|TPBANK|SHB|OCB|ACB|MBBANK|BIDV)\b/i;
  for (const line of lines) {
    if (EXCLUDED.test(line)) continue;
    if (/^[A-ZÀ-ỸĐa-zà-ỹđ\s]{4,45}$/u.test(line)) {
      const words = line.trim().split(/\s+/);
      if (words.length >= 2 && words.length <= 6) {
        const candidate = cleanAccountHolder(line);
        if (candidate) return candidate;
      }
    }
  }
  return '';
}

/** Giải mã chuỗi dữ liệu mã QR ngân hàng theo chuẩn EMVCo TLV VietQR (Napas247). */
export function parseVietQrEmvcoPayload(qrRaw: string): ParsedVietQrResult | null {
  const raw = String(qrRaw ?? '').trim();
  if (!raw.startsWith('000201')) return null;
  const root = parseEmvcoTlvMap(raw);
  const tag38 = root.get('38') ?? root.get('26');
  if (!tag38) return null;
  const sub38 = parseEmvcoTlvMap(tag38);
  const beneficiary = sub38.get('01') ?? sub38.get('00');
  if (!beneficiary) return null;
  const subBen = parseEmvcoTlvMap(beneficiary);
  const bankBin = (subBen.get('00') ?? '').trim();
  const accountNumber = (subBen.get('01') ?? '').trim();
  if (!bankBin || !accountNumber) return null;
  const bank = findVietQrBank(bankBin);

  // Trích xuất Chủ tài khoản: Tag 64 (Unicode) -> Tag 59 (Merchant Name) -> Tag 62 (Additional Data)
  const tag64 = root.get('64') ? parseEmvcoTlvMap(root.get('64')!) : null;
  const tag62 = root.get('62') ? parseEmvcoTlvMap(root.get('62')!) : null;
  const holder64 = cleanAccountHolder(tag64?.get('01'));
  const holder59 = cleanAccountHolder(root.get('59'));
  const holder62 = cleanAccountHolder(tag62?.get('08') || tag62?.get('06') || tag62?.get('01'));
  const holder = holder64 || holder59 || holder62;

  return {
    bankBin, bankCode: bank?.code ?? bankBin,
    bankName: bank?.shortName ?? `Ngân hàng (${bankBin})`,
    accountNumber, accountHolder: holder,
  };
}

/** Trích xuất tài khoản từ URL VietQR / liên kết thanh toán nhanh. */
export function parseVietQrUrlPayload(urlStr: string): ParsedVietQrResult | null {
  const raw = String(urlStr ?? '').trim();
  const urlMatch = raw.match(/https?:\/\/[^\s]+/i) || raw.match(/vietqr:\/\/[^\s]+/i);
  if (!urlMatch) return null;
  const u = parseUrl(urlMatch[0]);
  if (!u) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  let bankStr = '', accStr = '';
  for (const p of parts) {
    const m = p.match(/^([a-zA-Z0-9]+)[-_](\d{6,24})(?:[-_]|$)/);
    if (m) { bankStr = m[1]!; accStr = m[2]!; break; }
  }
  if (!accStr && parts.length >= 2) {
    const last = parts[parts.length - 1]!, prev = parts[parts.length - 2]!;
    if (/^\d{6,24}$/.test(last)) { accStr = last; bankStr = prev; }
  }
  if (!accStr) accStr = u.searchParams.get('acc') || u.searchParams.get('account') || u.searchParams.get('accountNumber') || '';
  if (!bankStr) bankStr = u.searchParams.get('bank') || u.searchParams.get('bin') || '';
  if (!accStr) return null;
  const bank = findVietQrBank(bankStr);
  const rawHolder = u.searchParams.get('accountName') || u.searchParams.get('name') || u.searchParams.get('accountHolder') || u.searchParams.get('holder') || '';
  return {
    bankBin: bank?.bin ?? '970436', bankCode: bank?.code ?? 'VCB', bankName: bank?.shortName ?? 'Vietcombank',
    accountNumber: accStr, accountHolder: cleanAccountHolder(decodeURIComponent(rawHolder)),
  };
}

/** Dự phòng trích xuất thông tin ngân hàng từ văn bản OCR hoặc liên kết. */
export function extractBankAccountFromOcrText(text: string): ParsedVietQrResult | null {
  const clean = String(text ?? '').trim();
  if (!clean) return null;
  const fromUrl = parseVietQrUrlPayload(clean);
  if (fromUrl) return fromUrl;
  const bank = findVietQrBank(clean);
  const accMatch = clean.replace(/[.\-]/g, '').match(/\b(\d{8,19})\b/);
  if (!accMatch?.[1]) return null;
  return {
    bankBin: bank?.bin ?? '970436', bankCode: bank?.code ?? 'VCB', bankName: bank?.shortName ?? 'Vietcombank',
    accountNumber: accMatch[1], accountHolder: extractHolderFromText(clean),
  };
}

/** Sinh đường dẫn ảnh VietQR động chuẩn Napas247 cho Kế toán quét thanh toán lương (Mục 11.6). */
export function buildDynamicVietQrUrl(params: {
  bankNameOrBin: string; accountNumber: string; accountHolder?: string;
  amountVnd: number; periodCode: string; employeeCode: string;
}): string {
  const acct = String(params.accountNumber ?? '').replace(/\s+/g, '');
  if (!acct) return '';
  const bank = findVietQrBank(params.bankNameOrBin);
  const bankId = bank?.bin ?? bank?.code ?? params.bankNameOrBin.trim();
  const amount = Math.max(0, Math.round(Number(params.amountVnd) || 0));
  const addInfo = `LUONG ${String(params.periodCode || '').trim()} ${String(params.employeeCode || '').trim()}`.trim();
  const parts = [`amount=${encodeURIComponent(String(amount))}`, `addInfo=${encodeURIComponent(addInfo)}`];
  if (params.accountHolder?.trim()) parts.push(`accountName=${encodeURIComponent(cleanAccountHolder(params.accountHolder))}`);
  return `https://img.vietqr.io/image/${encodeURIComponent(bankId)}-${encodeURIComponent(acct)}-compact2.png?${parts.join('&')}`;
}
