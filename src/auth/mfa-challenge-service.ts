/**
 * mfa-challenge-service.ts
 *
 * Owns MFA enrollment and challenge behavior. It coordinates method storage,
 * OTP challenge persistence, TOTP verification, and email OTP delivery without
 * registering HTTP routes or issuing full auth sessions.
 */

import type { AccountEmailService } from './account-email-service';
import type { MfaChallengeStore } from './mfa-challenge-store';
import type { MfaMethodStore } from './mfa-method-store';
import {
  createTotpUri,
  generateTotpSecret,
  verifyTotpCode,
} from './mfa-totp';
import { decryptMfaSecret, encryptMfaSecret } from './mfa-secret-crypto';
import type {
  AuthMfaChallengeRecord,
  AuthMfaMethodRecord,
  AuthMfaMethodType,
  ResolvedAuthBehaviorConfig,
  UserRecord,
} from './types';
import { AuthError } from './types';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';

/** Public MFA method metadata returned by account routes. */
export interface PublicMfaMethod {
  methodId: string;
  type: AuthMfaMethodType;
  label: string | null;
  status: AuthMfaMethodRecord['status'];
  isPrimary: boolean;
  createdAt: number;
  verifiedAt: number | null;
  lastUsedAt: number | null;
}

/** MFA enrollment setup response before controller transition-token wrapping. */
export interface MfaEnrollmentStart {
  method: PublicMfaMethod;
  challenge?: PublicMfaChallenge;
  totp?: {
    secret: string;
    otpauthUrl: string;
    issuer: string;
    accountName: string;
  };
}

/** Public challenge metadata safe for clients. */
export interface PublicMfaChallenge {
  challengeId: string;
  methodType: AuthMfaMethodType;
  expiresAt: number;
  delivery: 'email' | 'authenticator';
}

/** MFA login challenge response before controller transition-token wrapping. */
export interface MfaLoginChallengeStart {
  method: PublicMfaMethod;
  challenge?: PublicMfaChallenge;
}

export type MfaRequirementSource = 'user' | 'global' | 'admin-role' | 'none';

/** Coordinates MFA setup/challenge behavior. */
export class MfaChallengeService {
  private readonly challengeTTLMs: number;
  private readonly challengeCooldownMs: number;

  constructor(
    private readonly config: ResolvedAuthBehaviorConfig,
    private readonly methodStore: MfaMethodStore,
    private readonly challengeStore: MfaChallengeStore,
    private readonly accountEmail: AccountEmailService
  ) {
    this.challengeTTLMs = parseDurationToMs(config.mfa.challengeTTL);
    this.challengeCooldownMs = parseDurationToMs(config.mfa.challengeCooldown);
  }

  /** Return public-safe MFA methods for the current user. */
  listPublicMethods(userId: string): PublicMfaMethod[] {
    return this.methodStore.listPublicMethods(userId).map(toPublicMfaMethod);
  }

  /** Whether global/app policy requires this user to enroll MFA. */
  isMfaRequiredForUser(user: Pick<UserRecord, 'role' | 'mfaRequired'>): boolean {
    if (!this.config.mfa.enabled) return false;
    if (user.mfaRequired) return true;
    if (this.config.mfa.policy === 'required') return true;
    if (this.config.mfa.policy === 'admin-required') return user.role === 'admin';
    return false;
  }

  /** Explain which policy source currently requires MFA for a user. */
  getMfaRequirement(user: Pick<UserRecord, 'role' | 'mfaRequired'>): MfaRequirementSource {
    if (!this.config.mfa.enabled) return 'none';
    if (user.mfaRequired) return 'user';
    if (this.config.mfa.policy === 'required') return 'global';
    if (this.config.mfa.policy === 'admin-required' && user.role === 'admin') return 'admin-role';
    return 'none';
  }

