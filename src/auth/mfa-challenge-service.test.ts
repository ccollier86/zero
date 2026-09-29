/**
 * mfa-challenge-service.test.ts
 *
 * Verifies that MFA operations detach caller-owned request data before their
 * first asynchronous crypto or email-delivery boundary.
 */

import { describe, expect, test } from 'bun:test';
import type { AppendAuthAuditEventInput } from './auth-audit-types';
import type { AuthAuditService } from './auth-audit-service';
import { resolveAuthBehaviorConfig } from './auth-config';
import {
  MfaChallengeService,
  type MfaLoginChallengeStart,
} from './mfa-challenge-service';
import type { MfaChallengeStore } from './mfa-challenge-store';
import type { MfaMethodStore } from './mfa-method-store';
import { encryptMfaSecret } from './mfa-secret-crypto';
import { generateTotpCode } from './mfa-totp';
import type {
  AuthMfaChallengeRecord,
  AuthMfaMethodRecord,
  UserRecord,
} from './types';

const TOTP_ENCRYPTION_KEY = 'mfa-input-snapshot-test-key';
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

describe('MfaChallengeService async input snapshots', () => {
  test('verifyEnrollment retains code and audit attribution across TOTP decryption', async () => {
    const pending = methodRecord({
      status: 'pending',
      secretCiphertext: await encryptMfaSecret(TOTP_SECRET, TOTP_ENCRYPTION_KEY),
    });
    const activated = methodRecord({
      ...pending,
      status: 'active',
      isPrimary: true,
      verifiedAt: Date.now(),
    });
    const methodLookups: string[] = [];
    let auditEvent: AppendAuthAuditEventInput | undefined;
    const methodStore = {
      getMethod(methodId: string) {
        methodLookups.push(methodId);
        return methodId === pending.methodId ? pending : null;
      },
      transaction<T>(operation: () => T) {
        return operation();
      },
      activateMethod(methodId: string) {
        return methodId === pending.methodId ? activated : null;
      },
    } as unknown as MfaMethodStore;
    const auditService = {
      append(input: AppendAuthAuditEventInput) {
        auditEvent = input;
        return {};
      },
    } as unknown as AuthAuditService;
    const service = createService({ methodStore, auditService });
    const params: Parameters<MfaChallengeService['verifyEnrollment']>[0] = {
      user: userRecord(),
      methodId: pending.methodId,
      code: generateTotpCode({ secret: TOTP_SECRET }),
      challengeId: 'original-challenge',
      auditActor: {
        userId: 'actor-original',
        sessionId: 'session-original',
        provenance: 'authenticated-request',
      },
      auditRequest: {
        requestId: 'request-original',
        correlationId: 'correlation-original',
      },
    };

    const verification = service.verifyEnrollment(params);
    params.user.userId = 'user-mutated';
    params.methodId = 'method-mutated';
    params.code = 'not-a-code';
    params.challengeId = 'challenge-mutated';
    params.auditActor!.userId = 'actor-mutated';
    params.auditActor!.sessionId = 'session-mutated';
    params.auditActor!.provenance = 'system';
    params.auditRequest!.requestId = 'request-mutated';
    params.auditRequest!.correlationId = 'correlation-mutated';

    await expect(verification).resolves.toMatchObject({
      methodId: pending.methodId,
      status: 'active',
    });
    expect(methodLookups).toEqual([pending.methodId, pending.methodId]);
    expect(auditEvent).toMatchObject({
      actor: {
        userId: 'actor-original',
        sessionId: 'session-original',
        provenance: 'authenticated-request',
      },
      request: {
        requestId: 'request-original',
        correlationId: 'correlation-original',
      },
      target: { type: 'mfa-method', id: pending.methodId },
    });
  });

  test('verifyEnrollment cannot reactivate a method disabled during TOTP decryption', async () => {
    const pending = methodRecord({
      status: 'pending',
      secretCiphertext: await encryptMfaSecret(TOTP_SECRET, TOTP_ENCRYPTION_KEY),
    });
    let liveMethod: AuthMfaMethodRecord | null = pending;
    let activationAttempts = 0;
    const methodStore = {
      getMethod(methodId: string) {
        return methodId === pending.methodId ? liveMethod : null;
      },
      transaction<T>(operation: () => T) {
        return operation();
      },
      activateMethod() {
        activationAttempts += 1;
        return liveMethod;
      },
    } as unknown as MfaMethodStore;
    const service = createService({ methodStore });

    const verification = service.verifyEnrollment({
      user: userRecord(),
      methodId: pending.methodId,
      code: generateTotpCode({ secret: TOTP_SECRET }),
    });
    liveMethod = methodRecord({ ...pending, status: 'disabled' });

    await expect(verification).rejects.toMatchObject({
      code: 'MFA_METHOD_NOT_PENDING',
      status: 400,
    });
    expect(activationAttempts).toBe(0);
  });

  test('verifyEnrollment cannot activate a stale-generation proof after TOTP decryption', async () => {
    const pending = methodRecord({
      status: 'pending',
      secretCiphertext: await encryptMfaSecret(TOTP_SECRET, TOTP_ENCRYPTION_KEY),
    });
    let currentGeneration = 4;
    let activationAttempts = 0;
    let auditWrites = 0;
    const methodStore = {
      getMethod(methodId: string) {
        return methodId === pending.methodId ? pending : null;
      },
      transaction<T>(operation: () => T) {
        return operation();
      },
      activateMethod() {
        activationAttempts += 1;
        return null;
      },
    } as unknown as MfaMethodStore;
    const auditService = {
      append() {
        auditWrites += 1;
        return {};
      },
    } as unknown as AuthAuditService;
    const service = createService({
      methodStore,
      auditService,
      getAuthGeneration: () => currentGeneration,
    });

    const verification = service.verifyEnrollment({
      user: userRecord(),
      methodId: pending.methodId,
      code: generateTotpCode({ secret: TOTP_SECRET }),
      expectedAuthGeneration: currentGeneration,
    });
    currentGeneration += 1;

    await expect(verification).rejects.toMatchObject({
      code: 'AUTH_STATE_CHANGED',
      status: 409,
    });
    expect(activationAttempts).toBe(0);
    expect(auditWrites).toBe(0);
  });

  test('verifyEnrollment cannot activate after originating profile authority changes', async () => {
    const pending = methodRecord({
      status: 'pending',
      secretCiphertext: await encryptMfaSecret(TOTP_SECRET, TOTP_ENCRYPTION_KEY),
    });
    let admitted = true;
    let activationAttempts = 0;
    const methodStore = {
      getMethod(methodId: string) {
        return methodId === pending.methodId ? pending : null;
      },
      transaction<T>(operation: () => T) {
        return operation();
      },
      activateMethod() {
        activationAttempts += 1;
        return null;
      },
    } as unknown as MfaMethodStore;
    const service = createService({ methodStore });

    const verification = service.verifyEnrollment({
      user: userRecord(),
      methodId: pending.methodId,
      code: generateTotpCode({ secret: TOTP_SECRET }),
      expectedAuthGeneration: 0,
      admitAuthority: () => admitted,
    });
    admitted = false;

    await expect(verification).rejects.toMatchObject({
      code: 'AUTH_STATE_CHANGED',
      status: 409,
    });
    expect(activationAttempts).toBe(0);
  });

  test('startEnrollment retains identity and label across TOTP encryption', async () => {
    let createInput: {
      userId: string;
      type: 'email' | 'totp';
      label?: string | null;
      secretCiphertext?: string | null;
    } | undefined;
    const methodStore = {
      transaction<T>(operation: () => T) {
        return operation();
      },
      createMethod(input: NonNullable<typeof createInput>) {
        createInput = input;
        return methodRecord({
          userId: input.userId,
          type: input.type,
          label: input.label ?? null,
          secretCiphertext: input.secretCiphertext ?? null,
        });
      },
    } as unknown as MfaMethodStore;
    const service = createService({ methodStore });
    const params: Parameters<MfaChallengeService['startEnrollment']>[0] = {
      user: userRecord(),
      methodType: 'totp',
      label: 'Primary authenticator',
    };

    const enrollment = service.startEnrollment(params);
    params.user.userId = 'user-mutated';
    params.user.email = 'mutated@example.test';
    params.user.properties.department = 'mutated';
    params.methodType = 'email';
    params.label = 'Mutated label';

    await expect(enrollment).resolves.toMatchObject({
      method: {
        type: 'totp',
        label: 'Primary authenticator',
      },
      totp: {
        accountName: 'original@example.test',
      },
    });
    expect(createInput).toMatchObject({
      userId: 'user-original',
      type: 'totp',
      label: 'Primary authenticator',
    });
    expect(createInput?.secretCiphertext).toStartWith('v1.');
  });

  test('startEnrollment rechecks profile authority at the post-crypto commit', async () => {
    let admitted = true;
    let created = 0;
    const methodStore = {
      transaction<T>(operation: () => T) {
        return operation();
      },
      createMethod() {
        created += 1;
        return methodRecord();
      },
    } as unknown as MfaMethodStore;
    const service = createService({ methodStore });

    const enrollment = service.startEnrollment({
      user: userRecord(),
      methodType: 'totp',
      expectedAuthGeneration: 0,
      admitAuthority: () => admitted,
    });
    admitted = false;

    await expect(enrollment).rejects.toMatchObject({
      code: 'AUTH_STATE_CHANGED',
      status: 409,
    });
    expect(created).toBe(0);
  });

  test('profile authority admission rejects async callbacks with standard observability', async () => {
    const emitted: Array<{ code: string; metadata: unknown }> = [];
    const service = createService({
      emitCode: (definition, options) => {
        emitted.push({ code: definition.code, metadata: options?.metadata });
        return {} as never;
      },
    });

    await expect(service.startEnrollment({
      user: userRecord(),
      methodType: 'totp',
      expectedAuthGeneration: 0,
      admitAuthority: (async () => true) as never,
    })).rejects.toMatchObject({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      status: 500,
    });
    expect(emitted).toEqual([{
      code: 'auth.state_invariant.failed',
      metadata: {
        component: 'mfa-challenge-service',
        invariant: 'profile-authority-admission-async',
      },
    }]);
  });

  test('rollbackEnrollment consumes and disables only the exact pending receipt', () => {
    let method = methodRecord({ status: 'pending', createdAt: 100 });
    let challenge = challengeRecord({ createdAt: 200 });
    const methodStore = {
      transaction<T>(operation: () => T) {
        return operation();
      },
      getMethod(methodId: string) {
        return methodId === method.methodId ? method : null;
      },
      disableMethod(methodId: string) {
        if (methodId !== method.methodId || method.status !== 'pending') return false;
        method = { ...method, status: 'disabled', disabledAt: 300 };
        return true;
      },
    } as unknown as MfaMethodStore;
    const challengeStore = {
      getChallenge(challengeId: string) {
        return challengeId === challenge.challengeId ? challenge : null;
      },
      consumeChallenge(challengeId: string) {
        if (challengeId !== challenge.challengeId || challenge.consumedAt !== null) return false;
        challenge = { ...challenge, consumedAt: 300 };
        return true;
      },
    } as unknown as MfaChallengeStore;
    const emitted: Array<{ code: string; metadata: unknown }> = [];
    const service = createService({
      methodStore,
      challengeStore,
      emitCode: (definition, options) => {
        emitted.push({ code: definition.code, metadata: options?.metadata });
        return {} as never;
      },
    });
    const receipt = {
      kind: 'enrollment' as const,
      userId: method.userId,
      methodId: method.methodId,
      methodCreatedAt: method.createdAt,
      challengeId: challenge.challengeId,
      challengeCreatedAt: challenge.createdAt,
    };

    expect(service.rollbackEnrollment(receipt)).toEqual({
      methodDisabled: true,
      challengeConsumed: true,
    });
    expect(service.rollbackEnrollment(receipt)).toEqual({
      methodDisabled: false,
      challengeConsumed: false,
    });

    expect(() => service.rollbackEnrollment({
      ...receipt,
      methodCreatedAt: receipt.methodCreatedAt + 1,
    })).toThrow(expect.objectContaining({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      status: 500,
    }));
    expect(method.status).toBe('disabled');
    expect(challenge.consumedAt).toBe(300);
    expect(emitted).toEqual([{
      code: 'auth.state_invariant.failed',
      metadata: {
        component: 'mfa-challenge-service',
        invariant: 'enrollment-method-receipt-mismatch',
      },
    }]);
  });

  test('verifyLoginChallenge retains identity and code across TOTP decryption', async () => {
    const active = methodRecord({
      status: 'active',
      secretCiphertext: await encryptMfaSecret(TOTP_SECRET, TOTP_ENCRYPTION_KEY),
    });
    const methodLookups: string[] = [];
    const recordedUses: string[] = [];
    const methodStore = {
      getMethod(methodId: string) {
        methodLookups.push(methodId);
        return methodId === active.methodId ? active : null;
      },
      transaction<T>(operation: () => T) {
        return operation();
      },
      recordUse(methodId: string) {
        recordedUses.push(methodId);
      },
    } as unknown as MfaMethodStore;
    const service = createService({ methodStore });
    const params: Parameters<MfaChallengeService['verifyLoginChallenge']>[0] = {
      user: userRecord(),
      methodId: active.methodId,
      code: generateTotpCode({ secret: TOTP_SECRET }),
      challengeId: 'challenge-original',
    };

    const verification = service.verifyLoginChallenge(params);
    params.user.userId = 'user-mutated';
    params.methodId = 'method-mutated';
    params.code = 'not-a-code';
    params.challengeId = 'challenge-mutated';

    await expect(verification).resolves.toMatchObject({
      methodId: active.methodId,
      status: 'active',
    });
    expect(methodLookups).toEqual([active.methodId, active.methodId, active.methodId]);
    expect(recordedUses).toEqual([active.methodId]);
  });

  test('verifyLoginChallenge rejects a method deleted during TOTP decryption', async () => {
    const active = methodRecord({
      status: 'active',
      secretCiphertext: await encryptMfaSecret(TOTP_SECRET, TOTP_ENCRYPTION_KEY),
    });
    let liveMethod: AuthMfaMethodRecord | null = active;
    const recordedUses: string[] = [];
    const methodStore = {
      getMethod(methodId: string) {
        return methodId === active.methodId ? liveMethod : null;
      },
      transaction<T>(operation: () => T) {
        return operation();
      },
      recordUse(methodId: string) {
        recordedUses.push(methodId);
      },
    } as unknown as MfaMethodStore;
    const service = createService({ methodStore });

    const verification = service.verifyLoginChallenge({
      user: userRecord(),
      methodId: active.methodId,
      code: generateTotpCode({ secret: TOTP_SECRET }),
    });
    liveMethod = null;

    await expect(verification).rejects.toMatchObject({
      code: 'MFA_METHOD_NOT_FOUND',
      status: 404,
    });
    expect(recordedUses).toEqual([]);
  });

  test('verifyLoginChallenge cannot record a stale-generation proof after TOTP decryption', async () => {
    const active = methodRecord({
      status: 'active',
      secretCiphertext: await encryptMfaSecret(TOTP_SECRET, TOTP_ENCRYPTION_KEY),
    });
    let currentGeneration = 9;
    const recordedUses: string[] = [];
    const methodStore = {
      getMethod(methodId: string) {
        return methodId === active.methodId ? active : null;
      },
      transaction<T>(operation: () => T) {
        return operation();
      },
      recordUse(methodId: string) {
        recordedUses.push(methodId);
      },
    } as unknown as MfaMethodStore;
    const service = createService({
      methodStore,
      getAuthGeneration: () => currentGeneration,
    });

    const verification = service.verifyLoginChallenge({
      user: userRecord(),
      methodId: active.methodId,
      code: generateTotpCode({ secret: TOTP_SECRET }),
      expectedAuthGeneration: currentGeneration,
    });
    currentGeneration += 1;

    await expect(verification).rejects.toMatchObject({
      code: 'AUTH_STATE_CHANGED',
      status: 409,
    });
    expect(recordedUses).toEqual([]);
  });

  test('startLoginChallenge retains caller-owned identity and method projections during email delivery', async () => {
    const delivery = deferred<void>();
    const deliveries: Array<{ user: UserRecord; purpose: 'setup' | 'login' }> = [];
    const challengeStore = emailChallengeStore();
    const accountEmail = {
      sendEmailOtp(input: { user: UserRecord; purpose: 'setup' | 'login' }) {
        deliveries.push(input);
        return delivery.promise;
      },
    };
    const service = createService({ challengeStore, accountEmail });
    const params: Parameters<MfaChallengeService['startLoginChallenge']>[0] = {
      user: userRecord(),
      method: methodRecord({ type: 'email', status: 'active', secretCiphertext: null }),
    };

    const challenge = service.startLoginChallenge(params);
    params.user.userId = 'user-mutated';
    params.user.email = 'mutated@example.test';
    params.user.properties.department = 'mutated';
    params.method.methodId = 'method-mutated';
    params.method.label = 'Mutated label';
    params.method.status = 'disabled';
    delivery.resolve();

    const result: MfaLoginChallengeStart = await challenge;
    expect(result).toMatchObject({
      method: {
        methodId: 'method-original',
        label: 'Original method',
        status: 'active',
      },
      challenge: {
        challengeId: 'challenge-original',
        methodType: 'email',
      },
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.user).toMatchObject({
      userId: 'user-original',
      email: 'original@example.test',
      properties: { department: 'original' },
    });
    expect(challengeStore.createdInputs).toEqual([
      expect.objectContaining({
        userId: 'user-original',
        methodId: 'method-original',
        metadata: { purpose: 'login' },
      }),
    ]);
  });

  test('email delivery failure cleanup and observability retain the original identity', async () => {
    const delivery = deferred<void>();
    const challengeStore = emailChallengeStore();
    const emitted: Array<{
      code: string;
      userId: string | undefined;
      metadata: unknown;
    }> = [];
    const service = createService({
      challengeStore,
      accountEmail: {
        sendEmailOtp() {
          return delivery.promise;
        },
      },
      emitCode: (definition, options) => {
        emitted.push({
          code: definition.code,
          userId: options?.userId,
          metadata: options?.metadata,
        });
        return {} as never;
      },
    });
    const params: Parameters<MfaChallengeService['startLoginChallenge']>[0] = {
      user: userRecord(),
      method: methodRecord({ type: 'email', status: 'active', secretCiphertext: null }),
    };
    const deliveryError = new Error('mail unavailable');

    const challenge = service.startLoginChallenge(params);
    params.user.userId = 'user-mutated';
    params.method.methodId = 'method-mutated';
    delivery.reject(deliveryError);

    await expect(challenge).rejects.toBe(deliveryError);
    expect(challengeStore.consumedIds).toEqual(['challenge-original']);
    expect(emitted).toEqual([{
      code: 'auth.mfa_email.delivery_failed',
      userId: 'user-original',
      metadata: { source: 'login', cleanupSucceeded: true },
    }]);
  });
});

function createService(overrides: {
  methodStore?: MfaMethodStore;
  challengeStore?: MfaChallengeStore;
  accountEmail?: { sendEmailOtp: (...args: never[]) => Promise<void> };
  auditService?: AuthAuditService;
  emitCode?: ConstructorParameters<typeof MfaChallengeService>[6];
  getAuthGeneration?: (userId: string) => number;
} = {}): MfaChallengeService {
  return new MfaChallengeService(
    resolveAuthBehaviorConfig({
      mfa: {
        enabled: true,
        policy: 'optional',
        methods: ['email', 'totp'],
        totp: {
          encryptionKey: TOTP_ENCRYPTION_KEY,
          issuer: 'Zero Snapshot Tests',
        },
      },
    }),
    overrides.methodStore ?? ({
      transaction<T>(operation: () => T) {
        return operation();
      },
    } as MfaMethodStore),
    overrides.challengeStore ?? ({} as MfaChallengeStore),
    (overrides.accountEmail ?? {}) as never,
    overrides.auditService,
    undefined,
    overrides.emitCode,
    overrides.getAuthGeneration,
  );
}

function userRecord(): UserRecord {
  return {
    userId: 'user-original',
    username: 'original',
    email: 'original@example.test',
    firstName: 'Original',
    lastName: 'User',
    role: 'user',
    status: 'active',
    passwordChangeRequired: false,
    emailVerifiedAt: Date.now(),
    emailVerificationRequired: false,
    mfaRequired: false,
    createdAt: Date.now(),
    updatedAt: null,
    properties: { department: 'original' },
  };
}

function methodRecord(
  overrides: Partial<AuthMfaMethodRecord> = {},
): AuthMfaMethodRecord {
  return {
    methodId: 'method-original',
    userId: 'user-original',
    type: 'totp',
    label: 'Original method',
    status: 'pending',
    isPrimary: false,
    secretCiphertext: null,
    createdAt: Date.now(),
    verifiedAt: null,
    disabledAt: null,
    lastUsedAt: null,
    metadata: {},
    ...overrides,
  };
}

function emailChallengeStore(): MfaChallengeStore & {
  createdInputs: Array<Record<string, unknown>>;
  consumedIds: string[];
} {
  const createdInputs: Array<Record<string, unknown>> = [];
  const consumedIds: string[] = [];
  let record = challengeRecord();
  return {
    createdInputs,
    consumedIds,
    countRecentActive: () => 0,
    createChallenge(input: Record<string, unknown>) {
      createdInputs.push(input);
      record = challengeRecord();
      return record;
    },
    getChallenge(challengeId: string) {
      return challengeId === record.challengeId ? record : null;
    },
    consumeChallenge(challengeId: string) {
      consumedIds.push(challengeId);
      if (challengeId !== record.challengeId || record.consumedAt !== null) return false;
      record = { ...record, consumedAt: Date.now() };
      return true;
    },
  } as unknown as MfaChallengeStore & {
    createdInputs: Array<Record<string, unknown>>;
    consumedIds: string[];
  };
}

function challengeRecord(
  overrides: Partial<AuthMfaChallengeRecord> = {},
): AuthMfaChallengeRecord {
  return {
    challengeId: 'challenge-original',
    userId: 'user-original',
    methodId: 'method-original',
    methodType: 'email',
    codeHash: 'hash',
    expiresAt: Date.now() + 60_000,
    attempts: 0,
    maxAttempts: 5,
    consumedAt: null,
    createdAt: Date.now(),
    metadata: { purpose: 'login' },
    ...overrides,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
