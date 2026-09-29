import { afterEach, describe, expect, test } from 'bun:test';

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCodeTo } from '../observability/sink';
import type {
  PlatformCodeDefinition,
  PlatformCodeEmitOptions,
  PlatformObservabilityRuntime,
} from '../observability/types';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { defineAuthTables } from './auth-schema';
import { resolveAuthBehaviorConfig } from './auth-config';
import { AuthEmailOutbox } from './auth-email-outbox';
import { AuthEmailOutboxStore } from './auth-email-outbox-store';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import { registerUser, type RegistrationInput } from './auth-registration-service';
import type { AuthAuditRequestContext } from './auth-audit-types';
import type { AuthSessionPluginConfig } from './auth-session-dependencies';
import { AuthSessionContinuationStore } from './auth-session-continuation-store';
import { createInvitationGrantSnapshot } from './auth-tenant-invitation-grant';
import { AuthorizationKernel } from './authorization-kernel';
import { AuthorizationRoleStore } from './authorization-role-store';
import { TokenService } from './token-service';
import { AuthError, type UserRecord } from './types';

interface CapturedEmission {
  definition: PlatformCodeDefinition;
  options: PlatformCodeEmitOptions | undefined;
}

const databases: ReactiveDB[] = [];

afterEach(() => {
  for (const db of databases.splice(0).reverse()) db.dispose();
});

