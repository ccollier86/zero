/** Versioned persistence over an app-provided OS secure-vault adapter. */

import type { NativeSecureVault } from './adapter-types';
import { NativeAuthError } from './errors';
import type { NativePendingAuthorization, NativeStoredSession } from './oidc-types';

interface VaultEnvelope<T> {
  version: 1;
  value: T;
}

export class NativeVaultStore {
  private readonly sessionKey: string;
  private readonly pendingKey: string;

  constructor(private readonly vault: NativeSecureVault, namespace: string) {
    this.sessionKey = `${namespace}.session.v1`;
    this.pendingKey = `${namespace}.authorization.v1`;
  }

  loadSession(): Promise<NativeStoredSession | null> {
    return this.read(this.sessionKey, isStoredSession);
  }

  saveSession(value: NativeStoredSession): Promise<void> {
    return this.write(this.sessionKey, value);
  }

  clearSession(): Promise<void> {
    return this.vault.delete(this.sessionKey);
  }

  loadPending(): Promise<NativePendingAuthorization | null> {
    return this.read(this.pendingKey, isPendingAuthorization);
  }

  savePending(value: NativePendingAuthorization): Promise<void> {
    return this.write(this.pendingKey, value);
  }

  clearPending(): Promise<void> {
    return this.vault.delete(this.pendingKey);
  }

  private async write<T>(key: string, value: T): Promise<void> {
    await this.vault.set(key, JSON.stringify({ version: 1, value } satisfies VaultEnvelope<T>));
  }

  private async read<T>(key: string, guard: (value: unknown) => value is T): Promise<T | null> {
    const raw = await this.vault.get(key);
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<VaultEnvelope<unknown>>;
      if (parsed.version !== 1 || !guard(parsed.value)) throw new Error('invalid');
      return parsed.value;
    } catch {
      throw new NativeAuthError('Secure session data was invalid.', 'NATIVE_VAULT_DATA_INVALID');
    }
  }
}

function isStoredSession(value: unknown): value is NativeStoredSession {
  if (!isRecord(value) || !isRecord(value.identity)) return false;
  return strings(value, ['issuer', 'clientId', 'subject', 'refreshToken'])
    && strings(value.identity, ['iss', 'sub'])
    && typeof value.identity.exp === 'number'
    && typeof value.identity.iat === 'number';
}

function isPendingAuthorization(value: unknown): value is NativePendingAuthorization {
  return isRecord(value)
    && strings(value, ['issuer', 'clientId', 'redirectUri', 'state', 'nonce', 'codeVerifier'])
    && typeof value.createdAt === 'number';
}

function strings(value: Record<string, unknown>, fields: string[]): boolean {
  return fields.every((field) => typeof value[field] === 'string' && value[field] !== '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
