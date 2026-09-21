/**
 * Brevo API helpers: transactional sends and contact list management.
 *
 * Brevo owns the contact list, marketing automations and unsubscribe /
 * suppression handling. Cloud Functions own transactional sends (welcome,
 * trial started, day 6) so they stay exact, reviewable and testable.
 */

import { logger } from 'firebase-functions';

const BREVO_BASE = 'https://api.brevo.com/v3';

export interface BrevoSender {
  email: string;
  name?: string;
}

/** Marketing-facing attributes mirrored onto the Brevo contact. */
export interface BrevoContactAttributes {
  FIRSTNAME?: string;
  AUTH_PROVIDER?: string;
  SIGNUP_DATE?: string;
  EMAIL_VERIFIED?: boolean;
  MARKETING_CONSENT?: boolean;
}

async function brevoFetch(
  apiKey: string,
  path: string,
  init: { method: string; body?: unknown },
): Promise<Response> {
  return fetch(`${BREVO_BASE}${path}`, {
    method: init.method,
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

/** Send one transactional email. Throws on a non-2xx so callers can log it. */
export async function sendBrevoEmail(opts: {
  apiKey: string;
  toEmail: string;
  sender: BrevoSender;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const res = await brevoFetch(opts.apiKey, '/smtp/email', {
    method: 'POST',
    body: {
      sender: { email: opts.sender.email, name: opts.sender.name || 'DriveIQ' },
      to: [{ email: opts.toEmail }],
      subject: opts.subject,
      htmlContent: opts.html,
      textContent: opts.text,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`brevo/http/${res.status}: ${body.slice(0, 220)}`);
  }
}

/**
 * Create or update a contact. `updateEnabled` makes this an upsert, so a
 * returning address does not 400 as a duplicate.
 *
 * listIds is only ever passed for contacts that have given marketing consent —
 * a contact synced without it stays transactional-only.
 */
export async function upsertBrevoContact(opts: {
  apiKey: string;
  email: string;
  attributes: BrevoContactAttributes;
  listIds?: number[];
}): Promise<void> {
  const res = await brevoFetch(opts.apiKey, '/contacts', {
    method: 'POST',
    body: {
      email: opts.email,
      attributes: opts.attributes,
      updateEnabled: true,
      ...(opts.listIds && opts.listIds.length ? { listIds: opts.listIds } : {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`brevo/contact/${res.status}: ${body.slice(0, 220)}`);
  }
}

/**
 * Remove a contact entirely. Called on account deletion so the Brevo copy of
 * the address does not outlive the Firestore one.
 *
 * A 404 is success: nothing left to erase.
 */
export async function deleteBrevoContact(opts: {
  apiKey: string;
  email: string;
}): Promise<void> {
  const res = await brevoFetch(
    opts.apiKey,
    `/contacts/${encodeURIComponent(opts.email)}`,
    { method: 'DELETE' },
  );
  if (res.ok || res.status === 404) {
    logger.info('brevo.contact_deleted', { status: res.status });
    return;
  }
  const body = await res.text();
  throw new Error(`brevo/contact_delete/${res.status}: ${body.slice(0, 220)}`);
}
