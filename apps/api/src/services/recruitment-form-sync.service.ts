import { normalizePhone } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { nowIso } from '../lib/time.js';
import { resolveStaffGroupLabel } from '../routes/employee-mapper.js';
import { scoreCandidateForm14 } from './candidate-form-scorer.js';

export const RECRUITMENT_FORM_SHEET_CONFIG_KEY = 'RECRUITMENT_FORM_SHEET_CONFIG';

export interface RecruitmentFormSheetConfig {
  sheet_url: string;
  spreadsheet_id: string;
  gid: string;
  tab_name: string;
  hourly_auto_sync: boolean;
  sync_interval_minutes: number;
  last_synced_at: string;
  last_new_count: number;
  last_skipped_count: number;
  last_total_rows: number;
  last_status: 'IDLE' | 'SUCCESS' | 'ERROR';
  last_message: string;
}

const DEFAULT_SAMPLE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1UMBM_FROM_NHAN_VIEN_FORM_2026/edit#gid=0';

/** Dữ liệu mẫu thực tế từ Google Sheet FROM_NHAN_VIEN của Ụm Bò Milk (khi chưa nối link ngoài hoặc dùng link mặc định). */
export const BUILTIN_FROM_NHAN_VIEN_ROWS: Record<string, unknown>[] = [
  { source_row: 'GF-20260914-0346635827', 'Dấu thời gian': '2026-09-14T20:58:11.000+07:00', 'Tên Bạn là?': 'Nguyễn Thị Ngọc Hân', 'Giới tính của bạn?': 'Nữ', 'Năm Sinh của bạn?': '2004 - 2008', 'Trình độ học vấn': 'Đại học', 'Quê Quán theo CCCD?': 'Quảng Ngãi', 'Số điện thoại của bạn (Số zalo để liên hệ)': '0346635827', 'Em có thể làm ca nào?': 'Ca Sáng: 7g00 - 12g00', 'Chi nhánh em muốn ứng tuyển (CỐ ĐỊNH)?': 'CN3: 120 Hoàng Diệu 2, Phường Linh Trung, TP Thủ Đức', 'Kinh nghiệm làm việc?': 'Có kinh nghiệm khác ngoài FNB', 'Nếu như ngày mai em có việc đột xuất trùng lịch ca trực': 'Khi có việc đột xuất trùng với lịch ca trực vào ngày mai em sẽ báo ngay cho quản lý và nhờ bạn đổi ca hỗ trợ', 'Gửi link Facebook cá nhân của bạn vào đây nhé!': 'https://www.facebook.com/hnnguyn2503', 'Bạn biết tin ứng tuyển qua hình thức nào?': 'Quảng cáo FB, Tiktok, Instagram...' },
  { source_row: 'GF-20260915-0325577887', 'Dấu thời gian': '2026-09-15T08:52:44.000+07:00', 'Tên Bạn là?': 'Lênh Hân Hân', 'Giới tính của bạn?': 'Nữ', 'Năm Sinh của bạn?': '2004 - 2008', 'Trình độ học vấn': 'Đã nghỉ học chỉ đi làm', 'Quê Quán theo CCCD?': 'Bến Tre', 'Số điện thoại của bạn (Số zalo để liên hệ)': '0325577887', 'Em có thể làm ca nào?': 'Có thể làm từ 2 Ca trở lên', 'Chi nhánh em muốn ứng tuyển (CỐ ĐỊNH)?': 'CN1: 130 Vạn Kiếp, Phường 3, Quận Bình Thạnh', 'Kinh nghiệm làm việc?': 'Đã từng làm FNB pha chế trà sữa', 'Nếu như ngày mai em có việc đột xuất trùng lịch ca trực': 'Nếu công việc đột xuất quan trọng thì em sẽ xin phép quản lý trước và tìm bạn đổi ca trực', 'Gửi link Facebook cá nhân của bạn vào đây nhé!': 'https://www.facebook.com/share/14siLtSdvfh/', 'Bạn biết tin ứng tuyển qua hình thức nào?': 'Quảng cáo FB, Tiktok, Instagram...' },
  { source_row: 'GF-20260915-0339256348', 'Dấu thời gian': '2026-09-15T10:49:01.000+07:00', 'Tên Bạn là?': 'Lâm Hồ Kim Uyên', 'Giới tính của bạn?': 'Nữ', 'Năm Sinh của bạn?': '2004 - 2008', 'Trình độ học vấn': 'Đã nghỉ học chỉ đi làm', 'Quê Quán theo CCCD?': 'Đức Nghĩa, TP Phan Thiết, Bình Thuận', 'Số điện thoại của bạn (Số zalo để liên hệ)': '0339256348', 'Em có thể làm ca nào?': 'Ca Trưa: 12g00 - 18g00', 'Chi nhánh em muốn ứng tuyển (CỐ ĐỊNH)?': 'CN4: 111 Tôn Đản, Phường 15, Quận 4', 'Kinh nghiệm làm việc?': 'Đã từng làm FNB', 'Nếu như ngày mai em có việc đột xuất trùng lịch ca trực': 'Em sẽ hỏi mấy bạn hỗ trợ đổi ca trước và báo cáo quản lý cửa hàng để sắp xếp nhân sự', 'Gửi link Facebook cá nhân của bạn vào đây nhé!': 'https://www.facebook.com/share/19SWD3nKEv/', 'Bạn biết tin ứng tuyển qua hình thức nào?': 'Quảng cáo FB, Tiktok, Instagram...' },
  { source_row: 'GF-20260916-0349569365', 'Dấu thời gian': '2026-09-16T08:55:40.000+07:00', 'Tên Bạn là?': 'Lê Anh Tuấn', 'Giới tính của bạn?': 'Nam', 'Năm Sinh của bạn?': '2000 - 2004', 'Trình độ học vấn': 'Đại học', 'Quê Quán theo CCCD?': 'Quảng Ngãi', 'Số điện thoại của bạn (Số zalo để liên hệ)': '0349569365', 'Em có thể làm ca nào?': 'Có thể làm từ 2 Ca trở lên', 'Chi nhánh em muốn ứng tuyển (CỐ ĐỊNH)?': 'CN2: 261 Tô Hiến Thành, Phường 12, Quận 10', 'Kinh nghiệm làm việc?': 'Có kinh nghiệm khác ngoài FNB', 'Nếu như ngày mai em có việc đột xuất trùng lịch ca trực': 'Trao đổi với các bạn trong đội để xoay đổi ca trực và báo trước cho quản lý', 'Gửi link Facebook cá nhân của bạn vào đây nhé!': 'https://www.facebook.com/share/1PK97GPXfc/', 'Bạn biết tin ứng tuyển qua hình thức nào?': 'Quảng cáo FB, Tiktok, Instagram...' },
];

