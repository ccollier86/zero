import type { SyncAuthMessage, SyncAuthReadyMessage } from './types';

const MAX_SYNC_AUTH_TOKEN_LENGTH = 16_384;

export type ParsedSyncAuthMessage =
  | { matched: false }
  | { matched: true; ok: true; token?: string }
  | { matched: true; ok: false };

/** Parse only the auth handshake, leaving all other wire messages untouched. */
export function parseSyncAuthMessage(
  message: string | Record<string, unknown>
): ParsedSyncAuthMessage {
  const value = parseMessageValue(message);
  if (!value || value.type !== 'sync.auth') return { matched: false };

  const token = value.token;
  if (token === undefined) return { matched: true, ok: true };
  if (
    typeof token !== 'string'
    || token.length === 0
    || token.length > MAX_SYNC_AUTH_TOKEN_LENGTH
  ) {
    return { matched: true, ok: false };
  }

  return { matched: true, ok: true, token };
}

export function createSyncAuthMessage(token?: string | null): SyncAuthMessage {
  return token ? { type: 'sync.auth', token } : { type: 'sync.auth' };
}

export function createSyncAuthReadyMessage(
  authenticated: boolean
): SyncAuthReadyMessage {
  return { type: 'sync.auth.ready', authenticated };
}

function parseMessageValue(
  message: string | Record<string, unknown>
): Record<string, unknown> | null {
  if (typeof message !== 'string') return message;

  try {
    const value = JSON.parse(message) as unknown;
    return value && typeof value === 'object'
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
