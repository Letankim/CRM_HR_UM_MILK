import { Zalo, LoginQRCallbackEventType, ThreadType, type API, type Credentials } from 'zca-js';
import { normalizePhone } from '@umbm/shared';
import type { AppContext } from '../context.js';
import {
  DEFAULT_ZALO_TEMPLATES, ZALO_HR_SETTING_CATEGORY, decryptZaloPayload, encryptZaloPayload,
  listHrZaloAccounts, type PublicZaloAccountDto, type StoredZaloAccountSecret,
} from './zalo-hr.service.js';

export interface ZaloQrSessionState {
  session_id: string; owner_user_id: string; actor_id: string; is_default: boolean;
  status: 'PENDING' | 'SCANNED' | 'CONFIRMED' | 'DECLINED' | 'EXPIRED';
  qr_image: string; qr_url: string; session_token: string; expires_in: number; created_at_ms: number;
  scanned_display_name?: string; scanned_avatar?: string; zalo_id?: string; zalo_name?: string; zalo_phone?: string;
  saved_account?: PublicZaloAccountDto | null; error_message?: string; abort?: () => void;
}

const qrSessions = new Map<string, ZaloQrSessionState>();
const zaloApiClients = new Map<string, API>();

async function persistConfirmedZaloSession(
  ctx: AppContext,
  state: ZaloQrSessionState,
  params: { zaloId: string; zaloName: string; zaloPhone: string; credentialsJson: string },
): Promise<PublicZaloAccountDto | null> {
  const actor = ctx.db.users.get(state.actor_id) ?? ctx.db.users.all()[0];
  const owner = ctx.db.users.get(state.owner_user_id) ?? ctx.db.users.find((u) => u.username === state.owner_user_id) ?? actor;
  if (!owner) return null;

  const existingRows = ctx.db.systemSettings.filter((s) => s.category === ZALO_HR_SETTING_CATEGORY && s.note === owner.id);
  if (state.is_default) {
    for (const r of existingRows) {
      const dec = decryptZaloPayload(ctx, r.value);
      if (dec?.is_default) {
        await ctx.db.systemSettings.update(r.id, r.version, { value: encryptZaloPayload(ctx, { ...dec, is_default: false }) }, owner.id);
      }
    }
  }

  const matchedRow = existingRows.find((r) => {
    const dec = decryptZaloPayload(ctx, r.value);
    return dec && ((params.zaloId && dec.zalo_id === params.zaloId) || (params.zaloPhone && dec.zalo_phone === params.zaloPhone));
  });
  const prevSecret = matchedRow ? decryptZaloPayload(ctx, matchedRow.value) : null;

  const secret: StoredZaloAccountSecret = {
    owner_user_id: owner.id,
    zalo_name: params.zaloName || prevSecret?.zalo_name || `HR ${owner.display_name}`,
    zalo_phone: params.zaloPhone || prevSecret?.zalo_phone || normalizePhone(owner.phone) || '0901000002',
    zalo_id: params.zaloId || prevSecret?.zalo_id || `zalo_${owner.username}`,
    access_token: params.credentialsJson,
    is_default: state.is_default,
    status: 'ACTIVE',
    greeting_template: prevSecret?.greeting_template || DEFAULT_ZALO_TEMPLATES.greeting,
    invite_template: prevSecret?.invite_template || DEFAULT_ZALO_TEMPLATES.invite,
    reminder_template: prevSecret?.reminder_template || DEFAULT_ZALO_TEMPLATES.reminder,
    pass_template: prevSecret?.pass_template || DEFAULT_ZALO_TEMPLATES.pass,
  };

  let savedId = matchedRow?.id ?? '';
  if (matchedRow) {
    const fresh = ctx.db.systemSettings.get(matchedRow.id) ?? matchedRow;
    await ctx.db.systemSettings.update(fresh.id, fresh.version, {
      label: `${owner.display_name} (@${owner.username}) — ${secret.zalo_name} (${secret.zalo_phone})`,
      note: owner.id,
      value_type: 'ENCRYPTED_JSON',
      value: encryptZaloPayload(ctx, secret),
    }, owner.id);
  } else {
    const created = await ctx.db.systemSettings.insert({
      key: `ZALO_ACC_${owner.id}_${Date.now()}`,
      category: ZALO_HR_SETTING_CATEGORY,
      label: `${owner.display_name} (@${owner.username}) — ${secret.zalo_name} (${secret.zalo_phone})`,
      note: owner.id,
      value_type: 'ENCRYPTED_JSON',
      value: encryptZaloPayload(ctx, secret),
    }, owner.id);
    savedId = created.id;
  }

  const all = await listHrZaloAccounts(ctx);
  return all.find((a) => a.id === savedId) ?? all[0] ?? null;
}

