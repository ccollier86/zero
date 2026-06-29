/**
 * token-service.ts
 *
 * Owns Zero's generic platform token business rules. It creates raw opaque
 * action/resume tokens, stores only hashes through PlatformTokenStore, enforces
 * expiry, consume-once, rotation, revocation, and cooldown policy; it does not
 * register HTTP routes or send email.
 */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type {
  CreatePlatformActionTokenOptions,
  CreatePlatformResumeTokenOptions,
  CreatedPlatformActionToken,
  CreatedPlatformResumeToken,
  PlatformActionTokenLookupOptions,
  PlatformActionTokenRecord,
  PlatformResumeResource,
  PlatformResumeTokenLookupOptions,
  PlatformResumeTokenRecord,
  PlatformTokenServiceConfig,
  PlatformTokenSubject,
  RotatePlatformResumeTokenOptions,
} from './token-types';
import { PLATFORM_TOKEN_DEFAULTS, PlatformTokenError } from './token-types';
import { PlatformTokenStore, type StoredPlatformActionTokenRecord, type StoredPlatformResumeTokenRecord } from './token-store';
import { createOpaqueToken, hashToken, parseTokenTTL } from './token-utils';

/** Framework-neutral service for generic platform action and resume tokens. */
export class PlatformTokenService {
  private readonly actionTokenTTL: string;
  private readonly resumeTokenTTL: string;
  private readonly actionTokenCooldown: string | false;

  constructor(
    private readonly store: PlatformTokenStore,
    config: PlatformTokenServiceConfig = {}
  ) {
    this.actionTokenTTL = config.actionTokenTTL ?? PLATFORM_TOKEN_DEFAULTS.actionTokenTTL;
    this.resumeTokenTTL = config.resumeTokenTTL ?? PLATFORM_TOKEN_DEFAULTS.resumeTokenTTL;
    this.actionTokenCooldown = config.actionTokenCooldown ?? PLATFORM_TOKEN_DEFAULTS.actionTokenCooldown;
  }

  /**
   * Create a generic consume-once action token.
   *
   * Returns the raw token exactly once. Only its SHA-256 hash is persisted.
   * Use this for verification links, invites, password actions, and one-time
   * app approvals.
   */
  createActionToken(options: CreatePlatformActionTokenOptions): CreatedPlatformActionToken {
    const purpose = normalizeRequiredValue(options.purpose, 'purpose');
    const scope = normalizeOptionalValue(options.scope);
    const subject = normalizeSubject(options.subject);
    const metadata = options.metadata ?? {};
    const now = Date.now();
    const cooldown = options.cooldown ?? this.actionTokenCooldown;

    this.cleanupExpiredActionTokens();
    if (cooldown !== false) {
      this.assertActionCooldownOpen({
        purpose,
        subject,
        scope,
        cooldown,
        now,
      });
    }

    const rawToken = createOpaqueToken();
    const ttlMs = parseTokenTTL(options.ttl ?? this.actionTokenTTL, 'action token TTL');
    const stored = this.store.storeActionToken({
      tokenId: `zat_${crypto.randomUUID()}`,
      purpose,
      tokenHash: hashToken(rawToken),
      subject,
      scope,
      expiresAt: now + ttlMs,
      createdAt: now,
      createdBy: options.createdBy ?? null,
      metadata,
    });

    emitPlatformCode(OBS_CODES.TOKENS_ACTION_CREATED, {
      userId: subject?.type === 'user' ? subject.id : undefined,
      metadata: {
        tokenId: stored.tokenId,
        purpose,
        scope: scope ?? undefined,
        subjectType: subject?.type,
        expiresAt: stored.expiresAt,
      },
    });

    return { rawToken, record: publicActionRecord(stored) };
  }

  /**
   * Inspect an action token without consuming it.
   *
   * This is useful for rendering an action screen before final submit. It still
   * enforces expiry, purpose, and scope constraints.
   */
  inspectActionToken(
    rawToken: string,
    options: PlatformActionTokenLookupOptions = {}
  ): PlatformActionTokenRecord {
    return publicActionRecord(this.requireValidActionToken(rawToken, options));
  }

