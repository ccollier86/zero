import { describe, expect, test } from 'bun:test';
import { OBS_CODES } from '../observability';
import type {
  PlatformCodeDefinition,
  PlatformCodeEmitOptions,
} from '../observability/types';
import { AdminUserCreateService } from './admin-user-create-service';
import { resolveAuthBehaviorConfig } from './auth-config';
import type {
  AdminUserProvisioningReceipt,
  AuthSecurityAuditContext,
  UserStore,
} from './user-store';
import type { UserRecord } from './types';
import { UserPropertyService } from './user-property-service';

describe('AdminUserCreateService', () => {
  test('detaches creation policy, identity, properties, and audit before hashing yields', async () => {
    const auth = resolveAuthBehaviorConfig({
      registration: { mode: 'admin-only' },
    });
    let markCreateStarted!: () => void;
    let releaseCreate!: () => void;
    const createStarted = new Promise<void>((resolve) => {
      markCreateStarted = resolve;
    });
    const createGate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    const boundaries: Array<{ requestedPlatformRole?: string } | undefined> = [];
    let createdUser: UserRecord | null = null;
    let capturedInput: Record<string, unknown> | null = null;
    let capturedAudit: AuthSecurityAuditContext | null = null;
    const store = {
      async createUser(
        input: Record<string, unknown>,
        audit: AuthSecurityAuditContext,
        beforeInsert: () => void,
      ) {
        capturedInput = input;
        capturedAudit = audit;
        markCreateStarted();
        await createGate;
        beforeInsert();
        createdUser = {
          userId: 'created-user',
          username: input.username as string,
          email: input.email as string,
          firstName: (input.firstName as string | undefined) ?? null,
          lastName: (input.lastName as string | undefined) ?? null,
          role: input.role as string,
          status: 'active',
          passwordChangeRequired: Boolean(input.passwordChangeRequired),
          emailVerifiedAt: null,
          emailVerificationRequired: false,
          mfaRequired: Boolean(input.mfaRequired),
          createdAt: 1,
          updatedAt: null,
          properties: input.properties as Record<string, string>,
        };
        return createdUser;
      },
      getUserById: () => createdUser,
    } as unknown as UserStore;
    const service = new AdminUserCreateService(
      store,
      new UserPropertyService(auth),
      {
        getAuthConfig: () => auth,
        getActionTokenService: () => null,
        getAccountEmailService: () => null,
        emitCode: () => undefined,
      } as never,
    );
    const properties = { department: 'original' };
    const input = {
      username: 'original-user',
      email: 'original@example.test',
      password: 'original-password',
      firstName: 'Original',
      lastName: 'Identity',
      role: 'user',
      sendSetupEmail: false,
      properties,
    };
    const audit: AuthSecurityAuditContext = {
      actor: { userId: 'original-admin', provenance: 'authenticated-request' },
      request: { requestId: 'original-request' },
    };
    const pending = service.create(input, (boundary) => {
      boundaries.push(boundary);
      return { userId: 'original-admin' } as never;
    }, audit);

    await createStarted;
    input.username = 'mutated-user';
    input.email = 'mutated@example.test';
    input.password = 'mutated-password';
    input.role = 'admin';
    properties.department = 'mutated';
    audit.actor.userId = 'mutated-admin';
    audit.request!.requestId = 'mutated-request';
    releaseCreate();

    const result = await pending;
    expect(result.user).toMatchObject({
      username: 'original-user',
      email: 'original@example.test',
      role: 'user',
      properties: { department: 'original' },
    });
    expect(capturedInput).toMatchObject({
      username: 'original-user',
      email: 'original@example.test',
      password: 'original-password',
      role: 'user',
      properties: { department: 'original' },
    });
    expect(capturedAudit).toMatchObject({
      actor: { userId: 'original-admin' },
      request: { requestId: 'original-request' },
    });
    expect(boundaries).toEqual([
      { requestedPlatformRole: 'user' },
      { requestedPlatformRole: 'user' },
    ]);
  });

  test('classifies a rejected provider attempt as delivery failure', async () => {
    const providerFailure = new Error('private provider failure');
    const harness = createSetupHarness({ providerFailure });

    await expect(harness.service.create(
      setupInput(),
      () => ({ userId: 'admin-user' }) as never,
    )).rejects.toBe(providerFailure);

    expect(harness.providerCalls()).toBe(1);
    expect(harness.rollbackCalls()).toBe(1);
    expect(harness.emittedCodes()).toContain(
      OBS_CODES.AUTH_ADMIN_USER_SETUP_DELIVERY_FAILED.code,
    );
    expect(harness.emittedCodes()).not.toContain(
      OBS_CODES.AUTH_ADMIN_USER_PROVISIONING_FAILED.code,
    );
  });

  test('classifies post-delivery finalization failure as provisioning failure', async () => {
    const finalizationFailure = new Error('private finalization failure');
    const harness = createSetupHarness({ finalizationFailure });

    await expect(harness.service.create(
      setupInput(),
      () => ({ userId: 'admin-user' }) as never,
    )).rejects.toBe(finalizationFailure);

    expect(harness.providerCalls()).toBe(1);
    expect(harness.rollbackCalls()).toBe(1);
    expect(harness.emittedCodes()).not.toContain(
      OBS_CODES.AUTH_ADMIN_USER_SETUP_DELIVERY_FAILED.code,
    );
    expect(harness.emitted()).toContainEqual(expect.objectContaining({
      code: OBS_CODES.AUTH_ADMIN_USER_PROVISIONING_FAILED.code,
      metadata: expect.objectContaining({
        phase: 'state-commit',
        cleanupSucceeded: true,
      }),
    }));
  });

  test('does not call the provider when exact setup-token binding fails', async () => {
    const bindingFailure = new Error('private binding failure');
    const harness = createSetupHarness({ bindingFailure });

    await expect(harness.service.create(
      setupInput(),
      () => ({ userId: 'admin-user' }) as never,
    )).rejects.toBe(bindingFailure);

    expect(harness.providerCalls()).toBe(0);
    expect(harness.rollbackCalls()).toBe(1);
    expect(harness.emittedCodes()).not.toContain(
      OBS_CODES.AUTH_ADMIN_USER_SETUP_DELIVERY_FAILED.code,
    );
    expect(harness.emitted()).toContainEqual(expect.objectContaining({
      code: OBS_CODES.AUTH_ADMIN_USER_PROVISIONING_FAILED.code,
      metadata: expect.objectContaining({ phase: 'token-binding' }),
    }));
  });

  test('does not gate an account whose exact state changed during delivery', async () => {
    const commitReadyFailure = new Error('private adopted-account failure');
    const harness = createSetupHarness({ commitReadyFailure });

    await expect(harness.service.create(
      setupInput(),
      () => ({ userId: 'admin-user' }) as never,
    )).rejects.toBe(commitReadyFailure);

    expect(harness.providerCalls()).toBe(1);
    expect(harness.passwordGateCalls()).toBe(0);
    expect(harness.rollbackCalls()).toBe(1);
    expect(harness.emittedCodes()).not.toContain(
      OBS_CODES.AUTH_ADMIN_USER_SETUP_DELIVERY_FAILED.code,
    );
    expect(harness.emitted()).toContainEqual(expect.objectContaining({
      code: OBS_CODES.AUTH_ADMIN_USER_PROVISIONING_FAILED.code,
      metadata: expect.objectContaining({ phase: 'state-commit' }),
    }));
  });
});