export async function startZaloQrLoginSession(
  ctx: AppContext,
  params: { actorId: string; ownerUserId: string; isDefault?: boolean; fallbackPhone?: string; fallbackName?: string },
): Promise<ZaloQrSessionState> {
  for (const [, old] of qrSessions) {
    if (old.actor_id === params.actorId && (old.status === 'PENDING' || old.status === 'SCANNED')) {
      old.abort?.();
      old.status = 'EXPIRED';
    }
  }

  const sessionId = `zqr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const state: ZaloQrSessionState = {
    session_id: sessionId,
    owner_user_id: params.ownerUserId || params.actorId,
    actor_id: params.actorId,
    is_default: params.isDefault ?? true,
    status: 'PENDING',
    qr_image: '',
    qr_url: `https://id.zalo.me/account/login/qr?token=${sessionId}`,
    session_token: `zalo_qr_session_${sessionId}`,
    expires_in: 100,
    created_at_ms: Date.now(),
  };
  qrSessions.set(sessionId, state);

  if (ctx.env.NODE_ENV === 'test') {
    return state;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finishInit = () => {
      if (!settled) { settled = true; resolve(); }
    };
    const timer = setTimeout(finishInit, 6500);
    let capturedCreds: Credentials | null = null;
    const zalo = new Zalo({ logging: false });

    zalo
      .loginQR({}, (ev) => {
        if (ev.type === LoginQRCallbackEventType.QRCodeGenerated) {
          const rawImg = ev.data.image || '';
          state.qr_image = rawImg.startsWith('data:image') ? rawImg : `data:image/png;base64,${rawImg}`;
          state.session_token = ev.data.code || state.session_token;
          state.abort = () => {
            try { ev.actions.abort(); } catch { /* ignore */ }
          };
          clearTimeout(timer);
          finishInit();
        } else if (ev.type === LoginQRCallbackEventType.QRCodeScanned) {
          state.status = 'SCANNED';
          state.scanned_display_name = ev.data.display_name;
          state.scanned_avatar = ev.data.avatar;
        } else if (ev.type === LoginQRCallbackEventType.QRCodeDeclined) {
          state.status = 'DECLINED';
          state.error_message = 'Bạn đã từ chối đăng nhập trên ứng dụng Zalo điện thoại.';
        } else if (ev.type === LoginQRCallbackEventType.QRCodeExpired) {
          if (state.status !== 'CONFIRMED') state.status = 'EXPIRED';
        } else if (ev.type === LoginQRCallbackEventType.GotLoginInfo) {
          capturedCreds = ev.data;
        }
      })
      .then(async (api) => {
        const info = await api.fetchAccountInfo().catch(() => null);
        const profile = (info as { profile?: { userId?: string; displayName?: string; zaloName?: string; phoneNumber?: string } } | null)?.profile;
        const ownId = (typeof api.getOwnId === 'function' ? api.getOwnId() : '') || profile?.userId || '';
        const zaloName = profile?.displayName || profile?.zaloName || state.scanned_display_name || params.fallbackName || 'Zalo Tuyển dụng';
        const zaloPhone = normalizePhone(profile?.phoneNumber || '') || normalizePhone(params.fallbackPhone || '') || '0901000002';
        const zaloId = String(ownId || `zalo_${zaloPhone}`);
        const credsJson = capturedCreds ? JSON.stringify(capturedCreds) : `zalo_session_${zaloId}_${Date.now()}`;

        const saved = await persistConfirmedZaloSession(ctx, state, { zaloId, zaloName, zaloPhone, credentialsJson: credsJson });
        if (saved) zaloApiClients.set(saved.id, api);
        state.zalo_id = zaloId;
        state.zalo_name = zaloName;
        state.zalo_phone = zaloPhone;
        state.saved_account = saved;
        state.status = 'CONFIRMED';
      })
      .catch(() => {
        clearTimeout(timer);
        finishInit();
      });
  });

  return state;
}

export function getZaloQrSessionState(sessionId: string): ZaloQrSessionState | null {
  const s = qrSessions.get(sessionId);
  if (!s) return null;
  const elapsedSec = Math.floor((Date.now() - s.created_at_ms) / 1000);
  const remaining = Math.max(0, s.expires_in - elapsedSec);
  if (remaining === 0 && s.status === 'PENDING') s.status = 'EXPIRED';
  return { ...s, expires_in: remaining };
}

export async function sendRealZaloMessageIfConnected(
  accountId: string,
  secret: StoredZaloAccountSecret,
  recipientPhoneOrUid: string,
  messageText: string,
): Promise<{ deliveredViaZca: boolean; resolvedZaloUid?: string; msgId?: string }> {
  const rawToken = (secret.access_token || '').trim();
  if (!rawToken.startsWith('{')) return { deliveredViaZca: false };
  try {
    let api = zaloApiClients.get(accountId);
    if (!api) {
      const creds = JSON.parse(rawToken) as Credentials;
      const zalo = new Zalo({ logging: false });
      api = await zalo.login(creds);
      zaloApiClients.set(accountId, api);
    }
    const cleanPhone = normalizePhone(recipientPhoneOrUid);
    let targetUid = recipientPhoneOrUid.trim();
    if (cleanPhone) {
      const found = await api.findUser(cleanPhone);
      if (found?.uid) targetUid = String(found.uid);
    }
    const sent = await api.sendMessage({ msg: messageText }, targetUid, ThreadType.User);
    return {
      deliveredViaZca: true,
      resolvedZaloUid: targetUid,
      msgId: sent?.message?.msgId ? String(sent.message.msgId) : undefined,
    };
  } catch {
    zaloApiClients.delete(accountId);
    return { deliveredViaZca: false };
  }
}
