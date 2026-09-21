/**
 * Shared branded email chrome for DriveIQ transactional sends.
 *
 * Table-based HTML for Gmail / Outlook / Apple Mail. Extracted from
 * waitlistEmail.ts so welcome and lifecycle emails share one house style.
 */

export const BRAND = {
  primary: '#2D7DF6',
  primaryDark: '#1F62C9',
  gradient: '#4CA9FF',
  soft: '#E5F0FF',
  surface: '#F4F7FA',
  text: '#0E2A3A',
  muted: '#5B7388',
  border: '#E2EAF0',
  white: '#FFFFFF',
} as const;

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function emailShell(opts: { preheader: string; bodyRows: string }): string {
  const preheader = escapeHtml(opts.preheader);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>DriveIQ</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td { font-family: Arial, Helvetica, sans-serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${BRAND.surface};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;visibility:hidden;mso-hide:all;">
    ${preheader}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.surface};">
    <tr>
      <td align="center" style="padding:28px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">
          ${opts.bodyRows}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function brandHeader(): string {
  return `
<tr>
  <td style="padding:0 0 16px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:linear-gradient(135deg,${BRAND.primary} 0%,${BRAND.gradient} 100%);background-color:${BRAND.primary};border-radius:18px 18px 0 0;">
      <tr>
        <td style="padding:28px 28px 24px 28px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="width:36px;height:36px;border-radius:10px;background-color:rgba(255,255,255,0.22);text-align:center;vertical-align:middle;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:700;color:${BRAND.white};line-height:36px;">
                D
              </td>
              <td style="padding-left:12px;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;letter-spacing:-0.3px;color:${BRAND.white};">
                DriveIQ
              </td>
            </tr>
          </table>
          <p style="margin:14px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;letter-spacing:0.4px;text-transform:uppercase;color:rgba(255,255,255,0.85);">
            London · for drivers
          </p>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

export function brandFooter(): string {
  return `
<tr>
  <td style="padding:20px 8px 0 8px;text-align:center;">
    <p style="margin:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;color:${BRAND.text};">
      DriveIQ
    </p>
    <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:${BRAND.muted};">
      Real-time London demand for drivers.<br />
      Questions? Reply to this email or write to hello@driveiq.app
    </p>
  </td>
</tr>`;
}

export function stepRow(number: string, title: string, body: string): string {
  return `
<tr>
  <td style="padding:0 0 14px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td valign="top" style="width:36px;">
          <div style="width:28px;height:28px;border-radius:14px;background-color:${BRAND.soft};font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;color:${BRAND.primaryDark};text-align:center;line-height:28px;">
            ${number}
          </div>
        </td>
        <td valign="top" style="padding-left:10px;">
          <p style="margin:0 0 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:${BRAND.text};">
            ${title}
          </p>
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;color:${BRAND.muted};">
            ${body}
          </p>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}