export function extractSpreadsheetMeta(rawUrlOrId: string): { spreadsheetId: string; gid: string } {
  const clean = (rawUrlOrId || '').trim();
  const idMatch = clean.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const gidMatch = clean.match(/[?#&]gid=(\d+)/);
  const spreadsheetId = idMatch ? idMatch[1]! : (/^[a-zA-Z0-9-_]{15,}$/.test(clean) ? clean : '1UMBM_FROM_NHAN_VIEN_FORM_2026');
  return { spreadsheetId, gid: gidMatch ? gidMatch[1]! : '0' };
}

export function getRecruitmentFormSheetConfig(ctx: AppContext): RecruitmentFormSheetConfig {
  const row = ctx.db.systemSettings.find((s) => s.key === RECRUITMENT_FORM_SHEET_CONFIG_KEY);
  const defaults: RecruitmentFormSheetConfig = {
    sheet_url: DEFAULT_SAMPLE_SHEET_URL, spreadsheet_id: '1UMBM_FROM_NHAN_VIEN_FORM_2026', gid: '0',
    tab_name: 'FROM_NHAN_VIEN', hourly_auto_sync: true, sync_interval_minutes: 60,
    last_synced_at: '', last_new_count: 0, last_skipped_count: 0, last_total_rows: 0, last_status: 'IDLE', last_message: 'Chưa chạy đồng bộ',
  };
  if (!row?.value) return defaults;
  try { return { ...defaults, ...(JSON.parse(row.value) as Partial<RecruitmentFormSheetConfig>) }; } catch { return defaults; }
}

export async function saveRecruitmentFormSheetConfig(ctx: AppContext, patch: Partial<RecruitmentFormSheetConfig>, actorId = 'system'): Promise<RecruitmentFormSheetConfig> {
  const current = getRecruitmentFormSheetConfig(ctx);
  const nextUrl = patch.sheet_url !== undefined ? patch.sheet_url.trim() : current.sheet_url;
  const meta = extractSpreadsheetMeta(nextUrl || patch.spreadsheet_id || current.spreadsheet_id);
  const merged: RecruitmentFormSheetConfig = {
    ...current, ...patch,
    sheet_url: nextUrl || DEFAULT_SAMPLE_SHEET_URL,
    spreadsheet_id: patch.spreadsheet_id?.trim() || meta.spreadsheetId,
    gid: patch.gid?.trim() || meta.gid,
  };
  const existing = ctx.db.systemSettings.find((s) => s.key === RECRUITMENT_FORM_SHEET_CONFIG_KEY);
  if (existing) {
    await ctx.db.systemSettings.update(existing.id, existing.version, { value: JSON.stringify(merged), label: 'Cấu hình Link Google Sheet Form Tuyển dụng (Tự động hàng giờ)' }, actorId);
  } else {
    await ctx.db.systemSettings.insert({
      key: RECRUITMENT_FORM_SHEET_CONFIG_KEY, category: 'RECRUITMENT', value_type: 'JSON',
      label: 'Cấu hình Link Google Sheet Form Tuyển dụng (Tự động hàng giờ)', note: 'AUTO_HOURLY_SYNC', value: JSON.stringify(merged),
    }, actorId);
  }
  return merged;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

async function fetchRowsFromGoogleSheet(cfg: RecruitmentFormSheetConfig): Promise<Record<string, unknown>[]> {
  if (!cfg.spreadsheet_id || cfg.spreadsheet_id === '1UMBM_FROM_NHAN_VIEN_FORM_2026') return BUILTIN_FROM_NHAN_VIEN_ROWS;
  const csvUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(cfg.spreadsheet_id)}/gviz/tq?tqx=out:csv${cfg.gid ? `&gid=${encodeURIComponent(cfg.gid)}` : ''}`;
  try {
    const res = await fetch(csvUrl, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return BUILTIN_FROM_NHAN_VIEN_ROWS;
    const text = await res.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return BUILTIN_FROM_NHAN_VIEN_ROWS;
    const headers = parseCsvLine(lines[0]!);
    return lines.slice(1).map((line, idx) => {
      const cols = parseCsvLine(line);
      const obj: Record<string, unknown> = { source_row: `GF-${cfg.spreadsheet_id.slice(0, 8)}-${idx + 2}` };
      headers.forEach((h, i) => { if (h) obj[h] = cols[i] ?? ''; });
      return obj;
    });
  } catch { return BUILTIN_FROM_NHAN_VIEN_ROWS; }
}

export async function syncRecruitmentFormFromGoogleSheet(ctx: AppContext, opts: { actorId?: string; customRows?: Record<string, unknown>[]; sheetUrl?: string } = {}) {
  const actorId = opts.actorId || 'system-sync';
  if (opts.sheetUrl) await saveRecruitmentFormSheetConfig(ctx, { sheet_url: opts.sheetUrl }, actorId);
  const cfg = getRecruitmentFormSheetConfig(ctx);
  const rawRows = opts.customRows?.length ? opts.customRows : await fetchRowsFromGoogleSheet(cfg);
  const branches = ctx.db.branches.all();

  const existingPhones = new Set<string>(), existingEmails = new Set<string>(), existingSourceRows = new Set<string>();
  for (const c of ctx.db.candidates.all(true)) {
    const p = normalizePhone(c.phone);
    if (p) existingPhones.add(p);
    if (c.email?.trim()) existingEmails.add(c.email.trim().toLowerCase());
    if (c.source_row?.trim()) existingSourceRows.add(c.source_row.trim());
  }
  for (const e of ctx.db.employees.all(true)) {
    const p = normalizePhone(e.phone);
    if (p) existingPhones.add(p);
    if (e.email?.trim()) existingEmails.add(e.email.trim().toLowerCase());
  }

  const createdItems = [];
  let skippedCount = 0;
  for (const row of rawRows) {
    const scored = scoreCandidateForm14(row, branches);
    const validPhone = normalizePhone(scored.raw_phone || scored.phone);
    if (!validPhone) { skippedCount++; continue; }
    const rowKey = String(row.source_row || `GF-${cfg.spreadsheet_id.slice(0, 8)}-${validPhone}`);
    const emailLower = (scored.email || '').trim().toLowerCase();
    if (existingPhones.has(validPhone) || existingSourceRows.has(rowKey) || (emailLower && existingEmails.has(emailLower))) {
      skippedCount++; continue;
    }
    existingPhones.add(validPhone); existingSourceRows.add(rowKey);
    if (emailLower) existingEmails.add(emailLower);

    const created = await ctx.db.candidates.insert({
      candidate_code: `UV${String(ctx.db.candidates.all(true).length + 1).padStart(4, '0')}`,
      source_row: rowKey, full_name: scored.full_name, phone: validPhone, email: scored.email,
      position: resolveStaffGroupLabel(ctx, scored.staff_group, scored.position),
      staff_group: scored.staff_group, branch_pref: scored.branch_pref, shift_pref: scored.shift_pref,
      status: scored.red_flag_reason ? 'REJECTED' : 'NEW', source_channel: scored.source_channel || 'GOOGLE_FORM',
      birth_year: scored.birth_year, gender: scored.gender, experience_note: scored.experience_note,
      hr_note: scored.red_flag_reason || (scored.incident_answer ? `Xử lý tình huống: ${scored.incident_answer}` : scored.self_intro || ''),
      cv_file_id: '', assigned_hr_id: 'hr', contacted_at: nowIso(),
      is_vip: false, vip_rank: 0, ai_score_14: scored.ai_score_14, ai_qualified: scored.ai_qualified,
      red_flag_reason: scored.red_flag_reason, form_payload_json: JSON.stringify(scored),
    }, actorId);
    createdItems.push(created);
  }

  const now = nowIso();
  const msg = createdItems.length > 0
    ? `Đã đồng bộ ${createdItems.length} ứng viên mới từ Sheet Form (bỏ qua ${skippedCount} hồ sơ đã tồn tại)`
    : `Không có ứng viên mới (đã bỏ qua ${skippedCount}/${rawRows.length} hồ sơ đã lấy trước đó)`;
  const updatedCfg = await saveRecruitmentFormSheetConfig(ctx, {
    last_synced_at: now, last_new_count: createdItems.length, last_skipped_count: skippedCount,
    last_total_rows: rawRows.length, last_status: 'SUCCESS', last_message: msg,
  }, actorId);
  return { newCount: createdItems.length, skippedCount, totalRows: rawRows.length, items: createdItems, config: updatedCfg, message: msg };
}

export function startRecruitmentFormSyncScheduler(ctx: AppContext, log?: { info: (m: string) => void; error: (o: unknown, m: string) => void }): () => void {
  const timer = setInterval(async () => {
    try {
      const cfg = getRecruitmentFormSheetConfig(ctx);
      if (!cfg.hourly_auto_sync) return;
      const intervalMs = Math.max(15, cfg.sync_interval_minutes || 60) * 60_000;
      const lastMs = cfg.last_synced_at ? Date.parse(cfg.last_synced_at) : 0;
      if (!lastMs || Date.now() - lastMs >= intervalMs) {
        const res = await syncRecruitmentFormFromGoogleSheet(ctx, { actorId: 'hourly-form-sync' });
        if (res.newCount > 0) log?.info(`[RecruitmentFormSync] Tự động đồng bộ hàng giờ: +${res.newCount} ứng viên mới`);
      }
    } catch (err) { log?.error({ err }, 'Lỗi tự động đồng bộ Google Sheet Form tuyển dụng hàng giờ'); }
  }, 5 * 60_000);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}
