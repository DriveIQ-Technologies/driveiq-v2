/**
 * Welcome email, sent once per account on first registration.
 *
 * Fires on account creation rather than verification, so Apple and Google
 * signups get it too (they never receive a Firebase verification mail).
 * Mirrors the in-app account-ready sheet (src/data/freeAccountCopy.ts) so the
 * two reinforce each other. Premium gets one quiet line, not a hard sell.
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

/** First name where we have one. Apple only gives it on first authorisation. */
export function firstNameFrom(displayName?: string | null): string | null {
  const first = (displayName ?? '').trim().split(/\s+/)[0] ?? '';
  return first ? first : null;
}

export function buildWelcomeEmail(opts: { displayName?: string | null }): EmailContent {
  const first = firstNameFrom(opts.displayName);
  const greeting = first ? `Welcome, ${escapeHtml(first)}` : 'Welcome to DriveIQ';
  const textGreeting = first ? `Welcome, ${first}` : 'Welcome to DriveIQ';
  const subject = first ? `${first}, your DriveIQ account is ready` : 'Your DriveIQ account is ready';

  const text = [
    textGreeting,
    '',
    'Your account is ready. Here is what it gives you:',
    '',
    '- The live London map: events, roads and rail. Browse without paying.',
    '- Saves and reminders: pin events and get a ping 1 hour before start,',
    '  25 minutes before crowds leave.',
    '- Road, rail and flight alerts: turn on Notifications and we ping',
    '  disruption as it happens. Same speed as Premium.',
    '- 10 AI questions a day: ask what is on tonight, which roads are slow,',
    '  or when a gig finishes. Resets at midnight London time.',
    '',
    'Start here: open DriveIQ and turn on Notifications — that is the one',
    'setting that makes the app useful on a shift.',
    '',
    'Premium adds all-day flight boards, weeks of events ahead and unlimited',
    'AI questions, whenever you want it.',
    '',
    'Questions? hello@driveiq.app',
  ].join('\n');

  const bodyRows = `
${brandHeader()}
<tr>
  <td style="background-color:${BRAND.white};border-left:1px solid ${BRAND.border};border-right:1px solid ${BRAND.border};padding:28px 28px 8px 28px;">
    <p style="margin:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${BRAND.primary};">
      Account ready
    </p>
    <h1 style="margin:0 0 12px 0;font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:32px;font-weight:700;color:${BRAND.text};">
      ${greeting}
    </h1>
    <p style="margin:0 0 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:23px;color:${BRAND.muted};">
      You're set up. DriveIQ tracks London demand as it happens — so you know where the work is before the roads tell you.
    </p>
  </td>
</tr>
<tr>
  <td style="background-color:${BRAND.white};border-left:1px solid ${BRAND.border};border-right:1px solid ${BRAND.border};padding:8px 28px 28px 28px;">
    <p style="margin:0 0 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:${BRAND.text};">
      What your free account gives you
    </p>
    ${stepRow('1', 'The live London map', 'Events, roads and rail on the map. Browse without paying.')}
    ${stepRow('2', 'Saves and reminders', 'Pin events and get a ping 1 hour before start, 25 minutes before crowds leave.')}
    ${stepRow('3', 'Road, rail and flight alerts', 'Turn on Notifications and we ping disruption as it happens. Same speed as Premium.')}
    ${stepRow('4', '10 AI questions a day', 'Ask what is on tonight, which roads are slow, or when a gig finishes. Resets at midnight London time.')}
  </td>
</tr>
<tr>
  <td style="background-color:${BRAND.white};border-left:1px solid ${BRAND.border};border-right:1px solid ${BRAND.border};padding:0 28px 24px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.soft};border:1px solid #C9DEFF;border-radius:14px;">
      <tr>
        <td style="padding:18px;">
          <p style="margin:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:${BRAND.text};">
            Start here: turn on Notifications
          </p>
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;color:${BRAND.muted};">
            It's the one setting that makes DriveIQ useful mid-shift — disruption reaches you without opening the app.
          </p>
        </td>
      </tr>
    </table>
  </td>
</tr>
<tr>
  <td style="background-color:${BRAND.white};border:1px solid ${BRAND.border};border-top:0;border-radius:0 0 18px 18px;padding:0 28px 24px 28px;">
    <p style="margin:0;padding:14px 16px;background-color:${BRAND.surface};border-radius:12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:19px;color:${BRAND.muted};">
      Premium adds all-day flight boards, weeks of events ahead and unlimited AI questions — there whenever you want it, no rush.
    </p>
  </td>
</tr>
${brandFooter()}`;

  return {
    subject,
    html: emailShell({
      preheader: 'Your DriveIQ account is ready — here’s what it gives you.',
      bodyRows,
    }),
    text,
  };
}
