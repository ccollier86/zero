/**
 * Durable authenticated encryption for invitation secrets waiting in the
 * auth email outbox. Random data-encryption keys are persisted only after an
 * operator-supplied key encrypts them; neither plaintext tokens nor plaintext
 * data keys reach the database.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import type { ReactiveDB } from '../sync/reactive-db';

const KEYRING_CONFIG_KEY = 'auth.tenant_invitation.envelope_keys';
const ENVELOPE_VERSION = 'v1';
const KEYRING_VERSION = 1;
const MAX_RETAINED_KEYS = 8;

/** Stable AAD binding: ciphertext cannot move across jobs, invites, or recipients. */
export function tenantInvitationEnvelopeAad(
  jobId: string,
  invitationId: string,
  recipient: string,
): string {
  return `tenant-invitation:${jobId}:${invitationId}:${recipient}`;
}

interface StoredKeyring {
  version: 1;
  wrappingKeyId: string;
  activeKeyId: string;
  keys: Array<{ keyId: string; wrappedKey: string }>;
}

interface LoadedKeyring {
  stored: StoredKeyring;
  keys: Map<string, Buffer>;
}

export type TenantInvitationEnvelopeErrorCode =
  | 'TENANT_INVITATION_ENVELOPE_FORMAT_INVALID'
  | 'TENANT_INVITATION_ENVELOPE_KEY_UNAVAILABLE'
  | 'TENANT_INVITATION_ENVELOPE_AUTHENTICATION_FAILED';

/** An explicit, log-safe failure. It never includes ciphertext or plaintext. */
export class TenantInvitationEnvelopeError extends Error {
  constructor(readonly code: TenantInvitationEnvelopeErrorCode) {
    super(code);
    this.name = 'TenantInvitationEnvelopeError';
  }
}

/**
 * AES-256-GCM invitation envelope backed by a durable, versioned keyring.
 *
 * The key id travels with each envelope so a future rotation can retain old
 * keys until every queued job drains. Removing a referenced key fails closed
 * with a stable error instead of silently issuing a replacement link.
 */
export class AuthTenantInvitationEnvelope {
  private keyring: LoadedKeyring;
  private readonly wrappingKey: Buffer;
  private readonly wrappingKeyId: string;

  constructor(
    private readonly db: ReactiveDB,
    wrappingSecret: string,
    previousWrappingSecrets: readonly string[] = [],
  ) {
    this.wrappingKey = decodeTenantInvitationWrappingKey(wrappingSecret);
    this.wrappingKeyId = keyIdFor(this.wrappingKey);
    const wrappingKeys = new Map<string, Buffer>([
      [this.wrappingKeyId, this.wrappingKey],
      ...previousWrappingSecrets.map((secret) => {
        const key = decodeTenantInvitationWrappingKey(
          secret,
          'previousEncryptionKeys entry',
        );
        return [keyIdFor(key), key] as const;
      }),
    ]);
    this.keyring = loadOrCreateKeyring(
      db,
      this.wrappingKey,
      this.wrappingKeyId,
      wrappingKeys,
    );
  }

  encrypt(plaintext: string, aad: string): string {
    const activeKeyId = this.keyring.stored.activeKeyId;
    const active = this.requireKey(activeKeyId);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', active, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authenticatedCiphertext = Buffer.concat([
      ciphertext,
      cipher.getAuthTag(),
    ]);
    return [
      ENVELOPE_VERSION,
      activeKeyId,
      iv.toString('base64url'),
      authenticatedCiphertext.toString('base64url'),
    ].join('.');
  }

  decrypt(envelope: string, aad: string): string {
    const [version, keyId, ivValue, ciphertextValue, ...extra] = envelope.split('.');
    if (version !== ENVELOPE_VERSION || !keyId || !ivValue
      || !ciphertextValue || extra.length > 0) {
      throw new TenantInvitationEnvelopeError(
        'TENANT_INVITATION_ENVELOPE_FORMAT_INVALID',
      );
    }
    const key = this.requireKey(keyId);
    let iv: Buffer;
    let authenticatedCiphertext: Buffer;
    try {
      iv = Buffer.from(ivValue, 'base64url');
      authenticatedCiphertext = Buffer.from(ciphertextValue, 'base64url');
    } catch {
      throw new TenantInvitationEnvelopeError(
        'TENANT_INVITATION_ENVELOPE_FORMAT_INVALID',
      );
    }
    if (iv.length !== 12 || authenticatedCiphertext.length <= 16) {
      throw new TenantInvitationEnvelopeError(
        'TENANT_INVITATION_ENVELOPE_FORMAT_INVALID',
      );
    }
    const ciphertext = authenticatedCiphertext.subarray(0, -16);
    const tag = authenticatedCiphertext.subarray(-16);
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new TenantInvitationEnvelopeError(
        'TENANT_INVITATION_ENVELOPE_AUTHENTICATION_FAILED',
      );
    }
  }

  /**
   * Rotate the active envelope key while retaining prior keys for queued jobs.
   * This is intentionally a server-side maintenance primitive, not an HTTP API.
   */
  rotateDataKey(): string {
    const generated = createWrappedKey(this.wrappingKey);
    const keys = [generated.stored, ...this.keyring.stored.keys]
      .slice(0, MAX_RETAINED_KEYS);
    const next: StoredKeyring = {
      version: KEYRING_VERSION,
      wrappingKeyId: this.wrappingKeyId,
      activeKeyId: generated.stored.keyId,
      keys,
    };
    this.db.prepare(`
      INSERT OR REPLACE INTO _auth_config (key, value) VALUES (?, ?)
    `).run(KEYRING_CONFIG_KEY, JSON.stringify(next));
    this.keyring = loadKeyring(next, new Map([
      [this.wrappingKeyId, this.wrappingKey],
    ]));
    return generated.stored.keyId;
  }

  private requireKey(keyId: string): Buffer {
    const key = this.keyring.keys.get(keyId);
    if (!key) {
      throw new TenantInvitationEnvelopeError(
        'TENANT_INVITATION_ENVELOPE_KEY_UNAVAILABLE',
      );
    }
    return key;
  }
}

