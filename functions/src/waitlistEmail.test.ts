import { describe, expect, it } from 'vitest';

import {
  buildWaitlistClaimCodeEmail,
  buildWaitlistLaunchEmailTemplate,
} from './waitlistEmail.js';

describe('waitlistEmail', () => {
  it('builds branded claim-code email with token and steps', () => {
    const email = buildWaitlistClaimCodeEmail({ claimToken: 'ab12cd34' });
    expect(email.subject).toMatch(/claim code/i);
    expect(email.html).toContain('DriveIQ');
    expect(email.html).toContain('AB12CD34');
    expect(email.html).toContain('#2D7DF6');
    expect(email.html).toContain('How to claim');
    expect(email.html).not.toContain('driveiq.app/claim');
    expect(email.text).toContain('AB12CD34');
  });

  it('builds launch template with Brevo CLAIM_CODE placeholder', () => {
    const email = buildWaitlistLaunchEmailTemplate();
    expect(email.subject).toMatch(/live/i);
    expect(email.html).toContain('{{CLAIM_CODE}}');
    expect(email.html).toContain('DriveIQ');
    expect(email.html).not.toContain('driveiq.app/claim');
  });
});