function setupInput() {
  return {
    username: 'created-user',
    email: 'created-user@example.test',
    sendSetupEmail: true,
  };
}

function createSetupHarness(failures: {
  providerFailure?: Error;
  bindingFailure?: Error;
  commitReadyFailure?: Error;
  finalizationFailure?: Error;
}) {
  const auth = resolveAuthBehaviorConfig({
    registration: { mode: 'admin-only' },
    accountEmails: { adminCreatedUser: true },
  });
  const user: UserRecord = {
    userId: 'created-user-id',
    username: 'created-user',
    email: 'created-user@example.test',
    firstName: null,
    lastName: null,
    role: 'user',
    status: 'active',
    passwordChangeRequired: false,
    emailVerifiedAt: null,
    emailVerificationRequired: false,
    mfaRequired: false,
    createdAt: 1,
    updatedAt: null,
    properties: {},
  };
  const receipt: AdminUserProvisioningReceipt = {
    provisioningId: 'provisioning-id',
    userId: user.userId,
    leaseToken: 'private-lease-token',
  };
  const events: Array<{
    code: string;
    metadata?: Record<string, unknown>;
  }> = [];
  let providerCalls = 0;
  let passwordGateCalls = 0;
  let rollbackCalls = 0;
  const store = {
    transaction: <T>(operation: () => T) => operation(),
    async createAdminProvisionedUser(
      _input: unknown,
      _audit: unknown,
      beforeInsert: () => void,
    ) {
      beforeInsert();
      return { user, provisioning: receipt };
    },
    getUserById: () => user,
    countActiveAdmins: () => 1,
    appendControlPlaneAudit() {},
    renewAdminUserProvisioningLease: () => 1,
    bindAdminUserProvisioningSetupToken() {
      if (failures.bindingFailure) throw failures.bindingFailure;
    },
    assertAdminUserProvisioningCommitReady() {
      if (failures.commitReadyFailure) throw failures.commitReadyFailure;
    },
    requirePasswordChange() {
      passwordGateCalls += 1;
      return true;
    },
    finalizeAdminUserProvisioning() {
      if (failures.finalizationFailure) throw failures.finalizationFailure;
    },
    rollbackAdminUserProvisioning() {
      rollbackCalls += 1;
      return true;
    },
  } as unknown as UserStore;
  const actionToken = {
    rawToken: 'private-raw-token',
    record: {
      tokenId: 'setup-token-id',
      userId: user.userId,
      type: 'account_setup',
      tokenHash: 'private-token-hash',
      expiresAt: Date.now() + 60_000,
      consumedAt: null,
      createdAt: Date.now(),
      createdBy: 'admin-user',
      metadata: {},
    },
  } as const;
  const service = new AdminUserCreateService(
    store,
    new UserPropertyService(auth),
    {
      getAuthConfig: () => auth,
      getActionTokenService: () => ({
        create: () => actionToken,
        revokeUndelivered: () => true,
      }) as never,
      getAccountEmailService: () => ({
        assertReady() {},
        async sendAccountSetup() {
          providerCalls += 1;
          if (failures.providerFailure) throw failures.providerFailure;
        },
      }) as never,
      emitCode: (
        definition: PlatformCodeDefinition,
        options?: PlatformCodeEmitOptions,
      ) => {
        events.push({ code: definition.code, metadata: options?.metadata });
      },
    } as never,
  );
  return {
    service,
    emitted: () => events,
    emittedCodes: () => events.map((event) => event.code),
    providerCalls: () => providerCalls,
    passwordGateCalls: () => passwordGateCalls,
    rollbackCalls: () => rollbackCalls,
  };
}
