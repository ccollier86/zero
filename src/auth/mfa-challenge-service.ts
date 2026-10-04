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
import {
  captureAuthAuditActor,
  captureAuthAuditRequestContext,
  type AuthAuditService,
} from './auth-audit-service';
import type { AuthAuditActor, AuthAuditRequestContext } from './auth-audit-types';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';
import {
  createEnrollmentRollbackReceipt,
  createLoginChallengeRollbackReceipt,
  MfaChallengeRollbackService,
  type MfaEnrollmentRollbackReceipt,
  type MfaLoginChallengeRollbackReceipt,
} from './mfa-challenge-rollback';

export type {
  MfaEnrollmentRollbackReceipt,
  MfaLoginChallengeRollbackReceipt,
} from './mfa-challenge-rollback';

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
  /** Trusted-server receipt used to clean up if transition-token signing fails. */
  rollbackReceipt?: MfaEnrollmentRollbackReceipt;
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
  /** Trusted-server receipt used to clean up if transition-token signing fails. */
  rollbackReceipt?: MfaLoginChallengeRollbackReceipt;
}

export type MfaRequirementSource = 'user' | 'global' | 'admin-role' | 'none';

type MfaPolicyUser = Pick<UserRecord, 'role' | 'mfaRequired'>
  & Partial<Pick<UserRecord, 'userId'>>;

/** Coordinates MFA setup/challenge behavior. */
export class MfaChallengeService {
  private readonly challengeTTLMs: number;
  private readonly challengeCooldownMs: number;
  private readonly rollbackService: MfaChallengeRollbackService;

  constructor(
    private readonly config: ResolvedAuthBehaviorConfig,
    private readonly methodStore: MfaMethodStore,
    private readonly challengeStore: MfaChallengeStore,
    private readonly accountEmail: AccountEmailService,
    private readonly auditService?: AuthAuditService,
    private readonly isAdministrationOperator: (userId: string) => boolean = () => false,
    private readonly emitCode: AuthPlatformCodeEmitter = emitPlatformCode,
    private readonly getAuthGeneration: (userId: string) => number = () => 0,
  ) {
    this.challengeTTLMs = parseDurationToMs(config.mfa.challengeTTL);
    this.challengeCooldownMs = parseDurationToMs(config.mfa.challengeCooldown);
    this.rollbackService = new MfaChallengeRollbackService(
      methodStore,
      challengeStore,
      emitCode,
    );
  }

  /** Return public-safe MFA methods for the current user. */
  listPublicMethods(userId: string): PublicMfaMethod[] {
    return this.methodStore.listPublicMethods(userId).map(toPublicMfaMethod);
  }

  /** Whether global/app policy requires this user to enroll MFA. */
  isMfaRequiredForUser(user: MfaPolicyUser): boolean {
    if (!this.config.mfa.enabled) return false;
    if (user.mfaRequired) return true;
    if (this.config.mfa.policy === 'required') return true;
    if (this.config.mfa.policy === 'admin-required') {
      return user.role === 'admin'
        || Boolean(user.userId && this.resolveAdministrationOperator(user.userId));
    }
    return false;
  }

  /** Explain which policy source currently requires MFA for a user. */
  getMfaRequirement(user: MfaPolicyUser): MfaRequirementSource {
    if (!this.config.mfa.enabled) return 'none';
    if (user.mfaRequired) return 'user';
    if (this.config.mfa.policy === 'required') return 'global';
    if (this.config.mfa.policy === 'admin-required'
      && (user.role === 'admin'
        || Boolean(user.userId && this.resolveAdministrationOperator(user.userId)))) {
      return 'admin-role';
    }
    return 'none';
  }

