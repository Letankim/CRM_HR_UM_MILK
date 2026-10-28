import { EMAIL_TEMPLATE_CODES, EMAIL_TEMPLATE_LABELS, SYSTEM_CONFIG, type EmailTemplateCode } from '@umbm/shared';
import type { Database } from '../data/database.js';
import { nowIso } from '../lib/time.js';
import { buildEmailPreviewSamples } from './email-samples.js';
import { renderEnterpriseEmailHtml, type SendEmailInput } from './email-template.js';

export { renderEnterpriseEmailHtml, type EmailAttachment, type SendEmailInput } from './email-template.js';

export interface SentEmailRecord {
  id: string; to: string; recipientName: string; referenceCode: string;
  template: EmailTemplateCode; templateLabel: string; subject: string;
  queuedAt: string; sentAt: string; attempts: number;
  status: 'QUEUED' | 'SENT' | 'QUEUED_MEMORY' | 'FAILED';
  html: string; error?: string; deliveryLogId?: string;
}

const BATCH_SIZE = 3, BATCH_INTERVAL_MS = 3000, INTER_EMAIL_DELAY_MS = 250, DEDUPE_TTL_MS = 15_000, MAX_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function isSyntheticDemoEmail(email?: string): boolean {
  const clean = (email || '').trim().toLowerCase();
  if (!clean || !clean.includes('@')) return true;
  if (clean.endsWith('@umbomilk.vn') || clean.endsWith(`@${SYSTEM_CONFIG.companyDomain.toLowerCase()}`)) return true;
  return /^[a-z]+\.[a-z]+\d{3,4}@(yahoo|outlook|gmail)\.com$/i.test(clean);
}

