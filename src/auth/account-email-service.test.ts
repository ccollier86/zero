import { expect, test } from 'bun:test';
import { createEmailRuntime, MemoryEmailProvider } from '../email';
import { AccountEmailService } from './account-email-service';
import { resolveAuthBehaviorConfig } from './auth-config';
import type {
  AuthEmailTemplateContext,
  AuthEmailTemplateKey,
  AuthEmailTemplates,
  AuthEmailTemplateUser,
} from './auth-email-templates';
import type { AuthTenantInvitationDelivery } from './auth-tenant-onboarding-types';
import type {
  AuthActionTokenRecord,
  AuthActionTokenType,
  UserRecord,
} from './types';

const tokenBackedEmailScenarios = [
  { key: 'accountSetup', tokenType: 'account_setup' },
  { key: 'passwordReset', tokenType: 'password_reset' },
  { key: 'emailVerification', tokenType: 'email_verification' },
] as const satisfies ReadonlyArray<{
  key: Extract<AuthEmailTemplateKey, 'accountSetup' | 'passwordReset' | 'emailVerification'>;
  tokenType: AuthActionTokenType;
}>;

for (const scenario of tokenBackedEmailScenarios) {
  test(`${scenario.key} retains its entry snapshot across an async app template`, async () => {
    const provider = new MemoryEmailProvider();
    const runtime = createEmailRuntime({
      provider,
      from: 'Zero <noreply@example.test>',
    }, {
      name: 'Zero Test',
      publicUrl: 'https://app.example.test',
    });
    const gate = createGate();
    let templateContext: AuthEmailTemplateContext | undefined;
    const templates: AuthEmailTemplates = {
      [scenario.key]: async (context: AuthEmailTemplateContext) => {
        templateContext = context;
        context.user.email = 'template-mutated@example.test';
        context.user.properties.department = 'template-mutated';
        context.metadata.userId = 'template-mutated-user';
        gate.enter();
        await gate.waitForRelease();
        return {
          subject: context.defaultSubject,
          text: context.defaultText,
          html: context.defaultHtml,
        };
      },
    };
    const service = new AccountEmailService(
      () => runtime,
      resolveAuthBehaviorConfig({
        bootstrap: 'public',
        emails: templates,
      }),
    );
    const originalSignal = new AbortController().signal;
    const user = userRecord();
    user.properties.department = 'original';
    const token = actionTokenRecord({
      tokenId: `action_${scenario.key}`,
      type: scenario.tokenType,
      metadata: { nativeContinuation: validNativeContinuation('a') },
    });
    const params = {
      user,
      rawToken: `raw-${scenario.key}`,
      token,
      deliveryId: `delivery-${scenario.key}`,
      signal: originalSignal,
    };

    const pending = scenario.key === 'accountSetup'
      ? service.sendAccountSetup(params)
      : scenario.key === 'passwordReset'
        ? service.sendPasswordReset(params)
        : service.sendEmailVerification(params);
    await gate.waitForEntry();

    expect(templateContext).toBeDefined();
    expect(Object.isFrozen(templateContext!.user)).toBe(false);
    expect(Object.isFrozen(templateContext!.user.properties)).toBe(false);
    expect(templateContext!.user).not.toBe(user);
    expect(templateContext!.user.properties).not.toBe(user.properties);
    expect(user.email).toBe('user@example.test');
    expect(user.properties.department).toBe('original');

    user.userId = 'caller-mutated-user';
    user.email = 'caller-mutated@example.test';
    user.username = 'caller-mutated';
    user.properties.department = 'caller-mutated';
    token.tokenId = 'caller-mutated-token';
    token.type = 'admin_password_reset';
    token.expiresAt = 1;
    token.metadata.nativeContinuation = validNativeContinuation('b');
    params.user = userRecord({
      userId: 'replacement-user',
      email: 'replacement@example.test',
    });
    params.rawToken = 'caller-mutated-raw-token';
    params.token = actionTokenRecord({
      tokenId: 'replacement-token',
      type: 'admin_password_reset',
    });
    params.deliveryId = 'caller-mutated-delivery';
    params.signal = new AbortController().signal;
    gate.release();

    await expect(pending).resolves.toBeUndefined();
    expect(provider.messages).toHaveLength(1);
    const message = provider.messages[0]!.message;
    expect(message.to).toBe('user@example.test');
    expect(message.text).toContain(`raw-${scenario.key}`);
    expect(message.text).not.toContain('caller-mutated-raw-token');
    expect(message.metadata).toEqual({
      userId: 'user_1',
      tokenType: scenario.tokenType,
    });
    if (scenario.key === 'accountSetup') {
      expect(message.idempotencyKey).toBeUndefined();
      expect(message.signal).toBeUndefined();
    } else {
      expect(message.idempotencyKey).toBe(`delivery-${scenario.key}`);
      expect(message.signal).toBe(originalSignal);
      expect(message.text).toContain(encodeURIComponent(validNativeContinuation('a')));
      expect(message.text).not.toContain(encodeURIComponent(validNativeContinuation('b')));
    }
  });
}