  /**
   * Consume a generic action token once.
   *
   * A consumed token cannot be inspected or consumed again. Use this at the
   * final state-changing step of a verification/action flow.
   */
  consumeActionToken(
    rawToken: string,
    options: PlatformActionTokenLookupOptions = {}
  ): PlatformActionTokenRecord {
    const stored = this.requireValidActionToken(rawToken, options);
    const consumed = this.store.consumeActionToken(stored.tokenId);
    if (!consumed) {
      emitTokenRejected('action', stored, 'consumed');
      throw new PlatformTokenError('Action token has already been used', 'TOKEN_CONSUMED', 400);
    }

    emitPlatformCode(OBS_CODES.TOKENS_ACTION_CONSUMED, {
      userId: stored.subject?.type === 'user' ? stored.subject.id : undefined,
      metadata: {
        tokenId: stored.tokenId,
        purpose: stored.purpose,
        scope: stored.scope ?? undefined,
      },
    });

    return publicActionRecord({ ...stored, consumedAt: Date.now() });
  }

  /** Revoke an action token by raw token value without consuming its meaning. */
  revokeActionToken(rawToken: string): boolean {
    const record = this.store.getActionTokenByHash(hashToken(rawToken));
    if (!record) return false;
    return this.store.revokeActionToken(record.tokenId);
  }

  /** Delete expired and already-consumed action tokens. */
  cleanupExpiredActionTokens(): number {
    return this.store.deleteExpiredActionTokens();
  }

  /**
   * Create a long-lived resume token.
   *
   * Resume tokens are scoped to an app flow and resource. They are reusable
   * until expiry, revocation, rotation, or flow completion.
   */
  createResumeToken(options: CreatePlatformResumeTokenOptions): CreatedPlatformResumeToken {
    const flow = normalizeRequiredValue(options.flow, 'flow');
    const resource = normalizeResource(options.resource);
    const subject = normalizeSubject(options.subject);
    const now = Date.now();
    const rawToken = createOpaqueToken();
    const ttlMs = parseTokenTTL(options.ttl ?? this.resumeTokenTTL, 'resume token TTL');

    this.cleanupExpiredResumeTokens();
    const stored = this.store.storeResumeToken({
      tokenId: `zrt_${crypto.randomUUID()}`,
      flow,
      tokenHash: hashToken(rawToken),
      resource,
      subject,
      expiresAt: now + ttlMs,
      createdAt: now,
      createdBy: options.createdBy ?? null,
      metadata: options.metadata ?? {},
    });

    emitPlatformCode(OBS_CODES.TOKENS_RESUME_CREATED, {
      userId: subject?.type === 'user' ? subject.id : undefined,
      metadata: {
        tokenId: stored.tokenId,
        flow,
        resourceType: resource.type,
        resourceId: resource.id,
        expiresAt: stored.expiresAt,
      },
    });

    return { rawToken, record: publicResumeRecord(stored) };
  }

  /**
   * Verify a resume token without consuming it.
   *
   * By default this touches `lastUsedAt`, which helps apps track continuation
   * activity without invalidating the token.
   */
  verifyResumeToken(
    rawToken: string,
    options: PlatformResumeTokenLookupOptions = {}
  ): PlatformResumeTokenRecord {
    const tokenHash = hashToken(rawToken);
    const stored = this.requireValidResumeTokenByHash(tokenHash, options);
    const touched = options.touch === false
      ? stored
      : this.store.touchResumeToken(stored.tokenId, tokenHash) ?? stored;

    emitPlatformCode(OBS_CODES.TOKENS_RESUME_VERIFIED, {
      userId: touched.subject?.type === 'user' ? touched.subject.id : undefined,
      metadata: {
        tokenId: touched.tokenId,
        flow: touched.flow,
        resourceType: touched.resource.type,
        resourceId: touched.resource.id,
      },
    });

    return publicResumeRecord(touched);
  }