function loadOrCreateKeyring(
  db: ReactiveDB,
  activeWrappingKey: Buffer,
  activeWrappingKeyId: string,
  wrappingKeys: ReadonlyMap<string, Buffer>,
): LoadedKeyring {
  const select = db.prepare('SELECT value FROM _auth_config WHERE key = ?');
  const insert = db.prepare(`
    INSERT INTO _auth_config (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO NOTHING
  `);
  const generated = createWrappedKey(activeWrappingKey);
  insert.run(KEYRING_CONFIG_KEY, JSON.stringify({
    version: KEYRING_VERSION,
    wrappingKeyId: activeWrappingKeyId,
    activeKeyId: generated.stored.keyId,
    keys: [generated.stored],
  } satisfies StoredKeyring));
  const row = select.get(KEYRING_CONFIG_KEY) as { value: string } | null;
  if (!row) throw new Error('[auth] Failed to initialize invitation envelope keyring.');
  const parsed = parseKeyring(row.value);
  const loaded = loadKeyring(parsed, wrappingKeys);
  if (parsed.wrappingKeyId === activeWrappingKeyId) return loaded;

  // A previous key was explicitly supplied. Rewrap every DEK atomically so
  // the operator can remove that old key on the next deployment.
  const rewrapped: StoredKeyring = {
    version: KEYRING_VERSION,
    wrappingKeyId: activeWrappingKeyId,
    activeKeyId: parsed.activeKeyId,
    keys: parsed.keys.map(({ keyId }) => ({
      keyId,
      wrappedKey: wrapDataKey(loaded.keys.get(keyId)!, keyId, activeWrappingKey),
    })),
  };
  db.transaction(() => {
    db.prepare(`
      UPDATE _auth_config SET value = ? WHERE key = ? AND value = ?
    `).run(JSON.stringify(rewrapped), KEYRING_CONFIG_KEY, row.value);
    const current = select.get(KEYRING_CONFIG_KEY) as { value: string } | null;
    if (!current || current.value !== JSON.stringify(rewrapped)) {
      throw new Error(
        '[auth] Invitation envelope wrapping-key rotation raced another process; restart and retry.',
      );
    }
  });
  return { stored: Object.freeze(rewrapped), keys: loaded.keys };
}

function parseKeyring(value: string): StoredKeyring {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('[auth] Invitation envelope keyring is invalid JSON.');
  }
  if (!isRecord(parsed) || parsed.version !== KEYRING_VERSION
    || typeof parsed.wrappingKeyId !== 'string'
    || typeof parsed.activeKeyId !== 'string' || !Array.isArray(parsed.keys)
    || parsed.keys.length < 1 || parsed.keys.length > MAX_RETAINED_KEYS) {
    throw new Error('[auth] Invitation envelope keyring is invalid.');
  }
  const keys: StoredKeyring['keys'] = [];
  const keyIds = new Set<string>();
  for (const candidate of parsed.keys) {
    if (!isRecord(candidate) || typeof candidate.keyId !== 'string'
      || typeof candidate.wrappedKey !== 'string' || keyIds.has(candidate.keyId)) {
      throw new Error('[auth] Invitation envelope keyring contains an invalid key.');
    }
    keyIds.add(candidate.keyId);
    keys.push({ keyId: candidate.keyId, wrappedKey: candidate.wrappedKey });
  }
  if (!keyIds.has(parsed.activeKeyId)) {
    throw new Error('[auth] Invitation envelope active key is unavailable.');
  }
  return Object.freeze({
    version: KEYRING_VERSION,
    wrappingKeyId: parsed.wrappingKeyId,
    activeKeyId: parsed.activeKeyId,
    keys: Object.freeze(keys) as unknown as StoredKeyring['keys'],
  });
}