test('normalizes app email-template failures without exposing action credentials', async () => {
  const provider = new MemoryEmailProvider();
  const runtime = createEmailRuntime({
    provider,
    from: 'Zero <noreply@example.test>',
  }, {
    name: 'Zero Test',
    publicUrl: 'https://app.example.test',
  });
  const service = new AccountEmailService(
    () => runtime,
    resolveAuthBehaviorConfig({
      bootstrap: 'public',
      emails: {
        passwordReset(context) {
          throw new Error(`private template failure: ${context.actionUrl}`);
        },
      },
    }),
  );
  const rawToken = 'private-reset-action-token';
  const error = await service.sendPasswordReset({
    user: userRecord(),
    rawToken,
    token: actionTokenRecord(),
  }).catch((value: unknown) => value);

  expect(error).toMatchObject({
    name: 'AuthError',
    code: 'AUTH_EMAIL_TEMPLATE_INVALID',
    status: 500,
    message: 'Auth email template "passwordReset" failed',
  });
  expect(String(error)).not.toContain(rawToken);
  expect(String(error)).not.toContain('user@example.test');
  expect(provider.messages).toHaveLength(0);
});

test('normalizes tenant invitation-template failures without exposing invitation data', async () => {
  const provider = new MemoryEmailProvider();
  const runtime = createEmailRuntime({
    provider,
    from: 'Zero <noreply@example.test>',
  }, {
    name: 'Zero Test',
    publicUrl: 'https://app.example.test',
  });
  const service = new AccountEmailService(
    () => runtime,
    resolveAuthBehaviorConfig({
      bootstrap: 'public',
      tenancy: {
        mode: 'multi',
        onboarding: {
          invitations: {
            delivery: {
              email: {
                enabled: true,
                encryptionKey: Buffer.from(
                  Array.from({ length: 32 }, (_, index) => index),
                ).toString('base64url'),
                template(context) {
                  throw new Error(
                    `private invitation failure: ${context.recipient} ${context.actionUrl}`,
                  );
                },
              },
            },
          },
        },
      },
    }),
  );
  const rawToken = 'private-invitation-token';
  const recipient = 'invitee@example.test';
  const error = await service.sendTenantInvitation({
    delivery: {
      invitationId: 'invitation_1',
      recipient,
      roles: ['member'],
      expiresAt: Date.now() + 60_000,
      tenant: {
        tenantId: 'tenant_1',
        name: 'Private Tenant',
        slug: 'private-tenant',
        kind: 'organization',
      },
    },
    rawToken,
    deliveryId: 'delivery_1',
  }).catch((value: unknown) => value);

  expect(error).toMatchObject({
    name: 'AuthError',
    code: 'AUTH_EMAIL_TEMPLATE_INVALID',
    status: 500,
    message: 'Auth email template "tenantInvitation" failed',
  });
  expect(String(error)).not.toContain(rawToken);
  expect(String(error)).not.toContain(recipient);
  expect(String(error)).not.toContain('Private Tenant');
  expect(provider.messages).toHaveLength(0);
});