  /**
   * Rotate a resume token while preserving its flow/resource identity.
   *
   * The previous token is revoked and the replacement raw token is returned
   * once. Use this after sensitive continuation milestones.
   */
  rotateResumeToken(
    rawToken: string,
    options: RotatePlatformResumeTokenOptions = {}
  ): CreatedPlatformResumeToken {
    const stored = this.requireValidResumeTokenByHash(hashToken(rawToken), options);
    const rawReplacement = createOpaqueToken();
    const now = Date.now();
    const ttlMs = parseTokenTTL(options.ttl ?? this.resumeTokenTTL, 'resume token TTL');
    const replacement = this.store.rotateResumeToken({
      previousTokenId: stored.tokenId,
      tokenId: `zrt_${crypto.randomUUID()}`,
      flow: stored.flow,
      tokenHash: hashToken(rawReplacement),
      resource: stored.resource,
      subject: stored.subject,
      expiresAt: now + ttlMs,
      createdAt: now,
      createdBy: options.createdBy ?? stored.createdBy,
      rotatedFrom: stored.tokenId,
      metadata: options.metadata ?? stored.metadata,
      now,
    });

    if (!replacement) {
      emitTokenRejected('resume', stored, 'revoked');
      throw new PlatformTokenError('Resume token has been revoked', 'TOKEN_REVOKED', 400);
    }

    emitPlatformCode(OBS_CODES.TOKENS_RESUME_ROTATED, {
      userId: replacement.subject?.type === 'user' ? replacement.subject.id : undefined,
      metadata: {
        tokenId: replacement.tokenId,
        rotatedFrom: stored.tokenId,
        flow: replacement.flow,
        resourceType: replacement.resource.type,
        resourceId: replacement.resource.id,
      },
    });

    return { rawToken: rawReplacement, record: publicResumeRecord(replacement) };
  }

  /** Revoke a resume token by raw token value. */
  revokeResumeToken(rawToken: string): boolean {
    const stored = this.store.getResumeTokenByHash(hashToken(rawToken));
    if (!stored) return false;
    const revoked = this.store.revokeResumeToken(stored.tokenId);
    if (revoked) {
      emitPlatformCode(OBS_CODES.TOKENS_RESUME_REVOKED, {
        userId: stored.subject?.type === 'user' ? stored.subject.id : undefined,
        metadata: {
          tokenId: stored.tokenId,
          flow: stored.flow,
          resourceType: stored.resource.type,
          resourceId: stored.resource.id,
        },
      });
    }
    return revoked;
  }

  /** Delete expired and revoked resume tokens. */
  cleanupExpiredResumeTokens(): number {
    return this.store.deleteExpiredResumeTokens();
  }

  private requireValidActionToken(
    rawToken: string,
    options: PlatformActionTokenLookupOptions
  ): StoredPlatformActionTokenRecord {
    const stored = this.store.getActionTokenByHash(hashToken(rawToken));
    if (!stored) {
      emitPlatformCode(OBS_CODES.TOKENS_ACTION_REJECTED, {
        metadata: { reason: 'missing' },
      });
      throw new PlatformTokenError('Action token is invalid', 'TOKEN_INVALID', 400);
    }

    if (options.purposes && !options.purposes.includes(stored.purpose)) {
      emitTokenRejected('action', stored, 'purpose');
      throw new PlatformTokenError('Action token is invalid', 'TOKEN_INVALID', 400);
    }

    if (options.scope !== undefined && stored.scope !== normalizeOptionalValue(options.scope)) {
      emitTokenRejected('action', stored, 'scope');
      throw new PlatformTokenError('Action token is invalid', 'TOKEN_INVALID', 400);
    }

    if (stored.consumedAt !== null) {
      emitTokenRejected('action', stored, 'consumed');
      throw new PlatformTokenError('Action token has already been used', 'TOKEN_CONSUMED', 400);
    }

    if (stored.expiresAt < Date.now()) {
      emitTokenRejected('action', stored, 'expired');
      throw new PlatformTokenError('Action token has expired', 'TOKEN_EXPIRED', 400);
    }

    return stored;
  }

  private requireValidResumeTokenByHash(
    tokenHash: string,
    options: PlatformResumeTokenLookupOptions
  ): StoredPlatformResumeTokenRecord {
    const stored = this.store.getResumeTokenByHash(tokenHash);
    if (!stored) {
      emitPlatformCode(OBS_CODES.TOKENS_RESUME_REJECTED, {
        metadata: { reason: 'missing' },
      });
      throw new PlatformTokenError('Resume token is invalid', 'TOKEN_INVALID', 400);
    }

    if (options.flow !== undefined && stored.flow !== normalizeRequiredValue(options.flow, 'flow')) {
      emitTokenRejected('resume', stored, 'flow');
      throw new PlatformTokenError('Resume token is invalid', 'TOKEN_INVALID', 400);
    }

    if (options.resource !== undefined && !sameResource(stored.resource, normalizeResource(options.resource))) {
      emitTokenRejected('resume', stored, 'resource');
      throw new PlatformTokenError('Resume token is invalid', 'TOKEN_INVALID', 400);
    }

    if (stored.revokedAt !== null) {
      emitTokenRejected('resume', stored, 'revoked');
      throw new PlatformTokenError('Resume token has been revoked', 'TOKEN_REVOKED', 400);
    }

    if (stored.expiresAt < Date.now()) {
      emitTokenRejected('resume', stored, 'expired');
      throw new PlatformTokenError('Resume token has expired', 'TOKEN_EXPIRED', 400);
    }

    return stored;
  }