  /** Delete enrolled methods and invalidate unfinished challenges for an admin reset. */
  resetUserMfa(userId: string): {
    deletedMethods: number;
    invalidatedChallenges: number;
  } {
    const invalidatedChallenges = this.challengeStore.invalidateUserChallenges(userId);
    const deletedMethods = this.methodStore.deleteUserMethods(userId);
    return { deletedMethods, invalidatedChallenges };
  }

  /** Return the active preferred method if this user should be challenged. */
  getActiveChallengeMethod(userId: string): AuthMfaMethodRecord | null {
    if (!this.config.mfa.enabled) return null;
    return this.methodStore.getActivePreferredMethod(userId);
  }

  /** Start MFA enrollment for email or authenticator. */
  async startEnrollment(params: {
    user: UserRecord;
    methodType: AuthMfaMethodType;
    label?: string | null;
  }): Promise<MfaEnrollmentStart> {
    this.assertMfaEnabled();
    this.assertMethodConfigured(params.methodType);

    if (params.methodType === 'email') {
      const method = this.methodStore.createMethod({
        userId: params.user.userId,
        type: 'email',
        label: params.label ?? 'Email',
        metadata: { source: 'enrollment' },
      });
      let challenge: AuthMfaChallengeRecord;
      try {
        challenge = await this.createAndSendEmailChallenge({
          user: params.user,
          method,
          purpose: 'setup',
        });
      } catch (error) {
        this.methodStore.disableMethod(method.methodId);
        throw error;
      }

      return {
        method: toPublicMfaMethod(method),
        challenge: toPublicMfaChallenge(challenge),
      };
    }

    const encryptionKey = this.requireTotpEncryptionKey();
    const secret = generateTotpSecret();
    const issuer = this.config.mfa.totp.issuer ?? 'Zero';
    const accountName = params.user.email;
    const method = this.methodStore.createMethod({
      userId: params.user.userId,
      type: 'totp',
      label: params.label ?? 'Authenticator',
      secretCiphertext: await encryptMfaSecret(secret, encryptionKey),
      metadata: { source: 'enrollment' },
    });

    return {
      method: toPublicMfaMethod(method),
      totp: {
        secret,
        otpauthUrl: createTotpUri({ issuer, accountName, secret }),
        issuer,
        accountName,
      },
    };
  }

  /** Verify a pending MFA enrollment method. */
  async verifyEnrollment(params: {
    user: UserRecord;
    methodId: string;
    code: string;
    challengeId?: string;
  }): Promise<PublicMfaMethod> {
    this.assertMfaEnabled();
    const method = this.requireUserMethod(params.user.userId, params.methodId);
    if (method.status !== 'pending') {
      throw new AuthError('MFA method is not pending verification', 'MFA_METHOD_NOT_PENDING', 400);
    }

    if (method.type === 'email') {
      if (!params.challengeId) {
        throw new AuthError('MFA challenge is required', 'MFA_CHALLENGE_REQUIRED', 400);
      }
      this.verifyEmailChallenge({
        userId: params.user.userId,
        methodId: method.methodId,
        challengeId: params.challengeId,
        code: params.code,
      });
    } else {
      const encryptionKey = this.requireTotpEncryptionKey();
      if (!method.secretCiphertext) {
        throw new AuthError('MFA method has no secret', 'MFA_METHOD_INVALID', 500);
      }
      const secret = await decryptMfaSecret(method.secretCiphertext, encryptionKey);
      if (!verifyTotpCode({ secret, code: params.code })) {
        throw new AuthError('Invalid MFA code', 'MFA_CODE_INVALID', 401);
      }
    }

    const activated = this.methodStore.activateMethod(method.methodId, {
      singleActive: !this.config.mfa.allowMultipleMethods,
      makePrimary: true,
    });
    if (!activated) {
      throw new AuthError('MFA method not found', 'MFA_METHOD_NOT_FOUND', 404);
    }

    return toPublicMfaMethod(activated);
  }