test('domain mailbox proof retains caller authority across an async app template', async () => {
  const provider = new MemoryEmailProvider();
  const runtime = createEmailRuntime({
    provider,
    from: 'Zero <noreply@example.test>',
  }, {
    name: 'Zero Test',
    publicUrl: 'https://app.example.test',
  });
  const gate = createGate();
  let templateContext: AuthEmailTemplateContext | undefined;
  const service = new AccountEmailService(
    () => runtime,
    resolveAuthBehaviorConfig({
      bootstrap: 'public',
      tenancy: {
        mode: 'multi',
        onboarding: {
          verifiedDomains: { enabled: true },
        },
      },
      emails: {
        async domainMailboxProof(context) {
          templateContext = context;
          context.user.email = 'template-mutated@example.test';
          context.user.properties.department = 'template-mutated';
          gate.enter();
          await gate.waitForRelease();
          return {
            subject: context.defaultSubject,
            text: context.defaultText,
            html: context.defaultHtml,
          };
        },
      },
    }),
  );
  const originalSignal = new AbortController().signal;
  const originalExpiresAt = Date.now() + 120_000;
  const user = userRecord();
  user.properties.department = 'original';
  const params = {
    user,
    rawToken: 'original-mailbox-token',
    expiresAt: originalExpiresAt,
    deliveryId: 'mailbox-delivery',
    signal: originalSignal,
  };

  const pending = service.sendDomainMailboxProof(params);
  await gate.waitForEntry();

  expect(templateContext).toBeDefined();
  expect(templateContext!.user).not.toBe(user);
  expect(templateContext!.user.properties).not.toBe(user.properties);
  expect(user.email).toBe('user@example.test');
  expect(user.properties.department).toBe('original');
  user.userId = 'caller-mutated-user';
  user.email = 'caller-mutated@example.test';
  user.properties.department = 'caller-mutated';
  params.user = userRecord({ email: 'replacement@example.test' });
  params.rawToken = 'caller-mutated-mailbox-token';
  params.expiresAt = 1;
  params.deliveryId = 'caller-mutated-delivery';
  params.signal = new AbortController().signal;
  gate.release();

  await expect(pending).resolves.toBeUndefined();
  expect(provider.messages).toHaveLength(1);
  const message = provider.messages[0]!.message;
  expect(message.to).toBe('user@example.test');
  expect(message.text).toContain('original-mailbox-token');
  expect(message.text).not.toContain('caller-mutated-mailbox-token');
  expect(message.text).toContain(new Date(originalExpiresAt).toISOString());
  expect(message.metadata).toEqual({
    userId: 'user_1',
    tokenType: 'domain_mailbox_proof',
  });
  expect(message.idempotencyKey).toBe('mailbox-delivery');
  expect(message.signal).toBe(originalSignal);
});

test('tenant invitation snapshots nested delivery input and exposes mutable template clones', async () => {
  const provider = new MemoryEmailProvider();
  const runtime = createEmailRuntime({
    provider,
    from: 'Zero <noreply@example.test>',
  }, {
    name: 'Zero Test',
    publicUrl: 'https://app.example.test',
  });
  const gate = createGate();
  let templateTenant: { tenantId: string; name: string; slug: string } | undefined;
  let templateRoles: readonly string[] | undefined;
  const service = new AccountEmailService(
    () => runtime,
    resolveAuthBehaviorConfig({
      bootstrap: 'public',
      tenancy: {
        mode: 'multi',
        onboarding: {
          invitations: {
            delivery: {
              email: {
                enabled: true,
                encryptionKey: Buffer.from(
                  Array.from({ length: 32 }, (_, index) => index),
                ).toString('base64url'),
                async template(context) {
                  templateTenant = context.tenant;
                  templateRoles = context.invitation.roles;
                  context.tenant.tenantId = 'template-mutated-tenant';
                  context.tenant.name = 'Template Mutated Tenant';
                  context.tenant.slug = 'template-mutated';
                  (context.invitation.roles as string[]).push('template-mutated-role');
                  context.branding.appName = 'Template Mutated App';
                  gate.enter();
                  await gate.waitForRelease();
                  return {
                    subject: context.defaultSubject,
                    text: context.defaultText,
                    html: context.defaultHtml,
                  };
                },
              },
            },
          },
        },
      },
    }),
  );
  const originalSignal = new AbortController().signal;
  const roles = ['member'];
  const delivery: AuthTenantInvitationDelivery = {
    invitationId: 'invitation_1',
    recipient: 'invitee@example.test',
    roles,
    expiresAt: Date.now() + 120_000,
    tenant: {
      tenantId: 'tenant_1',
      name: 'Original Tenant',
      slug: 'original-tenant',
      kind: 'organization',
    },
  };
  const params = {
    delivery,
    rawToken: 'original-invitation-token',
    deliveryId: 'invitation-delivery',
    signal: originalSignal,
  };

  const pending = service.sendTenantInvitation(params);
  await gate.waitForEntry();

  expect(templateTenant).toBeDefined();
  expect(templateRoles).toBeDefined();
  expect(Object.isFrozen(templateTenant)).toBe(false);
  expect(Object.isFrozen(templateRoles)).toBe(false);
  expect(templateTenant).not.toBe(delivery.tenant);
  expect(templateRoles).not.toBe(roles);
  expect(delivery.tenant).toMatchObject({
    tenantId: 'tenant_1',
    name: 'Original Tenant',
    slug: 'original-tenant',
  });
  expect(roles).toEqual(['member']);

  delivery.invitationId = 'caller-mutated-invitation';
  delivery.recipient = 'caller-mutated@example.test';
  (delivery.roles as string[]).push('caller-mutated-role');
  delivery.expiresAt = 1;
  delivery.tenant.tenantId = 'caller-mutated-tenant';
  delivery.tenant.name = 'Caller Mutated Tenant';
  delivery.tenant.slug = 'caller-mutated';
  delivery.tenant.kind = 'administration';
  params.delivery = {
    ...delivery,
    invitationId: 'replacement-invitation',
    recipient: 'replacement@example.test',
  };
  params.rawToken = 'caller-mutated-invitation-token';
  params.deliveryId = 'caller-mutated-delivery';
  params.signal = new AbortController().signal;
  gate.release();

  await expect(pending).resolves.toBeUndefined();
  expect(provider.messages).toHaveLength(1);
  const message = provider.messages[0]!.message;
  expect(message.to).toBe('invitee@example.test');
  expect(message.text).toContain('Original Tenant');
  expect(message.text).toContain('original-invitation-token');
  expect(message.text).not.toContain('caller-mutated-invitation-token');
  expect(message.metadata).toEqual({
    invitationId: 'invitation_1',
    tenantId: 'tenant_1',
  });
  expect(message.idempotencyKey).toBe('invitation-delivery');
  expect(message.signal).toBe(originalSignal);
});

