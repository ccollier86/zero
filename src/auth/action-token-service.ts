/**
 * action-token-service.ts
 *
 * Owns one-time auth action token creation and verification. This service
 * generates raw opaque tokens, stores only hashes through UserStore, and
 * enforces expiry/consume-once policy; it does not send email or register
 * HTTP routes.
 */

import type { UserStore } from './user-store';
import { AuthError } from './types';
import type { AuthActionTokenRecord, AuthActionTokenType, UserRecord } from './types';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';

/** Result returned when a raw action token is created. */
export interface CreatedAuthActionToken {
  rawToken: string;
  record: AuthActionTokenRecord;
}

/** Result returned when a raw action token is inspected. */
export interface AuthActionTokenInspection {
  record: AuthActionTokenRecord;
  user: UserRecord;
}

/** Framework-neutral service for auth action tokens. */
export class AuthActionTokenService {
  private readonly ttlMs: number;
  private readonly cooldownMs: number;

  constructor(
    private readonly store: UserStore,
    ttl: string,
    requestCooldown = '5m'
  ) {
    this.ttlMs = parseTTLtoMs(ttl);
    this.cooldownMs = parseTTLtoMs(requestCooldown);
  }

  /**
   * Create a one-time token for an auth/account lifecycle action.
   *
   * Returns the raw token exactly once so callers can embed it in an email.
   * Only a SHA-256 hash is persisted.
   */
  create(params: {
    userId: string;
    type: AuthActionTokenType;
    createdBy?: string | null;
    metadata?: Record<string, unknown>;
    skipCooldown?: boolean;
  }): CreatedAuthActionToken {
    this.cleanupExpired();
    if (!params.skipCooldown) this.assertCooldownOpen(params.userId, params.type);

    const rawToken = createOpaqueToken();
    const now = Date.now();
    const record = this.store.storeActionToken({
      tokenId: `aat_${crypto.randomUUID()}`,
      userId: params.userId,
      type: params.type,
      tokenHash: hashToken(rawToken),
      expiresAt: now + this.ttlMs,
      createdAt: now,
      createdBy: params.createdBy,
      metadata: params.metadata,
    });

    emitPlatformCode(OBS_CODES.AUTH_ACTION_TOKEN_CREATED, {
      userId: params.userId,
      metadata: {
        tokenId: record.tokenId,
        type: record.type,
        expiresAt: record.expiresAt,
        createdBy: params.createdBy ?? undefined,
      },
    });

    return { rawToken, record };
  }

  /**
   * Delete expired and already-consumed action tokens.
   *
   * This is intentionally safe to call opportunistically before token creation
   * so cooldown checks do not keep stale records around.
   */
  cleanupExpired(): number {
    return this.store.deleteExpiredActionTokens();
  }

  /**
   * Inspect a raw token without consuming it.
   *
   * Used by reset/setup screens to validate a link before the user submits a
   * new password.
   */
  inspect(
    rawToken: string,
    allowedTypes?: AuthActionTokenType[]
  ): AuthActionTokenInspection {
    const record = this.requireValidRecord(rawToken, allowedTypes);
    const user = this.store.getUserById(record.userId);
    if (!user) throw new AuthError('Action token is invalid', 'ACTION_TOKEN_INVALID', 400);
    return { record, user };
  }

  /**
   * Consume a raw token and return its record plus user.
   *
   * Consumption is one-time. A token that was already consumed fails closed.
   */
  consume(
    rawToken: string,
    allowedTypes?: AuthActionTokenType[]
  ): AuthActionTokenInspection {
    const inspection = this.inspect(rawToken, allowedTypes);
    const consumed = this.store.consumeActionToken(inspection.record.tokenId);
    if (!consumed) {
      emitPlatformCode(OBS_CODES.AUTH_ACTION_TOKEN_REJECTED, {
        userId: inspection.record.userId,
        metadata: { tokenId: inspection.record.tokenId, reason: 'consumed' },
      });
      throw new AuthError('Action token has already been used', 'ACTION_TOKEN_CONSUMED', 400);
    }

    emitPlatformCode(OBS_CODES.AUTH_ACTION_TOKEN_CONSUMED, {
      userId: inspection.record.userId,
      metadata: {
        tokenId: inspection.record.tokenId,
        type: inspection.record.type,
      },
    });

    return inspection;
  }

  private requireValidRecord(
    rawToken: string,
    allowedTypes?: AuthActionTokenType[]
  ): AuthActionTokenRecord {
    const record = this.store.getActionTokenByHash(hashToken(rawToken));
    if (!record) {
      emitPlatformCode(OBS_CODES.AUTH_ACTION_TOKEN_REJECTED, {
        metadata: { reason: 'missing' },
      });
      throw new AuthError('Action token is invalid', 'ACTION_TOKEN_INVALID', 400);
    }

    if (allowedTypes && !allowedTypes.includes(record.type)) {
      emitPlatformCode(OBS_CODES.AUTH_ACTION_TOKEN_REJECTED, {
        userId: record.userId,
        metadata: {
          tokenId: record.tokenId,
          type: record.type,
          reason: 'type',
        },
      });
      throw new AuthError('Action token is invalid', 'ACTION_TOKEN_INVALID', 400);
    }

    if (record.consumedAt !== null) {
      emitPlatformCode(OBS_CODES.AUTH_ACTION_TOKEN_REJECTED, {
        userId: record.userId,
        metadata: { tokenId: record.tokenId, reason: 'consumed' },
      });
      throw new AuthError('Action token has already been used', 'ACTION_TOKEN_CONSUMED', 400);
    }

    if (record.expiresAt < Date.now()) {
      emitPlatformCode(OBS_CODES.AUTH_ACTION_TOKEN_REJECTED, {
        userId: record.userId,
        metadata: { tokenId: record.tokenId, reason: 'expired' },
      });
      throw new AuthError('Action token has expired', 'ACTION_TOKEN_EXPIRED', 400);
    }

    return record;
  }

  private assertCooldownOpen(userId: string, type: AuthActionTokenType): void {
    if (this.cooldownMs <= 0) return;

    const now = Date.now();
    const recent = this.store.countRecentActionTokens({
      userId,
      type,
      createdAfter: now - this.cooldownMs,
      now,
    });
    if (recent === 0) return;

    emitPlatformCode(OBS_CODES.AUTH_ACTION_TOKEN_REJECTED, {
      userId,
      metadata: { type, reason: 'cooldown' },
    });
    throw new AuthError('Action token request is cooling down', 'ACTION_TOKEN_COOLDOWN', 429);
  }
}

function createOpaqueToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

function hashToken(token: string): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(token);
  return hasher.digest('hex');
}

function parseTTLtoMs(ttl: string): number {
  const match = ttl.match(/^(\d+)(s|m|h|d)$/);
  if (!match) throw new Error(`Invalid action token TTL format: ${ttl}`);

  const value = Number.parseInt(match[1], 10);
  switch (match[2]) {
    case 's':
      return value * 1_000;
    case 'm':
      return value * 60_000;
    case 'h':
      return value * 3_600_000;
    case 'd':
      return value * 86_400_000;
    default:
      throw new Error(`Invalid action token TTL unit: ${match[2]}`);
  }
}