  /** Start login MFA challenge for an active method. */
  async startLoginChallenge(params: {
    user: UserRecord;
    method: AuthMfaMethodRecord;
  }): Promise<MfaLoginChallengeStart> {
    this.assertMfaEnabled();
    if (params.method.status !== 'active') {
      throw new AuthError('MFA method is not active', 'MFA_METHOD_NOT_ACTIVE', 400);
    }

    if (params.method.type === 'email') {
      const challenge = await this.createAndSendEmailChallenge({
        user: params.user,
        method: params.method,
        purpose: 'login',
      });
      return {
        method: toPublicMfaMethod(params.method),
        challenge: toPublicMfaChallenge(challenge),
      };
    }

    return {
      method: toPublicMfaMethod(params.method),
      challenge: {
        challengeId: '',
        methodType: 'totp',
        expiresAt: Date.now() + this.challengeTTLMs,
        delivery: 'authenticator',
      },
    };
  }

  /** Verify an active method login challenge. */
  async verifyLoginChallenge(params: {
    user: UserRecord;
    methodId: string;
    code: string;
    challengeId?: string;
  }): Promise<PublicMfaMethod> {
    this.assertMfaEnabled();
    const method = this.requireUserMethod(params.user.userId, params.methodId);
    if (method.status !== 'active') {
      throw new AuthError('MFA method is not active', 'MFA_METHOD_NOT_ACTIVE', 400);
    }

    if (method.type === 'email') {
      if (!params.challengeId) {
        throw new AuthError('MFA challenge is required', 'MFA_CHALLENGE_REQUIRED', 400);
      }
      this.verifyEmailChallenge({
        userId: params.user.userId,
        methodId: method.methodId,
        challengeId: params.challengeId,
        code: params.code,
      });
    } else {
      const encryptionKey = this.requireTotpEncryptionKey();
      if (!method.secretCiphertext) {
        throw new AuthError('MFA method has no secret', 'MFA_METHOD_INVALID', 500);
      }
      const secret = await decryptMfaSecret(method.secretCiphertext, encryptionKey);
      if (!verifyTotpCode({ secret, code: params.code })) {
        throw new AuthError('Invalid MFA code', 'MFA_CODE_INVALID', 401);
      }
    }

    this.methodStore.recordUse(method.methodId);
    return toPublicMfaMethod(this.methodStore.getMethod(method.methodId)!);
  }

  private async createAndSendEmailChallenge(params: {
    user: UserRecord;
    method: AuthMfaMethodRecord;
    purpose: 'setup' | 'login';
  }): Promise<AuthMfaChallengeRecord> {
    this.assertEmailMethodReady(params.user.userId);

    const code = generateEmailOtpCode();
    const expiresAt = Date.now() + this.challengeTTLMs;
    const challenge = this.challengeStore.createChallenge({
      userId: params.user.userId,
      methodId: params.method.methodId,
      methodType: 'email',
      codeHash: hashOtpCode(code),
      expiresAt,
      maxAttempts: this.config.mfa.maxAttempts,
      metadata: { purpose: params.purpose },
    });

    try {
      await this.accountEmail.sendEmailOtp({
        user: params.user,
        code,
        expiresAt,
        purpose: params.purpose,
      });
    } catch (error) {
      const cleanupSucceeded = this.challengeStore.consumeChallenge(challenge.challengeId);
      emitPlatformCode(OBS_CODES.AUTH_MFA_EMAIL_DELIVERY_FAILED, {
        userId: params.user.userId,
        metadata: { source: params.purpose, cleanupSucceeded },
      });
      throw error;
    }

    return challenge;
  }

