import type { ServiceAccount } from 'firebase-admin/app';

/**
 * Reads FIREBASE_SERVICE_ACCOUNT: the service-account key JSON, pasted as is
 * or base64-encoded (either works in Vercel's env var editor).
 */
export function parseServiceAccount(raw: string): ServiceAccount {
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const json = JSON.parse(text) as { project_id?: string; client_email?: string; private_key?: string };
  if (!json.client_email || !json.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not a service-account key (missing client_email/private_key)');
  }
  return {
    projectId: json.project_id,
    clientEmail: json.client_email,
    // Some editors turn the key's newlines into literal "\n".
    privateKey: json.private_key.replace(/\\n/g, '\n'),
  };
}