  private assertActionCooldownOpen(params: {
    purpose: string;
    subject: PlatformTokenSubject | null;
    scope: string | null;
    cooldown: string;
    now: number;
  }): void {
    const cooldownMs = parseTokenTTL(params.cooldown, 'action token cooldown');
    if (cooldownMs <= 0) return;

    const recent = this.store.countRecentActionTokens({
      purpose: params.purpose,
      subject: params.subject,
      scope: params.scope,
      createdAfter: params.now - cooldownMs,
      now: params.now,
    });
    if (recent === 0) return;

    emitPlatformCode(OBS_CODES.TOKENS_ACTION_REJECTED, {
      userId: params.subject?.type === 'user' ? params.subject.id : undefined,
      metadata: {
        purpose: params.purpose,
        scope: params.scope ?? undefined,
        reason: 'cooldown',
      },
    });
    throw new PlatformTokenError('Action token request is cooling down', 'TOKEN_COOLDOWN', 429);
  }
}

function publicActionRecord(stored: StoredPlatformActionTokenRecord): PlatformActionTokenRecord {
  return {
    tokenId: stored.tokenId,
    purpose: stored.purpose,
    subject: stored.subject,
    scope: stored.scope,
    expiresAt: stored.expiresAt,
    consumedAt: stored.consumedAt,
    createdAt: stored.createdAt,
    createdBy: stored.createdBy,
    metadata: stored.metadata,
  };
}

function publicResumeRecord(stored: StoredPlatformResumeTokenRecord): PlatformResumeTokenRecord {
  return {
    tokenId: stored.tokenId,
    flow: stored.flow,
    resource: stored.resource,
    subject: stored.subject,
    expiresAt: stored.expiresAt,
    revokedAt: stored.revokedAt,
    lastUsedAt: stored.lastUsedAt,
    createdAt: stored.createdAt,
    createdBy: stored.createdBy,
    rotatedFrom: stored.rotatedFrom,
    metadata: stored.metadata,
  };
}

function normalizeRequiredValue(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new PlatformTokenError(`${label} is required`, 'TOKEN_INPUT_INVALID', 400);
  }
  return normalized;
}

function normalizeOptionalValue(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeSubject(subject: PlatformTokenSubject | null | undefined): PlatformTokenSubject | null {
  if (!subject) return null;
  return {
    type: normalizeRequiredValue(subject.type, 'subject.type'),
    id: normalizeRequiredValue(subject.id, 'subject.id'),
  };
}

function normalizeResource(resource: PlatformResumeResource): PlatformResumeResource {
  return {
    type: normalizeRequiredValue(resource.type, 'resource.type'),
    id: normalizeRequiredValue(resource.id, 'resource.id'),
  };
}

function sameResource(
  left: PlatformResumeResource,
  right: PlatformResumeResource
): boolean {
  return left.type === right.type && left.id === right.id;
}

function emitTokenRejected(
  family: 'action' | 'resume',
  record: StoredPlatformActionTokenRecord | StoredPlatformResumeTokenRecord,
  reason: string
): void {
  const isAction = family === 'action';
  emitPlatformCode(isAction ? OBS_CODES.TOKENS_ACTION_REJECTED : OBS_CODES.TOKENS_RESUME_REJECTED, {
    userId: record.subject?.type === 'user' ? record.subject.id : undefined,
    metadata: {
      tokenId: record.tokenId,
      reason,
      ...(isAction
        ? { purpose: (record as StoredPlatformActionTokenRecord).purpose }
        : {
            flow: (record as StoredPlatformResumeTokenRecord).flow,
            resourceType: (record as StoredPlatformResumeTokenRecord).resource.type,
            resourceId: (record as StoredPlatformResumeTokenRecord).resource.id,
          }),
    },
  });
}