function loadKeyring(
  stored: StoredKeyring,
  wrappingKeys: ReadonlyMap<string, Buffer>,
): LoadedKeyring {
  const wrappingKey = wrappingKeys.get(stored.wrappingKeyId);
  if (!wrappingKey) {
    throw new Error(
      '[auth] Invitation envelope wrapping key is unavailable. Add the prior 32-byte key to previousEncryptionKeys for one startup so Zero can atomically rewrap queued invitation keys.',
    );
  }
  const keys = new Map<string, Buffer>();
  try {
    for (const candidate of stored.keys) {
      const key = unwrapDataKey(candidate, wrappingKey);
      if (keyIdFor(key) !== candidate.keyId) {
        throw new Error('key id mismatch');
      }
      keys.set(candidate.keyId, key);
    }
  } catch {
    throw new Error(
      '[auth] Invitation envelope keyring cannot be decrypted with the configured encryptionKey.',
    );
  }
  return { stored: Object.freeze(stored), keys };
}

function createWrappedKey(wrappingKey: Buffer): {
  stored: StoredKeyring['keys'][number];
  key: Buffer;
} {
  const key = randomBytes(32);
  const keyId = keyIdFor(key);
  const wrappedKey = wrapDataKey(key, keyId, wrappingKey);
  return { stored: { keyId, wrappedKey }, key };
}

function wrapDataKey(key: Buffer, keyId: string, wrappingKey: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', wrappingKey, iv);
  cipher.setAAD(wrappingKeyAad(keyId));
  const encrypted = Buffer.concat([cipher.update(key), cipher.final()]);
  return [
    ENVELOPE_VERSION,
    iv.toString('base64url'),
    Buffer.concat([encrypted, cipher.getAuthTag()]).toString('base64url'),
  ].join('.');
}

function unwrapDataKey(
  stored: StoredKeyring['keys'][number],
  wrappingKey: Buffer,
): Buffer {
  const [version, ivValue, encryptedValue, ...extra] = stored.wrappedKey.split('.');
  if (version !== ENVELOPE_VERSION || !ivValue || !encryptedValue || extra.length) {
    throw new Error('invalid wrapped key');
  }
  const iv = Buffer.from(ivValue, 'base64url');
  const authenticated = Buffer.from(encryptedValue, 'base64url');
  if (iv.length !== 12 || authenticated.length !== 48) {
    throw new Error('invalid wrapped key');
  }
  const decipher = createDecipheriv('aes-256-gcm', wrappingKey, iv);
  decipher.setAAD(wrappingKeyAad(stored.keyId));
  decipher.setAuthTag(authenticated.subarray(-16));
  const key = Buffer.concat([
    decipher.update(authenticated.subarray(0, -16)),
    decipher.final(),
  ]);
  if (key.length !== 32) throw new Error('invalid wrapped key');
  return key;
}

function wrappingKeyAad(keyId: string): Buffer {
  return Buffer.from(`tenant-invitation-key:v1:${keyId}`, 'utf8');
}

/**
 * Decode the operator KEK and reject common placeholder/repetition mistakes.
 * No validator can prove entropy from one key; production keys must still be
 * generated by a cryptographically secure random source.
 */
export function decodeTenantInvitationWrappingKey(
  secret: string,
  label = 'encryptionKey',
): Buffer {
  if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret)) {
    throw new Error(
      `[auth] Tenant invitation email ${label} must be an unpadded base64url-encoded 32-byte key.`,
    );
  }
  const key = Buffer.from(secret, 'base64url');
  if (key.length !== 32 || key.toString('base64url') !== secret) {
    throw new Error(
      `[auth] Tenant invitation email ${label} must be an unpadded base64url-encoded 32-byte key.`,
    );
  }
  // Random 32-byte keys overwhelmingly contain far more than 16 distinct
  // bytes. This catches all-zero/all-same/repeated fixtures and copy mistakes
  // without pretending to estimate the key's true entropy.
  if (new Set(key).size < 16) {
    throw new Error(
      `[auth] Tenant invitation email ${label} appears to be a repeated or placeholder value; generate a random 32-byte key.`,
    );
  }
  return key;
}

function keyIdFor(key: Buffer): string {
  return createHash('sha256').update(key).digest('base64url').slice(0, 16);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
