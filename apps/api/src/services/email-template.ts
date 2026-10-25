import { EMAIL_TEMPLATE_LABELS, SYSTEM_CONFIG, type EmailTemplateCode } from '@umbm/shared';

export interface EmailAttachment {
  filename: string;
  contentType: string;
  contentBase64: string;
}

export interface SendEmailInput {
  to: string;
  template: EmailTemplateCode;
  subject?: string;
  recipientName: string;
  referenceCode: string;
  summary: string;
  metadata: { label: string; value: string }[];
  actionLabel?: string;
  actionUrl?: string;
  securityNote?: string;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Xây dựng HTML Email chuẩn văn bản hành chính doanh nghiệp.
 * Tiền tố tiêu đề, tên thương hiệu và đơn vị vận hành đều đọc từ SYSTEM_CONFIG (.env).
 */
export function renderEnterpriseEmailHtml(input: SendEmailInput): string {
  const title = EMAIL_TEMPLATE_LABELS[input.template];
  const issuedAt = new Date().toLocaleString('vi-VN', { timeZone: SYSTEM_CONFIG.timezone });

  const rowsHtml = input.metadata
    .map(
      (row, idx) => `
        <tr>
          <td style="padding: 10px 14px; width: 38%; background-color: ${idx % 2 === 0 ? '#F8FAFC' : '#FFFFFF'}; border-bottom: 1px solid #E2E8F0; border-right: 1px solid #E2E8F0; font-size: 13px; font-weight: 600; color: #334155;">
            ${escapeHtml(row.label)}
          </td>
          <td style="padding: 10px 14px; background-color: ${idx % 2 === 0 ? '#F8FAFC' : '#FFFFFF'}; border-bottom: 1px solid #E2E8F0; font-size: 13px; color: #0F172A; font-family: 'Segoe UI', Roboto, Arial, sans-serif;">
            ${escapeHtml(row.value)}
          </td>
        </tr>`,
    )
    .join('');

  const ctaHtml =
    input.actionLabel && input.actionUrl
      ? `
        <tr>
          <td style="padding: 20px 0 8px 0;">
            <a href="${escapeHtml(input.actionUrl)}" style="display: inline-block; padding: 10px 20px; background-color: #2563EB; color: #FFFFFF; text-decoration: none; font-size: 13px; font-weight: 600; border-radius: 2px; border: 1px solid #1D4ED8;">
              ${escapeHtml(input.actionLabel)}
            </a>
          </td>
        </tr>`
      : '';

  const noteHtml = input.securityNote
    ? `
      <tr>
        <td style="padding-top: 18px;">
          <div style="padding: 12px 14px; background-color: #F8FAFC; border: 1px solid #CBD5E1; border-left: 3px solid #0F172A; font-size: 12px; line-height: 1.6; color: #475569;">
            <strong style="color: #0F172A;">Lưu ý bảo mật &amp; vận hành:</strong> ${escapeHtml(input.securityNote)}
          </div>
        </td>
      </tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F1F5F9; font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif; color: #0F172A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #F1F5F9; padding: 28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width: 640px; width: 100%; background-color: #FFFFFF; border: 1px solid #CBD5E1; border-radius: 0px;">
          <tr>
            <td style="background-color: #0F172A; padding: 16px 24px; border-bottom: 2px solid #2563EB;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="color: #FFFFFF; font-size: 14px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase;">
                    ${escapeHtml(SYSTEM_CONFIG.brandName)} &middot; ${escapeHtml(SYSTEM_CONFIG.brandSubtitle)}
                  </td>
                  <td align="right" style="color: #94A3B8; font-size: 12px; font-family: Consolas, 'Courier New', monospace;">
                    MÃ THÔNG BÁO: ${escapeHtml(input.referenceCode)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-bottom: 6px; font-size: 11px; font-weight: 700; color: #2563EB; text-transform: uppercase; letter-spacing: 0.5px;">
                    THÔNG BÁO HỆ THỐNG CHÍNH THỨC
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom: 16px; font-size: 18px; font-weight: 700; color: #0F172A; border-bottom: 1px solid #E2E8F0;">
                    ${escapeHtml(title)}
                  </td>
                </tr>
                <tr>
                  <td style="padding-top: 16px; font-size: 14px; line-height: 1.6; color: #1E293B;">
                    Kính gửi <strong>${escapeHtml(input.recipientName)}</strong>,
                  </td>
                </tr>
                <tr>
                  <td style="padding-top: 10px; padding-bottom: 18px; font-size: 14px; line-height: 1.6; color: #334155;">
                    ${escapeHtml(input.summary)}
                  </td>
                </tr>
                <tr>
                  <td>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top: 1px solid #E2E8F0; border-left: 1px solid #E2E8F0; border-right: 1px solid #E2E8F0;">
                      ${rowsHtml}
                    </table>
                  </td>
                </tr>
                ${ctaHtml}
                ${noteHtml}
              </table>
            </td>
          </tr>
          <tr>
            <td style="background-color: #F8FAFC; padding: 14px 24px; border-top: 1px solid #E2E8F0; font-size: 12px; color: #64748B; line-height: 1.5;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    Đơn vị vận hành kỹ thuật: <strong>${escapeHtml(SYSTEM_CONFIG.vendorName)}</strong><br />
                    Thời điểm phát hành: ${escapeHtml(issuedAt)} (${escapeHtml(SYSTEM_CONFIG.timezone)})
                  </td>
                  <td align="right" style="vertical-align: bottom; font-family: Consolas, monospace; font-size: 11px; color: #94A3B8;">
                    ${escapeHtml(SYSTEM_CONFIG.version)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