describe('auth request-path invariant boundaries', () => {
  test('registration rejects malformed bootstrap organization names with a stable error', async () => {
    const config = {
      getUserStore: () => ({
        isBootstrapRequired: () => true,
        createRegistrationUser: () => {
          throw new Error('Malformed organization name reached identity creation');
        },
      }),
      getTokenService: () => ({}),
      getPropertyService: () => ({ getDefaultProperties: () => ({}) }),
      getActionTokenService: () => ({}),
      getAccountEmailService: () => ({}),
      getMfaService: () => null,
      getMfaChallengeService: () => null,
      getNativeAuthorizationService: () => null,
      getRegistrationIntentStore: () => ({}),
      getAuthTenantSessionService: () => ({}),
      getEmailRuntime: () => ({}),
      getAuthConfig: () => resolveAuthBehaviorConfig({
        tenancy: 'multi',
        registration: { mode: 'public' },
      }),
    } as unknown as AuthSessionPluginConfig;

    for (const organizationName of [null, false, 7, {}, Symbol('name')]) {
      await expect(registerUser(config, {
        username: 'boundary-user',
        email: 'boundary-user@example.test',
        password: 'not-created',
        organizationName: organizationName as never,
      })).rejects.toMatchObject({
        name: 'AuthError',
        code: 'TENANT_NAME_REQUIRED',
        status: 422,
      } satisfies Partial<AuthError>);
    }
  });

  test('registration captures request and audit input before password hashing yields', async () => {
    let releaseCreate!: () => void;
    let markCreateStarted!: () => void;
    const createStarted = new Promise<void>((resolve) => {
      markCreateStarted = resolve;
    });
    const createGate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    let captured: {
      params: Record<string, unknown>;
      policy: { requestedMfaSetup: boolean };
      auditRequest?: AuthAuditRequestContext;
    } | null = null;
    const user = testUser('captured-registration-user');
    const config = {
      getUserStore: () => ({
        isBootstrapRequired: () => false,
        createRegistrationUser: async (
          params: Record<string, unknown>,
          resolvePolicy: (isBootstrap: boolean) => {
            role: 'admin' | 'user';
            requireEmailVerification: boolean;
            mfaRequired: boolean;
            requestedMfaSetup: boolean;
          },
          _afterInsert: unknown,
          options: { auditRequest?: AuthAuditRequestContext },
        ) => {
          markCreateStarted();
          await createGate;
          const policy = resolvePolicy(false);
          captured = { params, policy, auditRequest: options.auditRequest };
          return { user, policy, provisioning: null };
        },
      }),
      getTokenService: () => ({}),
      getPropertyService: () => ({ getDefaultProperties: () => ({}) }),
      getActionTokenService: () => ({}),
      getAccountEmailService: () => ({}),
      getMfaService: () => null,
      getMfaChallengeService: () => null,
      getNativeAuthorizationService: () => null,
      getRegistrationIntentStore: () => ({}),
      getAuthTenantSessionService: () => ({}),
      getEmailRuntime: () => ({}),
      getAuthConfig: () => resolveAuthBehaviorConfig({
        registration: { mode: 'public' },
        account: { requireEmailVerification: false },
        mfa: { enabled: true, policy: 'optional' },
      }),
    } as unknown as AuthSessionPluginConfig;
    const input: RegistrationInput = {
      username: 'captured-registration-user',
      email: 'captured-registration-user@example.test',
      password: 'original-password',
      firstName: 'Original',
      lastName: 'Registration',
      mfaEnrollment: false,
    };
    const auditRequest = {
      requestId: 'original-registration-request',
      correlationId: 'original-registration-correlation',
    };

    const pending = registerUser(config, input, auditRequest);
    await createStarted;
    input.username = 'mutated-registration-user';
    input.email = 'mutated-registration-user@example.test';
    input.password = 'mutated-password';
    input.firstName = 'Mutated';
    input.lastName = 'Caller';
    input.mfaEnrollment = true;
    input.bootstrapSecret = 'mutated-bootstrap-secret';
    auditRequest.requestId = 'mutated-registration-request';
    auditRequest.correlationId = 'mutated-registration-correlation';
    releaseCreate();

    await expect(pending).rejects.toMatchObject({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      status: 500,
    });
    expect(captured).toMatchObject({
      params: {
        username: 'captured-registration-user',
        email: 'captured-registration-user@example.test',
        password: 'original-password',
        firstName: 'Original',
        lastName: 'Registration',
      },
      policy: { requestedMfaSetup: false },
      auditRequest: {
        requestId: 'original-registration-request',
        correlationId: 'original-registration-correlation',
      },
    });
  });

  test('registration reports a missing provisional receipt through its injected emitter', async () => {
    const capture = createCapture();
    const user = testUser('registration-private-user');
    const config = {
      getUserStore: () => ({
        isBootstrapRequired: () => false,
        createRegistrationUser: async () => ({
          user,
          policy: { role: 'user', requireEmailVerification: false },
          provisioning: null,
        }),
      }),
      getTokenService: () => ({}),
      getPropertyService: () => ({ getDefaultProperties: () => ({}) }),
      getActionTokenService: () => ({}),
      getAccountEmailService: () => ({}),
      getMfaService: () => null,
      getMfaChallengeService: () => null,
      getNativeAuthorizationService: () => null,
      getRegistrationIntentStore: () => ({}),
      getAuthTenantSessionService: () => ({}),
      getEmailRuntime: () => ({}),
      getAuthConfig: () => resolveAuthBehaviorConfig({
        registration: { mode: 'public' },
      }),
      emitCode: capture.emitCode,
    } as unknown as AuthSessionPluginConfig;

    await expect(registerUser(config, {
      username: user.username,
      email: user.email,
      password: 'not-emitted-registration-secret',
    })).rejects.toMatchObject({
      name: 'AuthError',
      code: 'AUTH_STATE_INVARIANT_FAILED',
      status: 500,
    } satisfies Partial<AuthError>);

    expectInvariantEmission(
      capture.events,
      'registration-service',
      'registration-provisioning-receipt-missing',
    );
    expect(JSON.stringify(capture.events[0]!.options?.metadata))
      .not.toContain('registration-private-user');
  });

  test('invalid normalized invitation grants fail with stable app-local telemetry', () => {
    const capture = createCapture();
    const kernel = new AuthorizationKernel(resolveAuthBehaviorConfig({
      tenancy: 'multi',
      authorization: {
        mode: 'advanced',
        permissions: { 'records:read': { scope: 'tenant' } },
        roles: { reader: { permissions: ['records:read'] } },
      },
    }));

    expect(() => createInvitationGrantSnapshot({
      kernel,
      tenantKind: 'organization',
      roleKeys: ['private-retired-role'],
    }, capture.emitCode)).toThrow(expect.objectContaining({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      status: 500,
    }));

    expectInvariantEmission(
      capture.events,
      'tenant-invitation-service',
      'normalized-invitation-grant-unassignable',
    );
    expect(JSON.stringify(capture.events[0]!.options?.metadata))
      .not.toContain('private-retired-role');
  });

  test('email outbox and store report capability drift without recipient data', () => {
    const capture = createCapture();
    const db = createAuthDb();
    const store = new AuthEmailOutboxStore(
      db,
      'worker-invariant',
      () => {},
      capture.emitCode,
    );
    (store as unknown as { domainCapable: boolean }).domainCapable = false;

    expect(() => store.enqueueDomainMailbox({
      jobId: 'private-job',
      recipient: 'private-patient@example.test',
      recipientHash: 'private-recipient-hash',
      userId: 'private-user',
      emailGeneration: 1,
      authGeneration: 1,
      identityKind: 'session',
      identityContinuationId: null,
    }, 1, 1, 1, 1)).toThrow(expect.objectContaining({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      status: 500,
    }));

    const outbox = Object.create(AuthEmailOutbox.prototype) as AuthEmailOutbox;
    Object.assign(outbox as unknown as Record<string, unknown>, {
      assertCurrentProfile: () => {},
      emitCode: capture.emitCode,
      invitationEnvelope: null,
    });
    expect(() => outbox.enqueueInvitation({
      invitationId: 'private-invitation',
      recipient: 'private-invitee@example.test',
      rawToken: 'private-invitation-secret',
    })).toThrow(expect.objectContaining({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      status: 500,
    }));

    expectInvariantEmission(
      capture.events.slice(0, 1),
      'auth-email-outbox-store',
      'verified-domain-schema-unavailable',
    );
    expectInvariantEmission(
      capture.events.slice(1),
      'auth-email-outbox',
      'tenant-invitation-delivery-unavailable',
    );
    const metadata = JSON.stringify(capture.events.map((event) => event.options?.metadata));
    expect(metadata).not.toContain('private-patient');
    expect(metadata).not.toContain('private-invitation');
  });

  test('role-store postcondition failures use the injected app boundary', () => {
    const capture = createCapture();
    const db = createAuthDb();
    insertUser(db, 'private-role-subject');
    const store = new AuthorizationRoleStore(
      db,
      () => 100,
      () => 'private-assignment-id',
      capture.emitCode,
    );
    const internals = store as unknown as {
      statements: { activeApplication: unknown };
    };
    internals.statements.activeApplication = { get: () => null };

    expect(() => store.insertApplication({
      userId: 'private-role-subject',
      roleKey: 'reader',
      source: 'manual',
    })).toThrow(expect.objectContaining({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      status: 500,
    }));

    expectInvariantEmission(
      capture.events,
      'authorization-role-store',
      'application-assignment-insert-missing',
    );
    expect(JSON.stringify(capture.events[0]!.options?.metadata))
      .not.toContain('private-role-subject');
  });

  test('continuation application-id resolution reports only stable metadata', () => {
    const capture = createCapture();
    const db = createAuthDb();
    db.prepare("DELETE FROM _auth_config WHERE key = 'auth.application.id'").run();
    db.exec(`
      CREATE TRIGGER reject_test_application_id
      BEFORE INSERT ON _auth_config
      WHEN NEW.key = 'auth.application.id'
      BEGIN
        SELECT RAISE(IGNORE);
      END
    `);

    expect(() => new AuthSessionContinuationStore(db, {
      emitCode: capture.emitCode,
    })).toThrow(expect.objectContaining({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      status: 500,
    }));

    expectInvariantEmission(
      capture.events,
      'auth-session-continuation-store',
      'application-id-resolution-missing',
    );
  });

  test('unwired browser token persistence emits through the configured app sink', async () => {
    const capture = createCapture();
    const db = createAuthDb();
    const tokens = await TokenService.create({ db, emitCode: capture.emitCode });

    await expect(tokens.issueTokenPair(testUser('private-token-user')))
      .rejects.toMatchObject({
        name: 'AuthError',
        code: 'AUTH_STATE_INVARIANT_FAILED',
        status: 500,
        message: '[auth] Browser token persistence is unavailable.',
      } satisfies Partial<AuthError>);

    expectInvariantEmission(
      capture.events,
      'auth-web-session-token-service',
      'user-store-unavailable',
    );
    expect(JSON.stringify(capture.events[0]!.options?.metadata))
      .not.toContain('private-token-user');
  });
});

