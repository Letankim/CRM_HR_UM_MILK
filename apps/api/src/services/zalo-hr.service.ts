import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { ROLE_LABELS, SYSTEM_CONFIG, normalizePhone } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { nowIso } from '../lib/time.js';
import { webOrigin } from './account-email-dispatcher.js';
import { createRsvpToken, verifyRsvpToken } from './candidate-form-scorer.js';

export const ZALO_HR_SETTING_CATEGORY = 'ZALO_HR_ACCOUNT';
const ENCRYPTION_PREFIX = 'enc:v1:';

export interface StoredZaloAccountSecret {
  owner_user_id: string;
  zalo_name: string;
  zalo_phone: string;
  zalo_id: string;
  access_token: string;
  is_default: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  greeting_template: string;
  invite_template: string;
  reminder_template: string;
  pass_template: string;
}

export interface PublicZaloAccountDto {
  id: string;
  setting_key: string;
  owner_user_id: string;
  owner_username: string;
  owner_display_name: string;
  owner_role_label: string;
  zalo_name: string;
  zalo_phone: string;
  zalo_id: string;
  has_credentials: boolean;
  masked_credentials: string;
  encrypted_preview: string;
  is_default: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  greeting_template: string;
  invite_template: string;
  reminder_template: string;
  pass_template: string;
  updated_at: string;
  version: number;
}

export const ZALO_FRIEND_REQUEST_MAX_CHARS = 150;
export const DEFAULT_ZALO_TEMPLATES = {
  greeting: 'Chào {candidate_name}, HR {brand_name} đã nhận hồ sơ {position} ({branch_name}). Bạn đồng ý kết bạn Zalo để nhận lịch phỏng vấn nhé!',
  invite: 'Chào {candidate_name} ({candidate_code}), {brand_name} trân trọng mời bạn tham gia phỏng vấn vị trí {position} tại {branch_name} vào lúc {interview_time}. Link phòng họp Google Meet: {meet_link} — Vui lòng xác nhận tham gia hoặc xin dời lịch tại: {rsvp_url}',
  reminder: '[NHẮC LỊCH PHỎNG VẤN] Chào {candidate_name}, buổi phỏng vấn vị trí {position} tại {branch_name} sẽ bắt đầu sau khoảng {minutes_left} phút nữa ({interview_time}). Bạn vui lòng chuẩn bị và truy cập phòng họp đúng giờ nhé: {meet_link}',
  pass: 'Chúc mừng {candidate_name} ({candidate_code}) đã ĐẠT phỏng vấn vị trí {position} tại {branch_name}! Phòng Nhân sự {brand_name} ({hr_zalo_name} - {hr_zalo_phone}) mời bạn bắt đầu lộ trình thử việc. Vui lòng phản hồi tin nhắn Zalo này để nhận lịch ca đầu tiên.',
};
export const clampZaloFriendGreeting = (text: string): string => {
  const clean = text.trim();
  return clean.length <= ZALO_FRIEND_REQUEST_MAX_CHARS ? clean : clean.slice(0, ZALO_FRIEND_REQUEST_MAX_CHARS).trim();
};

function deriveAesKey(ctx: AppContext): Buffer {
  const rawSecret = ctx.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'umbm-hr-zalo-aes256-secret-key-v51';
  return createHash('sha256').update(`zalo-hr-sheet-v1:${rawSecret}`).digest();
}

