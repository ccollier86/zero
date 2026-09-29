import { describe, expect, test } from 'bun:test';
import {
  MemoryEventStore,
  OBS_CODES,
  emitPlatformCodeTo,
} from '../observability';
import type { PlatformObservabilityRuntime } from '../observability/types';
import type { CreatedAuthActionToken } from './action-token-service';
import { AdminEmailVerificationService } from './admin-email-verification-service';
import { AdminLifecycleEmailService } from './admin-lifecycle-email-service';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import type {
  AuthActionTokenRecord,
  AuthContext,
  ResolvedAuthBehaviorConfig,
  UserRecord,
} from './types';

const ACTOR = { userId: 'usr_admin' } as AuthContext;
const TARGET: UserRecord = {
  userId: 'usr_target',
  username: 'target',
  email: 'private-target@example.test',
  firstName: null,
  lastName: null,
  role: 'user',
  status: 'active',
  passwordChangeRequired: false,
  emailVerifiedAt: null,
  emailVerificationRequired: true,
  mfaRequired: false,
  createdAt: 1,
  updatedAt: null,
  properties: {},
};

describe('admin email delivery observability', () => {
  test('reports verification delivery failure without provider or recipient details', async () => {
    const capture = eventCapture();
    const token = createdToken('email_verification');
    let cleanupCalls = 0;
    const store = {
      transaction: <T>(operation: () => T) => operation(),
      getUserById: () => TARGET,
    };
    const tokens = {
      create: () => token,
      revokeUndelivered(rawToken: string) {
        expect(rawToken).toBe(token.rawToken);
        cleanupCalls += 1;
        return true;
      },
    };
    const providerFailure = new Error('provider-private-message private-target@example.test');
    const email = {
      assertReady() {},
      async sendEmailVerification() {
        throw providerFailure;
      },
    };
    const service = new AdminEmailVerificationService(
      store as never,
      tokens as never,
      email as never,
      { account: { requireEmailVerification: true } } as ResolvedAuthBehaviorConfig,
      capture.emitCode,
    );

    await expect(service.send(TARGET.userId, () => ACTOR)).rejects.toBe(providerFailure);

    expect(cleanupCalls).toBe(1);
    const [event] = capture.events.query({
      code: OBS_CODES.AUTH_ADMIN_EMAIL_VERIFICATION_DELIVERY_FAILED.code,
    }).events;
    expect(event).toMatchObject({
      userId: ACTOR.userId,
      metadata: {
        targetUserId: TARGET.userId,
        cleanupSucceeded: true,
        code: 'EMAIL_SEND_FAILED',
        retryable: true,
      },
    });
    expect(event?.error).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain('provider-private-message');
    expect(JSON.stringify(event)).not.toContain(TARGET.email);
  });

  test('reports setup and reset delivery failures through distinct stable codes', async () => {
    const capture = eventCapture();
    let tokenNumber = 0;
    const store = {
      transaction: <T>(operation: () => T) => operation(),
      getUserById: () => TARGET,
      appendControlPlaneAudit() {},
      countActiveAdmins: () => 1,
      requirePasswordChange: () => true,
    };
    const tokens = {
      create(input: { type: AuthActionTokenRecord['type'] }) {
        tokenNumber += 1;
        return createdToken(input.type, tokenNumber);
      },
      revokeUndelivered: () => true,
    };
    const providerFailure = new Error('provider-private-message private-target@example.test');
    const email = {
      assertReady() {},
      async sendAccountSetup() {
        throw providerFailure;
      },
      async sendPasswordReset() {
        throw providerFailure;
      },
    };
    const service = new AdminLifecycleEmailService(
      store as never,
      tokens as never,
      email as never,
      capture.emitCode,
    );

    await expect(service.sendSetup(TARGET.userId, () => ACTOR)).rejects.toBe(providerFailure);
    await expect(service.sendPasswordReset(TARGET.userId, () => ACTOR))
      .rejects.toBe(providerFailure);

    for (const code of [
      OBS_CODES.AUTH_ADMIN_SETUP_DELIVERY_FAILED.code,
      OBS_CODES.AUTH_ADMIN_PASSWORD_RESET_DELIVERY_FAILED.code,
    ]) {
      const [event] = capture.events.query({ code }).events;
      expect(event).toMatchObject({
        userId: ACTOR.userId,
        metadata: {
          targetUserId: TARGET.userId,
          cleanupSucceeded: true,
          code: 'EMAIL_SEND_FAILED',
          retryable: true,
        },
      });
      expect(event?.error).toBeUndefined();
      expect(JSON.stringify(event)).not.toContain('provider-private-message');
      expect(JSON.stringify(event)).not.toContain(TARGET.email);
    }
  });

  test('detaches lifecycle audit request before queued delivery yields', async () => {
    const auditEvents: Array<{ request?: { requestId?: string } }> = [];
    let markDeliveryStarted!: () => void;
    let releaseDelivery!: () => void;
    const deliveryStarted = new Promise<void>((resolve) => {
      markDeliveryStarted = resolve;
    });
    const deliveryGate = new Promise<void>((resolve) => {
      releaseDelivery = resolve;
    });
    const store = {
      transaction: <T>(operation: () => T) => operation(),
      getUserById: () => TARGET,
      appendControlPlaneAudit(event: { request?: { requestId?: string } }) {
        auditEvents.push(event);
      },
      countActiveAdmins: () => 1,
      requirePasswordChange: () => true,
    };
    const tokens = {
      create: () => createdToken('admin_password_reset'),
      revokeUndelivered: () => true,
    };
    const email = {
      assertReady() {},
      async sendPasswordReset() {
        markDeliveryStarted();
        await deliveryGate;
      },
    };
    const request = { requestId: 'original-request' };
    const service = new AdminLifecycleEmailService(
      store as never,
      tokens as never,
      email as never,
      (() => undefined) as never,
    );

    const pending = service.sendPasswordReset(TARGET.userId, () => ACTOR, request);
    await deliveryStarted;
    request.requestId = 'mutated-request';
    releaseDelivery();
    await pending;

    expect(auditEvents).toHaveLength(2);
    expect(auditEvents.every((event) => event.request?.requestId === 'original-request'))
      .toBe(true);
  });

  test('runs provisioning token binding and finalization inside their owning transactions', async () => {
    let transactionDepth = 0;
    let passwordGateWritten = false;
    const order: string[] = [];
    const store = {
      transaction<T>(operation: () => T): T {
        transactionDepth += 1;
        try {
          return operation();
        } finally {
          transactionDepth -= 1;
        }
      },
      getUserById: () => TARGET,
      appendControlPlaneAudit() {},
      countActiveAdmins: () => 1,
      requirePasswordChange() {
        expect(transactionDepth).toBe(1);
        passwordGateWritten = true;
        order.push('password-gate');
        return true;
      },
    };
    const token = createdToken('account_setup');
    const tokens = {
      create() {
        expect(transactionDepth).toBe(1);
        order.push('token-created');
        return token;
      },
      revokeUndelivered: () => true,
    };
    const email = {
      assertReady() {},
      async sendAccountSetup() {
        expect(transactionDepth).toBe(0);
        order.push('provider-accepted');
      },
    };
    const service = new AdminLifecycleEmailService(
      store as never,
      tokens as never,
      email as never,
      (() => undefined) as never,
    );

    await service.sendSetup(TARGET.userId, () => ACTOR, undefined, {
      onTokenPrepared(created) {
        expect(created).toBe(token);
        expect(transactionDepth).toBe(1);
        order.push('token-bound');
      },
      onDeliveryAttempted() {
        expect(transactionDepth).toBe(0);
        order.push('delivery-attempted');
      },
      onDeliveryAccepted() {
        expect(transactionDepth).toBe(0);
        order.push('delivery-accepted');
      },
      onBeforeCommit() {
        expect(transactionDepth).toBe(1);
        expect(passwordGateWritten).toBe(false);
        order.push('state-fenced');
      },
      onCommitted() {
        expect(transactionDepth).toBe(1);
        expect(passwordGateWritten).toBe(true);
        order.push('receipt-finalized');
      },
    });

    expect(order).toEqual([
      'token-created',
      'token-bound',
      'delivery-attempted',
      'provider-accepted',
      'delivery-accepted',
      'state-fenced',
      'password-gate',
      'receipt-finalized',
    ]);
  });
});

function eventCapture(): {
  events: MemoryEventStore;
  emitCode: AuthPlatformCodeEmitter;
} {
  const events = new MemoryEventStore();
  const runtime: PlatformObservabilityRuntime = {
    sink: events,
    store: events,
    config: { console: false },
  };
  return {
    events,
    emitCode: (definition, options) => emitPlatformCodeTo(runtime, definition, options),
  };
}

function createdToken(
  type: AuthActionTokenRecord['type'],
  sequence = 1,
): CreatedAuthActionToken {
  return {
    rawToken: `raw-private-token-${sequence}`,
    record: {
      tokenId: `tok_${sequence}`,
      userId: TARGET.userId,
      type,
      tokenHash: `hash_${sequence}`,
      expiresAt: 10_000,
      consumedAt: null,
      createdAt: 1,
      createdBy: ACTOR.userId,
      metadata: {},
    },
  };
}
