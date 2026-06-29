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
import {
  getPlatformTokenService,
  type PlatformTokenService,
  PlatformTokenError,
} from '../tokens';
import type { CreatedPlatformActionToken, PlatformActionTokenRecord } from '../tokens';
import { createOpaqueToken, hashToken, parseTokenTTL } from '../tokens/token-utils';

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
  private readonly ttl: string;
  private readonly requestCooldown: string;
  private readonly ttlMs: number;
  private readonly cooldownMs: number;

  constructor(
    private readonly store: UserStore,
    ttl: string,
    requestCooldown = '5m',
    private readonly platformTokens: PlatformTokenService | null = getPlatformTokenService()
  ) {
    this.ttl = ttl;
    this.requestCooldown = requestCooldown;
    this.ttlMs = parseTokenTTL(ttl, 'auth action token TTL');
    this.cooldownMs = parseTokenTTL(requestCooldown, 'auth action token cooldown');
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
    if (this.platformTokens) {
      let created: CreatedPlatformActionToken;
      try {
        created = this.platformTokens.createActionToken({
          purpose: params.type,
          subject: { type: 'user', id: params.userId },
          ttl: this.ttl,
          cooldown: params.skipCooldown ? false : this.requestCooldown,
          createdBy: params.createdBy,
          metadata: params.metadata,
        });
      } catch (err) {
        if (err instanceof PlatformTokenError) throw toAuthActionTokenError(err);
        throw err;
      }
      const record = this.toAuthActionTokenRecord(created.record, created.rawToken);

      emitPlatformCode(OBS_CODES.AUTH_ACTION_TOKEN_CREATED, {
        userId: params.userId,
        metadata: {
          tokenId: record.tokenId,
          type: record.type,
          expiresAt: record.expiresAt,
          createdBy: params.createdBy ?? undefined,
        },
      });

      return { rawToken: created.rawToken, record };
    }

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
    const platformDeleted = this.platformTokens?.cleanupExpiredActionTokens() ?? 0;
    return platformDeleted + this.store.deleteExpiredActionTokens();
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
    const platformInspection = this.inspectPlatformToken(rawToken, allowedTypes);
    if (platformInspection) return platformInspection;

    const record = this.requireValidLegacyRecord(rawToken, allowedTypes);
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
    const platformInspection = this.consumePlatformToken(rawToken, allowedTypes);
    if (platformInspection) return platformInspection;

    const inspection = this.inspectLegacy(rawToken, allowedTypes);
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

  private inspectLegacy(
    rawToken: string,
    allowedTypes?: AuthActionTokenType[]
  ): AuthActionTokenInspection {
    const record = this.requireValidLegacyRecord(rawToken, allowedTypes);
    const user = this.store.getUserById(record.userId);
    if (!user) throw new AuthError('Action token is invalid', 'ACTION_TOKEN_INVALID', 400);
    return { record, user };
  }

  private inspectPlatformToken(
    rawToken: string,
    allowedTypes?: AuthActionTokenType[]
  ): AuthActionTokenInspection | null {
    if (!this.platformTokens) return null;

    try {
      const record = this.platformTokens.inspectActionToken(rawToken, {
        purposes: allowedTypes,
      });
      return this.toAuthInspection(record, rawToken);
    } catch (err) {
      if (err instanceof PlatformTokenError && err.code === 'TOKEN_INVALID') {
        const legacy = this.store.getActionTokenByHash(hashToken(rawToken));
        if (legacy) return null;
      }
      if (err instanceof PlatformTokenError) throw toAuthActionTokenError(err);
      throw err;
    }
  }

  private consumePlatformToken(
    rawToken: string,
    allowedTypes?: AuthActionTokenType[]
  ): AuthActionTokenInspection | null {
    if (!this.platformTokens) return null;

    try {
      const inspected = this.platformTokens.inspectActionToken(rawToken, {
        purposes: allowedTypes,
      });
      this.toAuthInspection(inspected, rawToken);
      const record = this.platformTokens.consumeActionToken(rawToken, {
        purposes: allowedTypes,
      });
      const inspection = this.toAuthInspection(record, rawToken);

      emitPlatformCode(OBS_CODES.AUTH_ACTION_TOKEN_CONSUMED, {
        userId: inspection.record.userId,
        metadata: {
          tokenId: inspection.record.tokenId,
          type: inspection.record.type,
        },
      });

      return inspection;
    } catch (err) {
      if (err instanceof PlatformTokenError && err.code === 'TOKEN_INVALID') {
        const legacy = this.store.getActionTokenByHash(hashToken(rawToken));
        if (legacy) return null;
      }
      if (err instanceof PlatformTokenError) throw toAuthActionTokenError(err);
      throw err;
    }
  }

  private toAuthInspection(
    record: PlatformActionTokenRecord,
    rawToken: string
  ): AuthActionTokenInspection {
    const authRecord = this.toAuthActionTokenRecord(record, rawToken);
    const user = this.store.getUserById(authRecord.userId);
    if (!user) throw new AuthError('Action token is invalid', 'ACTION_TOKEN_INVALID', 400);
    return { record: authRecord, user };
  }

  private toAuthActionTokenRecord(
    record: PlatformActionTokenRecord,
    rawToken: string
  ): AuthActionTokenRecord {
    if (!isAuthActionTokenType(record.purpose)) {
      throw new AuthError('Action token is invalid', 'ACTION_TOKEN_INVALID', 400);
    }
    if (record.subject?.type !== 'user' || !record.subject.id) {
      throw new AuthError('Action token is invalid', 'ACTION_TOKEN_INVALID', 400);
    }

    return {
      tokenId: record.tokenId,
      userId: record.subject.id,
      type: record.purpose,
      tokenHash: hashToken(rawToken),
      expiresAt: record.expiresAt,
      consumedAt: record.consumedAt,
      createdAt: record.createdAt,
      createdBy: record.createdBy,
      metadata: record.metadata,
    };
  }

  private requireValidLegacyRecord(
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

function isAuthActionTokenType(value: string): value is AuthActionTokenType {
  return value === 'account_setup'
    || value === 'password_reset'
    || value === 'admin_password_reset'
    || value === 'email_verification';
}

function toAuthActionTokenError(err: PlatformTokenError): AuthError {
  switch (err.code) {
    case 'TOKEN_CONSUMED':
      return new AuthError('Action token has already been used', 'ACTION_TOKEN_CONSUMED', err.status);
    case 'TOKEN_EXPIRED':
      return new AuthError('Action token has expired', 'ACTION_TOKEN_EXPIRED', err.status);
    case 'TOKEN_COOLDOWN':
      return new AuthError('Action token request is cooling down', 'ACTION_TOKEN_COOLDOWN', err.status);
    default:
      return new AuthError('Action token is invalid', 'ACTION_TOKEN_INVALID', err.status);
  }
}
