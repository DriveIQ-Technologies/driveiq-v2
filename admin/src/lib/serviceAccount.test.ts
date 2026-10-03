import { describe, expect, it } from 'vitest';

import { parseServiceAccount } from './serviceAccount';

const key = {
  type: 'service_account',
  project_id: 'driveiq-app',
  client_email: 'admin-dashboard@driveiq-app.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
};

describe('parseServiceAccount', () => {
  it('reads the key JSON pasted as is', () => {
    const sa = parseServiceAccount(JSON.stringify(key));
    expect(sa.clientEmail).toBe(key.client_email);
    expect(sa.privateKey).toBe(key.private_key);
    expect(sa.projectId).toBe('driveiq-app');
  });

  it('reads base64-encoded JSON', () => {
    const sa = parseServiceAccount(Buffer.from(JSON.stringify(key)).toString('base64'));
    expect(sa.clientEmail).toBe(key.client_email);
  });

  it('restores newlines that were flattened to \\n', () => {
    const flattened = JSON.stringify({ ...key, private_key: key.private_key.replace(/\n/g, '\\n') });
    expect(parseServiceAccount(flattened).privateKey).toBe(key.private_key);
  });

  it('rejects something that is not a key', () => {
    expect(() => parseServiceAccount('{"project_id":"x"}')).toThrow(/not a service-account key/);
  });
});
