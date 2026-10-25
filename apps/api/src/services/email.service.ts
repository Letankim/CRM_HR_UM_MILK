import { EMAIL_TEMPLATE_LABELS, SYSTEM_CONFIG, type EmailTemplateCode } from '@umbm/shared';
import { nowIso } from '../lib/time.js';
import { buildEmailPreviewSamples } from './email-samples.js';
import { renderEnterpriseEmailHtml, type SendEmailInput } from './email-template.js';

export { renderEnterpriseEmailHtml, type EmailAttachment, type SendEmailInput } from './email-template.js';

export interface SentEmailRecord {
  id: string;
  to: string;
  template: EmailTemplateCode;
  subject: string;
  sentAt: string;
  status: 'SENT' | 'QUEUED_MEMORY' | 'FAILED';
  html: string;
  error?: string;
}

export class EmailService {
  private readonly history: SentEmailRecord[] = [];

  constructor(
    private readonly senderOption?: (payload: { to: string; subject: string; html: string }) => Promise<void>,
  ) {}

  async send(input: SendEmailInput): Promise<SentEmailRecord> {
    const prefix = SYSTEM_CONFIG.emailSubjectPrefix;
    const subject = input.subject ?? `${prefix} ${EMAIL_TEMPLATE_LABELS[input.template]} (${input.referenceCode})`;
    const html = renderEnterpriseEmailHtml(input);
    const record: SentEmailRecord = {
      id: `mail_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      to: input.to,
      template: input.template,
      subject,
      sentAt: nowIso(),
      status: this.senderOption ? 'SENT' : 'QUEUED_MEMORY',
      html,
    };

    if (this.senderOption) {
      try {
        await this.senderOption({ to: input.to, subject, html });
      } catch (err) {
        const msg = (err as Error).message || '';
        // Nếu OAuth token chưa cấp scope gmail.send, lưu vào hàng đợi bộ nhớ thay vì báo lỗi cứng
        if (msg.includes('insufficient authentication scopes') || msg.includes('Insufficient Permission')) {
          record.status = 'QUEUED_MEMORY';
        } else {
          record.status = 'FAILED';
          record.error = msg;
        }
      }
    }

    this.history.unshift(record);
    if (this.history.length > 100) this.history.pop();
    return record;
  }

  recent(): SentEmailRecord[] {
    return [...this.history];
  }

  previewTemplate(template: EmailTemplateCode, baseUrl = 'http://localhost:3100') {
    const samples = buildEmailPreviewSamples(baseUrl);
    const sample = samples[template]!;
    const prefix = SYSTEM_CONFIG.emailSubjectPrefix;
    return {
      template,
      label: EMAIL_TEMPLATE_LABELS[template],
      subject: `${prefix} ${EMAIL_TEMPLATE_LABELS[template]} (${sample.referenceCode})`,
      html: renderEnterpriseEmailHtml(sample),
    };
  }
}