export class EmailService {
  private readonly history: SentEmailRecord[] = [];
  private readonly dedupeMap = new Map<string, { exp: number; record: SentEmailRecord }>();
  private db?: Database;
  private processing = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly senderOption?: (payload: { to: string; subject: string; html: string }) => Promise<void>) {}

  attachDatabase(db: Database): void { this.db = db; }

  private buildRecord(input: SendEmailInput, initialStatus: SentEmailRecord['status']): SentEmailRecord {
    const prefix = SYSTEM_CONFIG.emailSubjectPrefix;
    const subject = input.subject ?? `${prefix} ${EMAIL_TEMPLATE_LABELS[input.template]} (${input.referenceCode})`;
    const now = nowIso();
    return {
      id: `mail_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      to: input.to.trim().toLowerCase(), recipientName: input.recipientName || 'Nhân sự Ụm Bò Milk',
      referenceCode: input.referenceCode, template: input.template,
      templateLabel: EMAIL_TEMPLATE_LABELS[input.template] ?? input.template,
      subject, queuedAt: now, sentAt: initialStatus === 'QUEUED' ? '' : now,
      attempts: initialStatus === 'QUEUED' ? 0 : 1, status: initialStatus,
      html: renderEnterpriseEmailHtml(input),
    };
  }

  hydrateFromDatabase(): void {
    if (!this.db || !this.db.isReady()) return;
    const knownLogIds = new Set(this.history.map((r) => r.deliveryLogId).filter(Boolean));
    const emailLogs = this.db.deliveryLogs.all().filter((l) => l.channel === 'EMAIL');
    let addedPending = false;
    for (const log of emailLogs) {
      if (knownLogIds.has(log.id)) continue;
      const [rawTpl = 'ACCOUNT_ACTIVATED', ...refParts] = (log.announcement_id || '').split(':');
      const template = (EMAIL_TEMPLATE_CODES.includes(rawTpl as EmailTemplateCode) ? rawTpl : 'ACCOUNT_ACTIVATED') as EmailTemplateCode;
      const referenceCode = refParts.join(':') || `REF-${log.id.slice(0, 6)}`;
      const cleanTo = (log.recipient_user_id || '').trim().toLowerCase();
      if (!cleanTo.includes('@')) continue;
      const matchedUser = this.db.users.find((u) => u.email.trim().toLowerCase() === cleanTo);
      const matchedEmp = this.db.employees.find((e) => e.email.trim().toLowerCase() === cleanTo);
      const recipientName = matchedUser?.display_name || matchedEmp?.full_name || 'Nhân sự Ụm Bò Milk';
      const status: SentEmailRecord['status'] = log.status === 'PENDING' ? 'QUEUED' : log.status === 'FAILED' ? 'FAILED' : 'SENT';
      const rec = this.buildRecord({
        to: cleanTo, template, recipientName, referenceCode,
        summary: `Thông báo hệ thống ${SYSTEM_CONFIG.brandName} — ${EMAIL_TEMPLATE_LABELS[template]}.`,
        metadata: [{ label: 'Mã tham chiếu', value: referenceCode }, { label: 'Người nhận', value: `${recipientName} (${cleanTo})` }, { label: 'Loại thông báo', value: EMAIL_TEMPLATE_LABELS[template] }],
      }, status);
      rec.id = `mail_${log.id}`; rec.deliveryLogId = log.id; rec.queuedAt = log.sent_at || log.created_at;
      rec.sentAt = log.delivered_at || log.sent_at || ''; rec.attempts = log.attempts || (status === 'QUEUED' ? 0 : 1); rec.error = log.last_error || undefined;
      this.history.push(rec);
      if (status === 'QUEUED') addedPending = true;
    }
    this.history.sort((a, b) => (b.sentAt || b.queuedAt).localeCompare(a.sentAt || a.queuedAt));
    if (this.history.length > 200) this.history.length = 200;
    if (addedPending) this.scheduleNextBatch(300);
  }

  private async syncToDeliveryLog(record: SentEmailRecord): Promise<void> {
    if (!this.db || !this.db.isReady()) return;
    try {
      const logStatus: 'PENDING' | 'SENT' | 'FAILED' = record.status === 'QUEUED' ? 'PENDING' : record.status === 'FAILED' ? 'FAILED' : 'SENT';
      if (record.deliveryLogId) {
        const existing = this.db.deliveryLogs.get(record.deliveryLogId);
        if (existing) {
          await this.db.deliveryLogs.update(existing.id, existing.version, { status: logStatus, attempts: record.attempts, last_error: record.error || '', sent_at: record.sentAt || existing.sent_at, delivered_at: logStatus === 'SENT' ? (record.sentAt || nowIso()) : '' }, 'email-queue');
          return;
        }
      }
      const inserted = await this.db.deliveryLogs.insert({ announcement_id: `${record.template}:${record.referenceCode}`, recipient_user_id: record.to, channel: 'EMAIL', status: logStatus, attempts: record.attempts, last_error: record.error || '', branch_id: 'ALL', sent_at: record.sentAt || record.queuedAt, delivered_at: logStatus === 'SENT' ? (record.sentAt || nowIso()) : '', read_at: '', ack_at: '' }, 'email-queue');
      record.deliveryLogId = inserted.id;
    } catch { /* Không làm gián đoạn luồng chính */ }
  }

  enqueue(input: SendEmailInput, opts?: { dedupeKey?: string }): SentEmailRecord | null {
    const cleanTo = (input.to || '').trim().toLowerCase();
    if (!cleanTo || !cleanTo.includes('@')) return null;
    const now = Date.now();
    for (const [k, v] of this.dedupeMap.entries()) if (v.exp <= now || v.record.status === 'FAILED') this.dedupeMap.delete(k);
    const key = opts?.dedupeKey ?? `${cleanTo}::${input.template}::${input.referenceCode}`;
    const existing = this.dedupeMap.get(key);
    if (existing && existing.exp > now && existing.record.status !== 'FAILED') return existing.record;
    const record = this.buildRecord({ ...input, to: cleanTo }, 'QUEUED');
    this.dedupeMap.set(key, { exp: now + DEDUPE_TTL_MS, record });
    this.history.unshift(record);
    if (this.history.length > 200) this.history.pop();
    void this.syncToDeliveryLog(record);
    this.scheduleNextBatch(150);
    return record;
  }

  private scheduleNextBatch(delayMs = BATCH_INTERVAL_MS): void {
    if (this.timer || this.processing) return;
    this.timer = setTimeout(() => { this.timer = null; void this.processQueueBatch(BATCH_SIZE); }, delayMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  private async deliverSingle(record: SentEmailRecord): Promise<void> {
    record.attempts += 1; record.sentAt = nowIso();
    if (!this.senderOption || isSyntheticDemoEmail(record.to)) {
      record.status = 'QUEUED_MEMORY'; record.error = undefined;
      await this.syncToDeliveryLog(record);
      return;
    }
    try {
      await this.senderOption({ to: record.to, subject: record.subject, html: record.html });
      record.status = 'SENT'; record.error = undefined;
    } catch (err) {
      const msg = (err as Error).message || 'Lỗi kết nối SMTP';
      if (msg.includes('insufficient authentication scopes') || msg.includes('Insufficient Permission')) {
        record.status = 'QUEUED_MEMORY'; record.error = undefined;
      } else {
        record.status = record.attempts < MAX_ATTEMPTS ? 'QUEUED' : 'FAILED';
        record.error = msg;
      }
    }
    await this.syncToDeliveryLog(record);
  }

  async processQueueBatch(maxBatch = BATCH_SIZE): Promise<{ processed: number; remaining: number }> {
    this.hydrateFromDatabase();
    if (this.processing) return { processed: 0, remaining: this.history.filter((r) => r.status === 'QUEUED').length };
    this.processing = true;
    let processed = 0;
    try {
      const pending = [...this.history].reverse().filter((r) => r.status === 'QUEUED').slice(0, maxBatch);
      for (let i = 0; i < pending.length; i++) {
        await this.deliverSingle(pending[i]!);
        processed += 1;
        if (i < pending.length - 1) await sleep(INTER_EMAIL_DELAY_MS);
      }
    } finally { this.processing = false; }
    const remaining = this.history.filter((r) => r.status === 'QUEUED').length;
    if (remaining > 0) this.scheduleNextBatch(BATCH_INTERVAL_MS);
    return { processed, remaining };
  }

  async retryFailed(): Promise<{ retried: number; processed: number; remaining: number }> {
    this.hydrateFromDatabase();
    const failed = this.history.filter((r) => r.status === 'FAILED');
    for (const r of failed) { r.status = 'QUEUED'; r.attempts = 0; r.error = undefined; }
    const res = await this.processQueueBatch(BATCH_SIZE);
    return { retried: failed.length, ...res };
  }

  async send(input: SendEmailInput): Promise<SentEmailRecord> {
    const record = this.buildRecord(input, 'QUEUED');
    this.history.unshift(record);
    if (this.history.length > 200) this.history.pop();
    record.attempts = MAX_ATTEMPTS - 1;
    await this.deliverSingle(record);
    return record;
  }

  recent(limit = 30): SentEmailRecord[] { this.hydrateFromDatabase(); return this.history.slice(0, limit); }

  queueStats() {
    this.hydrateFromDatabase();
    const queuedCount = this.history.filter((r) => r.status === 'QUEUED').length;
    const sentCount = this.history.filter((r) => r.status === 'SENT' || r.status === 'QUEUED_MEMORY').length;
    const failedCount = this.history.filter((r) => r.status === 'FAILED').length;
    return { queuedCount, sentCount, failedCount, totalCount: this.history.length, batchSize: BATCH_SIZE, intervalSeconds: BATCH_INTERVAL_MS / 1000, processing: this.processing };
  }

  previewTemplate(template: EmailTemplateCode, baseUrl = 'http://localhost:3100') {
    const sample = buildEmailPreviewSamples(baseUrl)[template]!;
    return { template, label: EMAIL_TEMPLATE_LABELS[template], subject: `${SYSTEM_CONFIG.emailSubjectPrefix} ${EMAIL_TEMPLATE_LABELS[template]} (${sample.referenceCode})`, html: renderEnterpriseEmailHtml(sample) };
  }
}
