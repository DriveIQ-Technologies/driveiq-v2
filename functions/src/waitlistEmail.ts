/**
 * Branded waitlist emails for Brevo (claim-code resend + launch template).
 * Table-based HTML for Gmail / Outlook / Apple Mail.
 *
 * Shared chrome (shell, header, footer, step rows) lives in emailTheme.ts.
 */

import {
  BRAND,
  type EmailContent,
  brandFooter,
  brandHeader,
  emailShell,
  escapeHtml,
  stepRow,
} from './emailTheme.js';

export type WaitlistClaimEmailContent = EmailContent;

/** Resend / fallback email: personal claim code + steps (no deep link). */
export function buildWaitlistClaimCodeEmail(opts: {
  claimToken: string;
}): WaitlistClaimEmailContent {
  const token = escapeHtml(opts.claimToken.trim().toUpperCase());
  const subject = 'Your DriveIQ waitlist claim code';
  const text = [
    'DriveIQ — your free Premium week',
    '',
    `Your claim code: ${opts.claimToken.trim().toUpperCase()}`,
    'One-time use. Expires 14 days after it was issued.',
    '',
    'How to claim:',
    '1. Download DriveIQ and create an account.',
    '2. Sign up with this waitlist email → Premium is applied automatically.',
    '3. Used a different email? Menu → Claim waitlist week → enter the code above.',
    '',
    'Questions? hello@driveiq.app',
  ].join('\n');

  const bodyRows = `
${brandHeader()}
<tr>
  <td style="background-color:${BRAND.white};border-left:1px solid ${BRAND.border};border-right:1px solid ${BRAND.border};padding:28px 28px 8px 28px;">
    <p style="margin:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${BRAND.primary};">
      Waitlist offer
    </p>
    <h1 style="margin:0 0 12px 0;font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:32px;font-weight:700;color:${BRAND.text};">
      Your free Premium week is ready
    </h1>
    <p style="margin:0 0 24px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:23px;color:${BRAND.muted};">
      Thanks for joining early. Use the code below to unlock 7 days of DriveIQ Premium — one claim per waitlist invite.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.soft};border:1px solid #C9DEFF;border-radius:14px;">
      <tr>
        <td style="padding:20px 18px;text-align:center;">
          <p style="margin:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:${BRAND.primaryDark};">
            Your claim code
          </p>
          <p style="margin:0;font-family:'Courier New',Courier,monospace;font-size:32px;line-height:38px;font-weight:700;letter-spacing:4px;color:${BRAND.text};">
            ${token}
          </p>
          <p style="margin:10px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${BRAND.muted};">
            One-time use · expires in 14 days
          </p>
        </td>
      </tr>
    </table>
  </td>
</tr>
<tr>
  <td style="background-color:${BRAND.white};border-left:1px solid ${BRAND.border};border-right:1px solid ${BRAND.border};padding:28px;">
    <p style="margin:0 0 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:${BRAND.text};">
      How to claim
    </p>
    ${stepRow('1', 'Download & create an account', 'Get DriveIQ on the App Store and sign up.')}
    ${stepRow('2', 'Used this waitlist email?', 'Premium is applied automatically when you sign up with the same email.')}
    ${stepRow('3', 'Used a different email?', 'Open Menu → Claim waitlist week and enter the code above (or request a resend to this inbox).')}
  </td>
</tr>
<tr>
  <td style="background-color:${BRAND.white};border:1px solid ${BRAND.border};border-top:0;border-radius:0 0 18px 18px;padding:0 28px 24px 28px;">
    <p style="margin:0;padding:14px 16px;background-color:${BRAND.surface};border-radius:12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:19px;color:${BRAND.muted};">
      Tip: keep this email handy. The code works on any account, but once claimed it’s locked to that account.
    </p>
  </td>
</tr>
${brandFooter()}`;

  return {
    subject,
    html: emailShell({
      preheader: `Your DriveIQ claim code is ${opts.claimToken.trim().toUpperCase()}. Unlock your free Premium week.`,
      bodyRows,
    }),
    text,
  };
}

/** Launch email template for Brevo campaigns (paste HTML; use {{CLAIM_CODE}}). */
export function buildWaitlistLaunchEmailTemplate(): WaitlistClaimEmailContent {
  const subject = 'DriveIQ is live — claim your free Premium week';
  const text = [
    'DriveIQ is live.',
    '',
    'Your free Premium week is ready. Claim code: {{CLAIM_CODE}}',
    '',
    'Steps:',
    '1. Download DriveIQ and create an account.',
    '2. Sign up with this waitlist email → Premium applied automatically.',
    '3. Different email? Menu → Claim waitlist week → enter {{CLAIM_CODE}}.',
    '',
    'One-time code. Expires 14 days after launch.',
  ].join('\n');

  const bodyRows = `
${brandHeader()}
<tr>
  <td style="background-color:${BRAND.white};border-left:1px solid ${BRAND.border};border-right:1px solid ${BRAND.border};padding:28px 28px 8px 28px;">
    <p style="margin:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${BRAND.primary};">
      You’re on the waitlist
    </p>
    <h1 style="margin:0 0 12px 0;font-family:Arial,Helvetica,sans-serif;font-size:28px;line-height:34px;font-weight:700;color:${BRAND.text};">
      DriveIQ is live — claim your free week
    </h1>
    <p style="margin:0 0 24px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:23px;color:${BRAND.muted};">
      Thanks for waiting with us. Here’s your personal code for <strong style="color:${BRAND.text};">7 days of Premium</strong> — London demand, flights, events, and stations, unlocked.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.soft};border:1px solid #C9DEFF;border-radius:14px;">
      <tr>
        <td style="padding:20px 18px;text-align:center;">
          <p style="margin:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:${BRAND.primaryDark};">
            Your claim code
          </p>
          <p style="margin:0;font-family:'Courier New',Courier,monospace;font-size:32px;line-height:38px;font-weight:700;letter-spacing:4px;color:${BRAND.text};">
            {{CLAIM_CODE}}
          </p>
          <p style="margin:10px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${BRAND.muted};">
            One-time use · claim within 14 days
          </p>
        </td>
      </tr>
    </table>
  </td>
</tr>
<tr>
  <td style="background-color:${BRAND.white};border-left:1px solid ${BRAND.border};border-right:1px solid ${BRAND.border};padding:28px;">
    <p style="margin:0 0 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:${BRAND.text};">
      How to claim
    </p>
    ${stepRow('1', 'Download DriveIQ', 'Create your account in the app.')}
    ${stepRow('2', 'Sign up with this email', 'Use your waitlist email and Premium is applied automatically.')}
    ${stepRow('3', 'Or enter your code', 'If you used Apple / Google / another email: Menu → Claim waitlist week → paste the code above.')}
  </td>
</tr>
<tr>
  <td style="background-color:${BRAND.white};border:1px solid ${BRAND.border};border-top:0;border-radius:0 0 18px 18px;padding:0 28px 24px 28px;">
    <p style="margin:0;padding:14px 16px;background-color:${BRAND.surface};border-radius:12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:19px;color:${BRAND.muted};">
      No claim link needed — just the code and these steps. Once claimed, the free week is bound to that account.
    </p>
  </td>
</tr>
${brandFooter()}`;

  return {
    subject,
    html: emailShell({
      preheader: 'DriveIQ is live. Your personal claim code unlocks a free Premium week.',
      bodyRows,
    }),
    text,
  };
}
