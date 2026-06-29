/**
 * token-types.ts
 *
 * Defines Zero's generic platform token contracts. This file owns data shapes
 * and config types only; it does not generate secrets, touch SQLite, or mount
 * Elysia plugins.
 */

/** Actor, user, draft, or app entity associated with a token. */
export interface PlatformTokenSubject {
  /** Subject namespace, for example "user", "public-intake", or "invite". */
  type: string;
  /** Stable subject identifier inside the namespace. */
  id: string;
}

/** Resource or draft that a resume token unlocks. */
export interface PlatformResumeResource {
  /** Resource namespace, for example "intake", "appointment-request", or "draft". */
  type: string;
  /** Stable resource identifier inside the namespace. */
  id: string;
}

/** Options shared by created platform tokens. */
export interface PlatformTokenCreateBase {
  /** Optional actor/user id that created this token. */
  createdBy?: string | null;
  /** Metadata persisted with the token. Never store raw secrets here. */
  metadata?: Record<string, unknown>;
}

/** Stored action-token record returned by the platform service. */
export interface PlatformActionTokenRecord {
  tokenId: string;
  purpose: string;
  subject: PlatformTokenSubject | null;
  scope: string | null;
  expiresAt: number;
  consumedAt: number | null;
  createdAt: number;
  createdBy: string | null;
  metadata: Record<string, unknown>;
}

/** Result returned when creating a consume-once action token. */
export interface CreatedPlatformActionToken {
  /** Raw opaque token. This is returned once and is never stored by Zero. */
  rawToken: string;
  /** Persisted token metadata without the raw token or token hash. */
  record: PlatformActionTokenRecord;
}

/** Action-token creation options. */
export interface CreatePlatformActionTokenOptions extends PlatformTokenCreateBase {
  /** Application-defined action purpose, for example "email.verify". */
  purpose: string;
  /** Optional subject the token is valid for. */
  subject?: PlatformTokenSubject | null;
  /** Optional app-defined namespace to prevent cross-flow token reuse. */
  scope?: string | null;
  /** Expiration duration. Supports `s`, `m`, `h`, and `d`. */
  ttl?: string;
  /**
   * Cooldown duration for active tokens with the same purpose/subject/scope.
   * Set to `false` to disable cooldown for this call.
   */
  cooldown?: string | false;
}

/** Action-token inspection/consume filters. */
export interface PlatformActionTokenLookupOptions {
  /** Optional allow-list of purposes. */
  purposes?: readonly string[];
  /** Optional exact scope required for the token. */
  scope?: string | null;
}

/** Stored resume-token record returned by the platform service. */
export interface PlatformResumeTokenRecord {
  tokenId: string;
  flow: string;
  resource: PlatformResumeResource;
  subject: PlatformTokenSubject | null;
  expiresAt: number;
  revokedAt: number | null;
  lastUsedAt: number | null;
  createdAt: number;
  createdBy: string | null;
  rotatedFrom: string | null;
  metadata: Record<string, unknown>;
}

/** Result returned when creating or rotating a resume token. */
export interface CreatedPlatformResumeToken {
  /** Raw opaque token. This is returned once and is never stored by Zero. */
  rawToken: string;
  /** Persisted resume-token metadata without the raw token or token hash. */
  record: PlatformResumeTokenRecord;
}

/** Resume-token creation options. */
export interface CreatePlatformResumeTokenOptions extends PlatformTokenCreateBase {
  /** Application-defined flow name, for example "clinic-intake". */
  flow: string;
  /** Resource or draft this token resumes. */
  resource: PlatformResumeResource;
  /** Optional subject the token belongs to. */
  subject?: PlatformTokenSubject | null;
  /** Expiration duration. Supports `s`, `m`, `h`, and `d`. */
  ttl?: string;
}

/** Resume-token verification filters. */
export interface PlatformResumeTokenLookupOptions {
  /** Optional exact flow required for the token. */
  flow?: string;
  /** Optional exact resource required for the token. */
  resource?: PlatformResumeResource;
  /** Update `lastUsedAt` on successful verification. Default: true. */
  touch?: boolean;
}

/** Resume-token rotation overrides. */
export interface RotatePlatformResumeTokenOptions extends PlatformResumeTokenLookupOptions {
  /** Optional replacement expiration duration. Defaults to the service resume TTL. */
  ttl?: string;
  /** Metadata replacement. Defaults to the previous token metadata. */
  metadata?: Record<string, unknown>;
  /** Optional actor/user id that rotated this token. */
  createdBy?: string | null;
}

/** Configuration accepted by createPlatformTokenService/plugin. */
export interface PlatformTokenServiceConfig {
  /** Default action token TTL. Default: '15m'. */
  actionTokenTTL?: string;
  /** Default resume token TTL. Default: '30d'. */
  resumeTokenTTL?: string;
  /** Default cooldown for active action tokens with the same purpose/scope/subject. */
  actionTokenCooldown?: string | false;
}

/** Structured error thrown by platform token operations. */
export class PlatformTokenError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'PlatformTokenError';
  }
}

export const PLATFORM_TOKEN_DEFAULTS = {
  actionTokenTTL: '15m',
  resumeTokenTTL: '30d',
  actionTokenCooldown: '5m',
} as const;
