import { expect, test } from 'bun:test';
import { createEmailRuntime, MemoryEmailProvider } from '../email';
import { AccountEmailService } from './account-email-service';
import { resolveAuthBehaviorConfig } from './auth-config';
import type { AuthActionTokenRecord, UserRecord } from './types';

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

function userRecord(): UserRecord {
  return {
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
}

function actionTokenRecord(): AuthActionTokenRecord {
  return {
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
}