  private verifyEmailChallenge(params: {
    userId: string;
    methodId: string;
    challengeId: string;
    code: string;
  }): void {
    const challenge = this.challengeStore.getChallenge(params.challengeId);
    if (!challenge || challenge.userId !== params.userId || challenge.methodId !== params.methodId) {
      throw new AuthError('Invalid MFA challenge', 'MFA_CHALLENGE_INVALID', 401);
    }
    if (challenge.consumedAt !== null) {
      throw new AuthError('MFA challenge already used', 'MFA_CHALLENGE_CONSUMED', 400);
    }
    if (challenge.expiresAt < Date.now()) {
      throw new AuthError('MFA challenge expired', 'MFA_CHALLENGE_EXPIRED', 400);
    }
    if (challenge.attempts >= challenge.maxAttempts) {
      throw new AuthError('Too many MFA attempts', 'MFA_CHALLENGE_LOCKED', 429);
    }
    if (!challenge.codeHash || !constantTimeEqual(challenge.codeHash, hashOtpCode(params.code))) {
      this.challengeStore.incrementAttempts(challenge.challengeId);
      throw new AuthError('Invalid MFA code', 'MFA_CODE_INVALID', 401);
    }

    this.challengeStore.consumeChallenge(challenge.challengeId);
  }

  private assertMfaEnabled(): void {
    if (!this.config.mfa.enabled) {
      throw new AuthError('MFA is disabled', 'MFA_DISABLED', 403);
    }
  }

  private assertMethodConfigured(methodType: AuthMfaMethodType): void {
    if (!this.config.mfa.methods.includes(methodType)) {
      throw new AuthError('MFA method is not configured', 'MFA_METHOD_DISABLED', 403);
    }
  }

  private assertEmailMethodReady(userId: string): void {
    const now = Date.now();
    const recent = this.challengeStore.countRecentActive({
      userId,
      methodType: 'email',
      now,
      since: now - this.challengeCooldownMs,
    });
    if (recent > 0) {
      throw new AuthError('MFA email challenge cooldown is active', 'MFA_CHALLENGE_COOLDOWN', 429);
    }
  }

  private requireTotpEncryptionKey(): string {
    const encryptionKey = this.config.mfa.totp.encryptionKey;
    if (!encryptionKey) {
      throw new AuthError('TOTP is not configured', 'MFA_TOTP_NOT_CONFIGURED', 503);
    }
    return encryptionKey;
  }

  private requireUserMethod(userId: string, methodId: string): AuthMfaMethodRecord {
    const method = this.methodStore.getMethod(methodId);
    if (!method || method.userId !== userId) {
      throw new AuthError('MFA method not found', 'MFA_METHOD_NOT_FOUND', 404);
    }
    return method;
  }
}

function toPublicMfaMethod(method: AuthMfaMethodRecord): PublicMfaMethod {
  return {
    methodId: method.methodId,
    type: method.type,
    label: method.label,
    status: method.status,
    isPrimary: method.isPrimary,
    createdAt: method.createdAt,
    verifiedAt: method.verifiedAt,
    lastUsedAt: method.lastUsedAt,
  };
}

function toPublicMfaChallenge(challenge: AuthMfaChallengeRecord): PublicMfaChallenge {
  return {
    challengeId: challenge.challengeId,
    methodType: challenge.methodType,
    expiresAt: challenge.expiresAt,
    delivery: challenge.methodType === 'email' ? 'email' : 'authenticator',
  };
}

function generateEmailOtpCode(): string {
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  return String(bytes[0] % 1_000_000).padStart(6, '0');
}

function hashOtpCode(code: string): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(normalizeCode(code));
  return hasher.digest('hex');
}

function normalizeCode(code: string): string {
  return code.replaceAll(/\s|-/g, '');
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

function parseDurationToMs(value: string): number {
  const match = value.match(/^(\d+)(s|m|h|d)$/);
  if (!match) throw new Error(`Invalid duration: ${value}`);
  const amount = Number(match[1]);
  if (match[2] === 's') return amount * 1_000;
  if (match[2] === 'm') return amount * 60_000;
  if (match[2] === 'h') return amount * 3_600_000;
  return amount * 86_400_000;
}