function createCapture(): {
  events: CapturedEmission[];
  emitCode: AuthPlatformCodeEmitter;
} {
  const events: CapturedEmission[] = [];
  const runtime: PlatformObservabilityRuntime = {
    sink: { emit() {} },
    store: null,
    config: { console: false },
  };
  return {
    events,
    emitCode(definition, options) {
      events.push({ definition, options });
      return emitPlatformCodeTo(runtime, definition, options);
    },
  };
}

function expectInvariantEmission(
  events: CapturedEmission[],
  component: string,
  invariant: string,
): void {
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    definition: { code: OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code },
    options: {
      error: {
        name: 'AuthError',
        code: 'AUTH_STATE_INVARIANT_FAILED',
        status: 500,
      },
      metadata: { component, invariant },
    },
  });
  expect(Object.keys(events[0]!.options?.metadata ?? {}).sort())
    .toEqual(['component', 'invariant']);
}

function createAuthDb(): ReactiveDB {
  const db = createReactiveDB({ mode: 'memory' });
  databases.push(db);
  db.exec('PRAGMA foreign_keys = ON');
  defineAuthTables(db);
  return db;
}

function insertUser(db: ReactiveDB, userId: string): void {
  db.prepare(`
    INSERT INTO users (
      user_id, username, email, role, status,
      password_change_required, email_verification_required, mfa_required,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'user', 'active', 0, 0, 0, 1, NULL)
  `).run(userId, `${userId}-name`, `${userId}@example.test`);
}

function testUser(userId: string): UserRecord {
  return {
    userId,
    username: `${userId}-name`,
    email: `${userId}@example.test`,
    firstName: null,
    lastName: null,
    role: 'user',
    status: 'active',
    passwordChangeRequired: false,
    emailVerifiedAt: 1,
    emailVerificationRequired: false,
    mfaRequired: false,
    createdAt: 1,
    updatedAt: null,
    properties: {},
  };
}