/** Mã hóa AES-256-GCM toàn bộ cấu hình tài khoản Zalo trước khi lưu vào ô Google Sheets. */
export function encryptZaloPayload(ctx: AppContext, payload: StoredZaloAccountSecret): string {
  const key = deriveAesKey(ctx), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const json = JSON.stringify(payload);
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${ENCRYPTION_PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/** Giải mã AES-256-GCM từ ô Google Sheets về cấu hình tài khoản Zalo. */
export function decryptZaloPayload(ctx: AppContext, rawValue: string): StoredZaloAccountSecret | null {
  try {
    if (!rawValue.startsWith(ENCRYPTION_PREFIX)) return null;
    const parts = rawValue.slice(ENCRYPTION_PREFIX.length).split(':');
    if (parts.length !== 3) return null;
    const [ivHex, tagHex, cipherHex] = parts as [string, string, string];
    const decipher = createDecipheriv('aes-256-gcm', deriveAesKey(ctx), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const plain = Buffer.concat([decipher.update(Buffer.from(cipherHex, 'hex')), decipher.final()]).toString('utf8');
    return JSON.parse(plain) as StoredZaloAccountSecret;
  } catch {
    return null;
  }
}

function maskToken(token: string): string {
  const t = token.trim();
  if (!t) return 'Chưa nhập khóa phiên';
  if (t.length <= 8) return '••••••••';
  return `AES256••••${t.slice(-4)}`;
}

export async function ensureDefaultHrZaloAccounts(ctx: AppContext): Promise<void> {
  const existing = ctx.db.systemSettings.filter((s) => s.category === ZALO_HR_SETTING_CATEGORY);
  if (existing.length > 0) return;
  const hrUser = ctx.db.users.find((u) => u.role === 'HR' && u.status === 'ACTIVE') ?? ctx.db.users.find((u) => u.role === 'ADMIN');
  if (!hrUser) return;
  const payload: StoredZaloAccountSecret = {
    owner_user_id: hrUser.id,
    zalo_name: `HR Tuyển Dụng ${SYSTEM_CONFIG.brandName} — ${hrUser.display_name}`,
    zalo_phone: normalizePhone(hrUser.phone) ?? '0901000002',
    zalo_id: `zalo_hr_${hrUser.username}`,
    access_token: `zalo_oa_token_${hrUser.username}_encrypted_v51`,
    is_default: true,
    status: 'ACTIVE',
    greeting_template: DEFAULT_ZALO_TEMPLATES.greeting,
    invite_template: DEFAULT_ZALO_TEMPLATES.invite,
    reminder_template: DEFAULT_ZALO_TEMPLATES.reminder,
    pass_template: DEFAULT_ZALO_TEMPLATES.pass,
  };
  await ctx.db.systemSettings.insert({
    key: `ZALO_ACC_${hrUser.id}_DEFAULT`,
    category: ZALO_HR_SETTING_CATEGORY,
    label: `${hrUser.display_name} (@${hrUser.username}) — ${payload.zalo_name}`,
    note: hrUser.id,
    value_type: 'ENCRYPTED_JSON',
    value: encryptZaloPayload(ctx, payload),
  }, hrUser.id);
}

export async function listHrZaloAccounts(ctx: AppContext): Promise<PublicZaloAccountDto[]> {
  await ensureDefaultHrZaloAccounts(ctx);
  const rows = ctx.db.systemSettings.filter((s) => s.category === ZALO_HR_SETTING_CATEGORY);
  const fallbackOwner = ctx.db.users.find((u) => u.role === 'HR' && u.status === 'ACTIVE') ?? ctx.db.users.find((u) => u.role === 'ADMIN' && u.status === 'ACTIVE') ?? ctx.db.users.all()[0];
  const out: PublicZaloAccountDto[] = [];
  for (const r of rows) {
    const dec = decryptZaloPayload(ctx, r.value);
    if (!dec) continue;
    const owner = ctx.db.users.get(dec.owner_user_id) ?? ctx.db.users.find((u) => u.username === dec.owner_user_id) ?? fallbackOwner;
    out.push({
      id: r.id, setting_key: r.key, owner_user_id: owner?.id ?? 'hr',
      owner_username: owner?.username ?? 'hr', owner_display_name: owner?.display_name ?? 'Nhân sự Tuyển dụng',
      owner_role_label: owner ? ROLE_LABELS[owner.role] : 'Quản lý Nhân sự (HR)',
      zalo_name: dec.zalo_name, zalo_phone: dec.zalo_phone, zalo_id: dec.zalo_id,
      has_credentials: Boolean(dec.access_token?.trim()), masked_credentials: maskToken(dec.access_token || ''),
      encrypted_preview: `${r.value.slice(0, 28)}...`, is_default: Boolean(dec.is_default),
      status: dec.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
      greeting_template: !dec.greeting_template || dec.greeting_template.trim().length > ZALO_FRIEND_REQUEST_MAX_CHARS ? DEFAULT_ZALO_TEMPLATES.greeting : dec.greeting_template.trim(),
      invite_template: dec.invite_template || DEFAULT_ZALO_TEMPLATES.invite,
      reminder_template: dec.reminder_template || DEFAULT_ZALO_TEMPLATES.reminder,
      pass_template: dec.pass_template || DEFAULT_ZALO_TEMPLATES.pass,
      updated_at: r.updated_at, version: r.version,
    });
  }
  if (out.length > 0 && !out.some((a) => a.is_default)) {
    const firstActive = out.find((a) => a.status === 'ACTIVE') ?? out[0]!;
    firstActive.is_default = true;
  }
  return out.sort((a, b) => Number(b.is_default) - Number(a.is_default));
}

export async function resolveZaloAccountByIdOrDefault(
  ctx: AppContext, preferredAccountId?: string, _preferredUserId?: string,
): Promise<{ rowId: string; secret: StoredZaloAccountSecret; dto: PublicZaloAccountDto } | null> {
  const all = await listHrZaloAccounts(ctx);
  const active = all.filter((a) => a.status === 'ACTIVE');
  const chosen =
    (preferredAccountId ? active.find((a) => a.id === preferredAccountId || a.zalo_id === preferredAccountId || a.setting_key === preferredAccountId) : undefined)
    ?? active.find((a) => a.is_default) ?? active[0] ?? all.find((a) => a.is_default) ?? all[0];
  if (!chosen) return null;
  const rawRow = ctx.db.systemSettings.get(chosen.id);
  const secret = rawRow ? decryptZaloPayload(ctx, rawRow.value) : null;
  if (!secret) return null;
  return { rowId: chosen.id, secret, dto: chosen };
}

export function renderZaloMessageTemplate(
  template: string,
  vars: {
    candidateName: string; candidateCode?: string; position?: string; branchName?: string;
    interviewTime?: string; meetLink?: string; rsvpUrl?: string; hrZaloName?: string; hrZaloPhone?: string; minutesLeft?: number;
  },
): string {
  return template
    .replace(/\{candidate_name\}/g, vars.candidateName || 'Bạn')
    .replace(/\{candidate_code\}/g, vars.candidateCode || 'UV')
    .replace(/\{position\}/g, vars.position || 'Nhân viên Cửa hàng')
    .replace(/\{branch_name\}/g, vars.branchName || SYSTEM_CONFIG.brandName)
    .replace(/\{brand_name\}/g, SYSTEM_CONFIG.brandName)
    .replace(/\{interview_time\}/g, vars.interviewTime || 'theo lịch hẹn')
    .replace(/\{meet_link\}/g, vars.meetLink || 'https://meet.google.com/umb-milk-hr')
    .replace(/\{rsvp_url\}/g, vars.rsvpUrl || `${webOrigin({ env: process.env } as unknown as AppContext)}/nv/login`)
    .replace(/\{hr_zalo_name\}/g, vars.hrZaloName || `HR ${SYSTEM_CONFIG.brandName}`)
    .replace(/\{hr_zalo_phone\}/g, vars.hrZaloPhone || '0901000002')
    .replace(/\{minutes_left\}/g, String(vars.minutesLeft ?? 10));
}

/** Dùng lại link xác nhận còn hạn; tự cấp link mới khi link cũ đã hết hạn (7 ngày) hoặc khi HR yêu cầu tạo mới (`forceNew`). */
export function ensureInterviewRsvpUrl(
  ctx: AppContext, interviewId: string, candidateId: string, existingToken?: string, options?: { forceNew?: boolean; originOverride?: string },
): { token: string; url: string; renewed: boolean } {
  const reusable = Boolean(existingToken) && !options?.forceNew && verifyRsvpToken(existingToken as string).valid;
  const token = reusable ? (existingToken as string) : createRsvpToken({ interviewId, candidateId });
  const base = (options?.originOverride || webOrigin(ctx) || ctx.env.API_PUBLIC_ORIGIN || 'http://localhost:3000').replace(/\/$/, '');
  return { token, url: `${base}/rsvp/${token}`, renewed: !reusable };
}

export async function recordZaloDeliveryLog(
  ctx: AppContext, params: { channel: string; recipientId: string; branchId: string; summary: string; actorId: string },
): Promise<void> {
  await ctx.db.deliveryLogs.insert({
    announcement_id: params.summary.slice(0, 120), recipient_user_id: params.recipientId, channel: params.channel,
    status: 'SENT', attempts: 1, last_error: '', branch_id: params.branchId || 'ALL',
    sent_at: nowIso(), delivered_at: nowIso(), read_at: '', ack_at: '',
  }, params.actorId);
}