test('email OTP templates receive a mutable clone without changing delivery authority', async () => {
  const provider = new MemoryEmailProvider();
  const runtime = createEmailRuntime({
    provider,
    from: 'Zero <noreply@example.test>',
  }, {
    name: 'Zero Test',
    publicUrl: 'https://app.example.test',
  });
  const templateUsers: AuthEmailTemplateUser[] = [];
  const templateCodes: Array<string | undefined> = [];
  const service = new AccountEmailService(
    () => runtime,
    resolveAuthBehaviorConfig({
      bootstrap: 'public',
      emails: {
        async emailOtp(context) {
          templateUsers.push(context.user);
          templateCodes.push(context.code);
          context.user.email = 'template-mutated@example.test';
          context.user.properties.department = 'template-mutated';
          await Promise.resolve();
          return {
            subject: 'Your verification code',
            text: `Code for ${context.user.email}`,
          };
        },
      },
    }),
  );
  const user = userRecord();
  user.properties.department = 'original';

  await expect(service.sendEmailOtp({
    user,
    code: '123456',
    expiresAt: Date.now() + 60_000,
    purpose: 'login',
  })).resolves.toBeUndefined();

  expect(templateUsers).toHaveLength(1);
  expect(Object.isFrozen(templateUsers[0])).toBe(false);
  expect(Object.isFrozen(templateUsers[0]!.properties)).toBe(false);
  expect(templateUsers[0]).not.toBe(user);
  expect(templateUsers[0]!.properties).not.toBe(user.properties);
  expect(templateCodes).toEqual(['123456']);
  expect(user).toMatchObject({
    email: 'user@example.test',
    properties: { department: 'original' },
  });
  expect(provider.messages).toHaveLength(1);
  expect(provider.messages[0]!.message.to).toBe('user@example.test');
});

function userRecord(overrides: Partial<UserRecord> = {}): UserRecord {
  const user: UserRecord = {
    userId: 'user_1',
    username: 'template-user',
    email: 'user@example.test',
    firstName: null,
    lastName: null,
    role: 'user',
    status: 'active',
    passwordChangeRequired: false,
    emailVerifiedAt: Date.now(),
    emailVerificationRequired: false,
    mfaRequired: false,
    createdAt: Date.now(),
    updatedAt: null,
    properties: {},
  };
  return {
    ...user,
    ...overrides,
    properties: { ...user.properties, ...overrides.properties },
  };
}

function actionTokenRecord(
  overrides: Partial<AuthActionTokenRecord> = {},
): AuthActionTokenRecord {
  const token: AuthActionTokenRecord = {
    tokenId: 'action_1',
    userId: 'user_1',
    type: 'password_reset',
    tokenHash: 'hash',
    expiresAt: Date.now() + 60_000,
    consumedAt: null,
    createdAt: Date.now(),
    createdBy: null,
    metadata: {},
  };
  return {
    ...token,
    ...overrides,
    metadata: { ...token.metadata, ...overrides.metadata },
  };
}

function validNativeContinuation(fill: string): string {
  return `/auth/oauth/authorize?request_id=${fill.repeat(43)}`;
}

function createGate(): {
  enter(): void;
  waitForEntry(): Promise<void>;
  release(): void;
  waitForRelease(): Promise<void>;
} {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    enter,
    waitForEntry: () => entered,
    release,
    waitForRelease: () => released,
  };
}