  private resolveAdministrationOperator(userId: string): boolean {
    return invokeSynchronousAuthCallback(
      () => this.isAdministrationOperator(userId),
      {
        component: 'mfa-challenge-service',
        invariant: 'administration-operator-resolver-async',
        message: '[auth] MFA administration operator resolution must be synchronous.',
        emitCode: this.emitCode,
      },
    );
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

  /**
   * Start MFA enrollment for email or authenticator.
   *
   * `expectedAuthGeneration` remains optional for source compatibility with
   * trusted server integrations that begin a ceremony without an earlier
   * credential proof. Official auth/profile routes always pass it. Profile
   * enrollment must also pass `admitAuthority`, which is rechecked at every
   * persistent commit and after asynchronous crypto/email work.
   */
  async startEnrollment(params: {
    user: UserRecord;
    methodType: AuthMfaMethodType;
    label?: string | null;
    expectedAuthGeneration?: number;
    admitAuthority?: () => boolean;
  }): Promise<MfaEnrollmentStart> {
    const user = captureMfaUser(params.user);
    const methodType = params.methodType;
    const label = params.label;
    const expectedAuthGeneration = params.expectedAuthGeneration;
    const admitAuthority = params.admitAuthority;
    this.assertMfaEnabled();
    this.assertMethodConfigured(methodType);
    this.assertAuthGeneration(user.userId, expectedAuthGeneration);
    this.assertAuthorityAdmission(admitAuthority);

    if (methodType === 'email') {
      const prepared = this.methodStore.transaction(() => {
        this.assertAuthGeneration(user.userId, expectedAuthGeneration);
        this.assertAuthorityAdmission(admitAuthority);
        const method = this.methodStore.createMethod({
          userId: user.userId,
          type: 'email',
          label: label ?? 'Email',
          metadata: { source: 'enrollment' },
        });
        const delivery = this.createEmailChallenge({
          userId: user.userId,
          methodId: method.methodId,
          purpose: 'setup',
        });
        return {
          method,
          delivery,
          receipt: createEnrollmentRollbackReceipt(method, delivery.challenge),
        };
      });

      try {
        await this.sendEmailChallenge({
          user,
          ...prepared.delivery,
          purpose: 'setup',
        });
      } catch (error) {
        let cleanupSucceeded = false;
        try {
          this.rollbackEnrollment(prepared.receipt);
          cleanupSucceeded = true;
        } finally {
          this.emitCode(OBS_CODES.AUTH_MFA_EMAIL_DELIVERY_FAILED, {
            userId: user.userId,
            metadata: { source: 'setup', cleanupSucceeded },
          });
        }
        throw error;
      }

      try {
        this.assertAuthGeneration(user.userId, expectedAuthGeneration);
        this.assertAuthorityAdmission(admitAuthority);
      } catch (error) {
        this.rollbackEnrollment(prepared.receipt);
        throw error;
      }

      return {
        method: toPublicMfaMethod(prepared.method),
        challenge: toPublicMfaChallenge(prepared.delivery.challenge),
        rollbackReceipt: prepared.receipt,
      };
    }

    const encryptionKey = this.requireTotpEncryptionKey();
    const secret = generateTotpSecret();
    const issuer = this.config.mfa.totp.issuer ?? 'Zero';
    const accountName = user.email;
    const secretCiphertext = await encryptMfaSecret(secret, encryptionKey);
    const method = this.methodStore.transaction(() => {
      this.assertAuthGeneration(user.userId, expectedAuthGeneration);
      this.assertAuthorityAdmission(admitAuthority);
      return this.methodStore.createMethod({
        userId: user.userId,
        type: 'totp',
        label: label ?? 'Authenticator',
        secretCiphertext,
        metadata: { source: 'enrollment' },
      });
    });
    const rollbackReceipt = createEnrollmentRollbackReceipt(method, null);

    return {
      method: toPublicMfaMethod(method),
      totp: {
        secret,
        otpauthUrl: createTotpUri({ issuer, accountName, secret }),
        issuer,
        accountName,
      },
      rollbackReceipt,
    };
  }

  /**
   * Verify a pending MFA enrollment method.
   *
   * Generation is optional only for legacy trusted-server callers. Official
   * ceremony routes pass the exact generation; profile activation additionally
   * supplies the exact originating-session admission callback.
   */
  async verifyEnrollment(params: {
    user: UserRecord;
    methodId: string;
    code: string;
    challengeId?: string;
    expectedAuthGeneration?: number;
    admitAuthority?: () => boolean;
    auditActor?: AuthAuditActor;
    auditRequest?: AuthAuditRequestContext;
  }): Promise<PublicMfaMethod> {
    const userId = params.user.userId;
    const methodId = params.methodId;
    const code = params.code;
    const challengeId = params.challengeId;
    const expectedAuthGeneration = params.expectedAuthGeneration;
    const admitAuthority = params.admitAuthority;
    const auditActor = captureAuthAuditActor(params.auditActor) ?? Object.freeze({
      userId,
      provenance: 'authenticated-request' as const,
    });
    const auditRequest = captureAuthAuditRequestContext(params.auditRequest);
    this.assertMfaEnabled();
    const method = this.requireUserMethod(userId, methodId);
    if (method.status !== 'pending') {
      throw new AuthError('MFA method is not pending verification', 'MFA_METHOD_NOT_PENDING', 400);
    }

    if (method.type !== 'email') {
      const encryptionKey = this.requireTotpEncryptionKey();
      if (!method.secretCiphertext) {
        throw new AuthError('MFA method has no secret', 'MFA_METHOD_INVALID', 500);
      }
      const secret = await decryptMfaSecret(method.secretCiphertext, encryptionKey);
      if (!verifyTotpCode({ secret, code })) {
        throw new AuthError('Invalid MFA code', 'MFA_CODE_INVALID', 401);
      }
    }

    return this.methodStore.transaction(() => {
      this.assertAuthGeneration(userId, expectedAuthGeneration);
      this.assertAuthorityAdmission(admitAuthority);
      const liveMethod = this.requireUserMethod(userId, methodId);
      if (liveMethod.status !== 'pending') {
        throw new AuthError('MFA method is not pending verification', 'MFA_METHOD_NOT_PENDING', 400);
      }
      if (liveMethod.type !== method.type) {
        throw new AuthError('MFA method changed during verification', 'MFA_METHOD_INVALID', 500);
      }

      if (liveMethod.type === 'email') {
        if (!challengeId) {
          throw new AuthError('MFA challenge is required', 'MFA_CHALLENGE_REQUIRED', 400);
        }
        this.verifyEmailChallenge({
          userId,
          methodId: liveMethod.methodId,
          challengeId,
          code,
        });
      }

      const activated = this.methodStore.activateMethod(liveMethod.methodId, {
        singleActive: !this.config.mfa.allowMultipleMethods,
        makePrimary: true,
      });
      if (!activated) {
        const current = this.methodStore.getMethod(methodId);
        if (current?.userId === userId) {
          throw new AuthError('MFA method is not pending verification', 'MFA_METHOD_NOT_PENDING', 400);
        }
        throw new AuthError('MFA method not found', 'MFA_METHOD_NOT_FOUND', 404);
      }
      this.auditService?.append({
        action: 'account.mfa-enrolled',
        outcome: 'succeeded',
        scope: { kind: 'application' },
        actor: auditActor,
        request: auditRequest,
        target: { type: 'mfa-method', id: activated.methodId },
        metadata: { type: activated.type },
      });
      return toPublicMfaMethod(activated);
    });
  }

  /**
   * Start login MFA challenge for an active method. Official auth ceremonies
   * always pass the exact password-proof generation. The optional fallback is
   * retained only for compatible trusted-server callers.
   */
  async startLoginChallenge(params: {
    user: UserRecord;
    method: AuthMfaMethodRecord;
    expectedAuthGeneration?: number;
  }): Promise<MfaLoginChallengeStart> {
    const user = captureMfaUser(params.user);
    const methodId = params.method.methodId;
    const methodType = params.method.type;
    const methodStatus = params.method.status;
    const expectedAuthGeneration = params.expectedAuthGeneration;
    const publicMethod = toPublicMfaMethod(params.method);
    this.assertMfaEnabled();
    if (methodStatus !== 'active') {
      throw new AuthError('MFA method is not active', 'MFA_METHOD_NOT_ACTIVE', 400);
    }
    this.assertAuthGeneration(user.userId, expectedAuthGeneration);

    if (methodType === 'email') {
      const delivery = this.methodStore.transaction(() => {
        this.assertAuthGeneration(user.userId, expectedAuthGeneration);
        return this.createEmailChallenge({
          userId: user.userId,
          methodId,
          purpose: 'login',
        });
      });
      const rollbackReceipt = createLoginChallengeRollbackReceipt(
        user.userId,
        methodId,
        delivery.challenge,
      );

      try {
        await this.sendEmailChallenge({ user, ...delivery, purpose: 'login' });
      } catch (error) {
        let cleanupSucceeded = false;
        try {
          this.rollbackLoginChallenge(rollbackReceipt);
          cleanupSucceeded = true;
        } finally {
          this.emitCode(OBS_CODES.AUTH_MFA_EMAIL_DELIVERY_FAILED, {
            userId: user.userId,
            metadata: { source: 'login', cleanupSucceeded },
          });
        }
        throw error;
      }

      try {
        this.assertAuthGeneration(user.userId, expectedAuthGeneration);
      } catch (error) {
        this.rollbackLoginChallenge(rollbackReceipt);
        throw error;
      }
      return {
        method: publicMethod,
        challenge: toPublicMfaChallenge(delivery.challenge),
        rollbackReceipt,
      };
    }

    return {
      method: publicMethod,
      challenge: {
        challengeId: '',
        methodType: 'totp',
        expiresAt: Date.now() + this.challengeTTLMs,
        delivery: 'authenticator',
      },
    };
  }

  /**
   * Verify an active method login challenge. Official auth ceremonies always
   * pass their exact generation; omission is a legacy trusted-server fallback.
   */
  async verifyLoginChallenge(params: {
    user: UserRecord;
    methodId: string;
    code: string;
    challengeId?: string;
    expectedAuthGeneration?: number;
  }): Promise<PublicMfaMethod> {
    const userId = params.user.userId;
    const methodId = params.methodId;
    const code = params.code;
    const challengeId = params.challengeId;
    const expectedAuthGeneration = params.expectedAuthGeneration;
    this.assertMfaEnabled();
    const method = this.requireUserMethod(userId, methodId);
    if (method.status !== 'active') {
      throw new AuthError('MFA method is not active', 'MFA_METHOD_NOT_ACTIVE', 400);
    }

    if (method.type !== 'email') {
      const encryptionKey = this.requireTotpEncryptionKey();
      if (!method.secretCiphertext) {
        throw new AuthError('MFA method has no secret', 'MFA_METHOD_INVALID', 500);
      }
      const secret = await decryptMfaSecret(method.secretCiphertext, encryptionKey);
      if (!verifyTotpCode({ secret, code })) {
        throw new AuthError('Invalid MFA code', 'MFA_CODE_INVALID', 401);
      }
    }

    return this.methodStore.transaction(() => {
      this.assertAuthGeneration(userId, expectedAuthGeneration);
      const liveMethod = this.requireUserMethod(userId, methodId);
      if (liveMethod.status !== 'active') {
        throw new AuthError('MFA method is not active', 'MFA_METHOD_NOT_ACTIVE', 400);
      }
      if (liveMethod.type !== method.type) {
        throw new AuthError('MFA method changed during verification', 'MFA_METHOD_INVALID', 500);
      }

      if (liveMethod.type === 'email') {
        if (!challengeId) {
          throw new AuthError('MFA challenge is required', 'MFA_CHALLENGE_REQUIRED', 400);
        }
        this.verifyEmailChallenge({
          userId,
          methodId: liveMethod.methodId,
          challengeId,
          code,
        });
      }

      this.methodStore.recordUse(liveMethod.methodId);
      const usedMethod = this.methodStore.getMethod(liveMethod.methodId);
      if (!usedMethod || usedMethod.userId !== userId || usedMethod.status !== 'active') {
        throw new AuthError('MFA method is not active', 'MFA_METHOD_NOT_ACTIVE', 400);
      }
      return toPublicMfaMethod(usedMethod);
    });
  }

  /**
   * Idempotently disable exactly the pending enrollment represented by a
   * service-issued receipt. A mismatched/reused receipt fails closed instead
   * of touching a newer or already-activated method.
   */
  rollbackEnrollment(receipt: MfaEnrollmentRollbackReceipt): {
    methodDisabled: boolean;
    challengeConsumed: boolean;
  } {
    return this.rollbackService.rollbackEnrollment(receipt);
  }

  /** Consume exactly one unfinished login challenge after token issuance fails. */
  rollbackLoginChallenge(receipt: MfaLoginChallengeRollbackReceipt): {
    challengeConsumed: boolean;
  } {
    return this.rollbackService.rollbackLoginChallenge(receipt);
  }

  /** Fence persistent MFA state to the ceremony generation that authorized it. */
  private assertAuthGeneration(
    userId: string,
    expectedAuthGeneration: number | undefined,
  ): void {
    if (expectedAuthGeneration !== undefined
      && this.getAuthGeneration(userId) !== expectedAuthGeneration) {
      throw new AuthError(
        'Authentication state changed; sign in again',
        'AUTH_STATE_CHANGED',
        409,
      );
    }
  }

  /** Fence profile mutations to the exact session authority that began them. */
  private assertAuthorityAdmission(admitAuthority: (() => boolean) | undefined): void {
    if (!admitAuthority) return;
    if (!invokeSynchronousAuthCallback(admitAuthority, {
      component: 'mfa-challenge-service',
      invariant: 'profile-authority-admission-async',
      message: '[auth] MFA profile authority admission must be synchronous.',
      emitCode: this.emitCode,
    })) throw authenticationStateChanged();
  }

  private createEmailChallenge(params: {
    userId: string;
    methodId: string;
    purpose: 'setup' | 'login';
  }): { challenge: AuthMfaChallengeRecord; code: string } {
    const userId = params.userId;
    const methodId = params.methodId;
    const purpose = params.purpose;
    this.assertEmailMethodReady(userId);

    const code = generateEmailOtpCode();
    const expiresAt = Date.now() + this.challengeTTLMs;
    const challenge = this.challengeStore.createChallenge({
      userId,
      methodId,
      methodType: 'email',
      codeHash: hashOtpCode(code),
      expiresAt,
      maxAttempts: this.config.mfa.maxAttempts,
      metadata: { purpose },
    });

    return { challenge, code };
  }

  private sendEmailChallenge(params: {
    user: UserRecord;
    challenge: AuthMfaChallengeRecord;
    code: string;
    purpose: 'setup' | 'login';
  }): Promise<void> {
    return this.accountEmail.sendEmailOtp({
      user: params.user,
      code: params.code,
      expiresAt: params.challenge.expiresAt,
      purpose: params.purpose,
    });
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

function authenticationStateChanged(): AuthError {
  return new AuthError(
    'Authentication state changed; sign in again',
    'AUTH_STATE_CHANGED',
    409,
  );
}

/** Detach the identity projection passed into an MFA operation before it yields. */
function captureMfaUser(user: UserRecord): UserRecord {
  return Object.freeze({
    userId: user.userId,
    username: user.username,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    status: user.status,
    passwordChangeRequired: user.passwordChangeRequired,
    emailVerifiedAt: user.emailVerifiedAt,
    emailVerificationRequired: user.emailVerificationRequired,
    mfaRequired: user.mfaRequired,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    properties: Object.freeze({ ...user.properties }),
  });
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
