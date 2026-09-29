/** Exact, idempotent cleanup for MFA state created before token issuance. */

import type { AuthPlatformCodeEmitter } from './auth-observability';
import { createAuthStateInvariantError } from './auth-observability';
import type { MfaChallengeStore } from './mfa-challenge-store';
import type { MfaMethodStore } from './mfa-method-store';
import type { AuthMfaChallengeRecord, AuthMfaMethodRecord } from './types';
import { AuthError } from './types';

/** Exact identity of one still-pending enrollment created by the MFA service. */
export interface MfaEnrollmentRollbackReceipt {
  readonly kind: 'enrollment';
  readonly userId: string;
  readonly methodId: string;
  readonly methodCreatedAt: number;
  readonly challengeId: string | null;
  readonly challengeCreatedAt: number | null;
}

/** Exact identity of one login challenge created by the MFA service. */
export interface MfaLoginChallengeRollbackReceipt {
  readonly kind: 'login-challenge';
  readonly userId: string;
  readonly methodId: string;
  readonly challengeId: string;
  readonly challengeCreatedAt: number;
}

/** Build an immutable cleanup receipt from the rows created in one transaction. */
export function createEnrollmentRollbackReceipt(
  method: AuthMfaMethodRecord,
  challenge: AuthMfaChallengeRecord | null,
): MfaEnrollmentRollbackReceipt {
  return Object.freeze({
    kind: 'enrollment',
    userId: method.userId,
    methodId: method.methodId,
    methodCreatedAt: method.createdAt,
    challengeId: challenge?.challengeId ?? null,
    challengeCreatedAt: challenge?.createdAt ?? null,
  });
}

/** Build an immutable cleanup receipt for one persisted login OTP challenge. */
export function createLoginChallengeRollbackReceipt(
  userId: string,
  methodId: string,
  challenge: AuthMfaChallengeRecord,
): MfaLoginChallengeRollbackReceipt {
  return Object.freeze({
    kind: 'login-challenge',
    userId,
    methodId,
    challengeId: challenge.challengeId,
    challengeCreatedAt: challenge.createdAt,
  });
}

/** Owns receipt validation and exact pending-state compensation. */
export class MfaChallengeRollbackService {
  constructor(
    private readonly methodStore: MfaMethodStore,
    private readonly challengeStore: MfaChallengeStore,
    private readonly emitCode: AuthPlatformCodeEmitter,
  ) {}

  rollbackEnrollment(receipt: MfaEnrollmentRollbackReceipt): {
    methodDisabled: boolean;
    challengeConsumed: boolean;
  } {
    const captured = snapshotEnrollmentRollbackReceipt(receipt);
    if (!captured) throw this.invariant('enrollment-receipt-invalid');

    return this.methodStore.transaction(() => {
      const method = this.methodStore.getMethod(captured.methodId);
      const challenge = captured.challengeId
        ? this.challengeStore.getChallenge(captured.challengeId)
        : null;

      if (method && (method.userId !== captured.userId
        || method.createdAt !== captured.methodCreatedAt
        || (method.status !== 'pending' && method.status !== 'disabled'))) {
        throw this.invariant('enrollment-method-receipt-mismatch');
      }
      if (challenge && (challenge.userId !== captured.userId
        || challenge.methodId !== captured.methodId
        || challenge.createdAt !== captured.challengeCreatedAt)) {
        throw this.invariant('enrollment-challenge-receipt-mismatch');
      }

      let challengeConsumed = false;
      if (challenge?.consumedAt === null) {
        challengeConsumed = this.challengeStore.consumeChallenge(challenge.challengeId);
        if (!challengeConsumed) {
          throw this.invariant('enrollment-challenge-cleanup-failed');
        }
      }

      let methodDisabled = false;
      if (method?.status === 'pending') {
        methodDisabled = this.methodStore.disableMethod(method.methodId);
        if (!methodDisabled) {
          throw this.invariant('enrollment-method-cleanup-failed');
        }
      }

      return { methodDisabled, challengeConsumed };
    });
  }

  rollbackLoginChallenge(receipt: MfaLoginChallengeRollbackReceipt): {
    challengeConsumed: boolean;
  } {
    const captured = snapshotLoginChallengeRollbackReceipt(receipt);
    if (!captured) throw this.invariant('login-challenge-receipt-invalid');

    return this.methodStore.transaction(() => {
      const challenge = this.challengeStore.getChallenge(captured.challengeId);
      if (!challenge) return { challengeConsumed: false };
      if (challenge.userId !== captured.userId
        || challenge.methodId !== captured.methodId
        || challenge.createdAt !== captured.challengeCreatedAt) {
        throw this.invariant('login-challenge-receipt-mismatch');
      }
      if (challenge.consumedAt !== null) return { challengeConsumed: false };
      if (!this.challengeStore.consumeChallenge(challenge.challengeId)) {
        throw this.invariant('login-challenge-cleanup-failed');
      }
      return { challengeConsumed: true };
    });
  }

  private invariant(invariant: string): AuthError {
    return createAuthStateInvariantError(this.emitCode, {
      component: 'mfa-challenge-service',
      invariant,
      message: '[auth] MFA rollback receipt no longer matches pending state.',
    });
  }
}

function snapshotEnrollmentRollbackReceipt(
  receipt: MfaEnrollmentRollbackReceipt,
): MfaEnrollmentRollbackReceipt | null {
  if (receipt.kind !== 'enrollment'
    || !receipt.userId
    || !receipt.methodId
    || !Number.isSafeInteger(receipt.methodCreatedAt)
    || receipt.methodCreatedAt < 0
    || (receipt.challengeId === null) !== (receipt.challengeCreatedAt === null)
    || (receipt.challengeId !== null && !receipt.challengeId)
    || (receipt.challengeCreatedAt !== null
      && (!Number.isSafeInteger(receipt.challengeCreatedAt)
        || receipt.challengeCreatedAt < 0))) return null;
  return Object.freeze({ ...receipt });
}

function snapshotLoginChallengeRollbackReceipt(
  receipt: MfaLoginChallengeRollbackReceipt,
): MfaLoginChallengeRollbackReceipt | null {
  if (receipt.kind !== 'login-challenge'
    || !receipt.userId
    || !receipt.methodId
    || !receipt.challengeId
    || !Number.isSafeInteger(receipt.challengeCreatedAt)
    || receipt.challengeCreatedAt < 0) return null;
  return Object.freeze({ ...receipt });
}
