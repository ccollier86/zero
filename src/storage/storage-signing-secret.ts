/**
 * Durable signing-secret resolution for storage bearer capabilities.
 *
 * Explicit secrets remain operator-owned and are never copied into the
 * database. When one is not supplied, Zero creates a cryptographically random
 * key once and retains it in the app's private config table so grants survive
 * normal restarts and are shared by runtimes using the same database.
 */

import { randomBytes } from 'node:crypto';

import type { ReactiveDB } from '../sync/reactive-db';

const STORAGE_CAPABILITY_SIGNING_KEY = 'storage_capability_signing_secret';
const STORAGE_CAPABILITY_SIGNING_KEY_BYTES = 32;

interface StoredSecretRow {
  value: string;
}

/** Resolve the effective storage capability signing secret for one runtime. */
export function resolveStorageCapabilitySigningSecret(
  db: ReactiveDB,
  configured?: string,
): string {
  if (configured !== undefined) {
    if (configured.trim().length === 0) {
      throw new Error('[storage] signingSecret must not be empty.');
    }
    return configured;
  }

  // Storage is normally mounted after Auth, which owns this canonical private
  // table. Defining the same shape keeps standalone plugin composition safe.
  db.exec(`CREATE TABLE IF NOT EXISTS _auth_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);

  const select = db.prepare('SELECT value FROM _auth_config WHERE key = ?');
  const insert = db.prepare(
    'INSERT OR IGNORE INTO _auth_config (key, value) VALUES (?, ?)',
  );
  insert.run(
    STORAGE_CAPABILITY_SIGNING_KEY,
    randomBytes(STORAGE_CAPABILITY_SIGNING_KEY_BYTES).toString('base64url'),
  );
  const row = select.get(STORAGE_CAPABILITY_SIGNING_KEY) as StoredSecretRow | null;
  if (!row || !isPersistedStorageCapabilitySigningSecret(row.value)) {
    throw new Error('[storage] Persisted capability signing secret is invalid.');
  }
  return row.value;
}

/** Test whether an operator-provided HMAC secret meets the production floor. */
export function isStrongStorageCapabilitySigningSecret(secret: string): boolean {
  return secret.trim().length > 0
    && new TextEncoder().encode(secret).byteLength >= STORAGE_CAPABILITY_SIGNING_KEY_BYTES;
}

function isPersistedStorageCapabilitySigningSecret(value: string): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return false;
  const decoded = Buffer.from(value, 'base64url');
  return decoded.byteLength === STORAGE_CAPABILITY_SIGNING_KEY_BYTES
    && decoded.toString('base64url') === value;
}
