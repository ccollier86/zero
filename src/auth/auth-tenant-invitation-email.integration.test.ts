import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia, type AnyElysia } from 'elysia';
import {
  configureEmail,
  MemoryEmailProvider,
  type EmailMessage,
  type EmailProvider,
  type EmailSendResult,
} from '../email';
import { OBS_CODES } from '../observability/codes';
import { resetEmailCompatibilityRuntimeForTesting } from '../email/runtime';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import type { AuthRuntime } from './auth-runtime';
import { createAuthPlugin } from './auth.plugin';
import { AuthTenantInvitationEnvelope } from './auth-tenant-invitation-envelope';

interface Harness {
  app: AnyElysia;
  db: ReactiveDB;
  runtime: AuthRuntime;
  url: string;
  ownerToken: string;
}

const active: Harness[] = [];
const ENCRYPTION_KEY = Buffer.from(
  Array.from({ length: 32 }, (_, index) => index + 7),
).toString('base64url');
const WRONG_ENCRYPTION_KEY = Buffer.from(
  Array.from({ length: 32 }, (_, index) => 255 - index),
).toString('base64url');

afterEach(async () => {
  for (const harness of active.splice(0).reverse()) {
    await harness.app.stop();
    harness.db.dispose();
  }
  resetEmailCompatibilityRuntimeForTesting();
});

describe('tenant invitation durable email delivery', () => {
  test('queues no plaintext, renders the configured landing link, and scrubs delivery state', async () => {
    const provider = new MemoryEmailProvider();
    const harness = await start(provider, { publicUrl: 'https://zero.example' });

    const issued = await request(harness, 'POST', '/auth/tenant/invitations', {
      email: 'invited@example.test',
      roles: ['administrator'],
    }, harness.ownerToken);
    expect(issued).toMatchObject({
      status: 200,
      body: {
        invitation: { email: 'invited@example.test', status: 'pending' },
        delivery: { mode: 'email', status: 'queued' },
      },
    });
    expect(issued.body.token).toBeUndefined();

    const queued = harness.db.prepare(`
      SELECT recipient, secret_envelope, invitation_id
      FROM _auth_email_outbox WHERE kind = 'tenant_invitation'
    `).get() as {
      recipient: string;
      secret_envelope: string;
      invitation_id: string;
    };
    expect(queued.recipient).toBe('invited@example.test');
    expect(queued.invitation_id).toBe(issued.body.invitation.invitationId);
    expect(queued.secret_envelope).toStartWith('v1.');
    expect(JSON.stringify(harness.db.prepare(`
      SELECT token_hash FROM _auth_tenant_invitations WHERE invitation_id = ?
    `).get(queued.invitation_id))).not.toContain('zinv_');
    const keyring = harness.db.prepare(`
      SELECT value FROM _auth_config
      WHERE key = 'auth.tenant_invitation.envelope_keys'
    `).get() as { value: string };
    expect(keyring.value).toContain('wrappedKey');
    expect(keyring.value).not.toContain(ENCRYPTION_KEY);
    expect(() => new AuthTenantInvitationEnvelope(
      harness.db,
      WRONG_ENCRYPTION_KEY,
    )).toThrow('previousEncryptionKeys');

    harness.runtime.getAuthEmailOutbox()!.start(false);
    expect(await harness.runtime.getAuthEmailOutbox()!.processDue()).toBe(1);
    expect(provider.messages).toHaveLength(1);
    const message = provider.messages[0]!.message;
    expect(message.subject).toBe(
      'Custom administration invitation for Owner organization',
    );
    expect(message.text).toContain(
      'https://zero.example/join-us?token=zinv_',
    );
    expect(message.idempotencyKey).toMatch(/^aem_/);
    const rawToken = message.text.match(/token=(zinv_[A-Za-z0-9_-]+)/)?.[1];
    expect(rawToken).toBeString();
    expect(queued.secret_envelope).not.toContain(rawToken!);
    expect(keyring.value).not.toContain(rawToken!);

    expect(harness.db.prepare(`
      SELECT status, recipient, secret_envelope FROM _auth_email_outbox
      WHERE invitation_id = ?
    `).get(queued.invitation_id)).toEqual({
      status: 'delivered',
      recipient: '',
      secret_envelope: null,
    });
  }, 60_000);

  test('fails before issuance when email or app publicUrl cannot build the invitation', async () => {
    const provider = new MemoryEmailProvider();
    const harness = await start(provider, {});
    const issued = await request(harness, 'POST', '/auth/tenant/invitations', {
      email: 'unreachable@example.test',
      roles: ['administrator'],
    }, harness.ownerToken);
    expect(issued).toMatchObject({
      status: 500,
      body: { code: 'EMAIL_PUBLIC_URL_REQUIRED' },
    });
    expect(count(harness.db, '_auth_tenant_invitations')).toBe(0);
    expect(count(harness.db, '_auth_email_outbox')).toBe(0);
  }, 60_000);

  test('publishes invitation queue success and wakes its worker only after outer commit', async () => {
    const provider = new MemoryEmailProvider();
    const harness = await start(provider, { publicUrl: 'https://zero.example' });
    const outbox = harness.runtime.getAuthEmailOutbox()!;
    const internals = outbox as unknown as {
      emitCode: AuthPlatformCodeEmitter;
      worker: { wake(): void };
    };
    const originalEmitCode = internals.emitCode;
    const originalWake = internals.worker.wake.bind(internals.worker);
    const onboarding = harness.runtime.getTenantOnboardingService()!;
    const originalIssue = onboarding.issueInvitation.bind(onboarding);
    const invitationService = onboarding as unknown as {
      issueInvitation: typeof originalIssue;
    };
    const emittedCodes: string[] = [];
    let wakes = 0;
    internals.emitCode = (definition, options) => {
      emittedCodes.push(definition.code);
      return originalEmitCode(definition, options);
    };
    internals.worker.wake = () => { wakes += 1; };

    try {
      invitationService.issueInvitation = (input) => harness.db.transaction(() => {
        originalIssue(input);
        throw new Error('rollback after invitation enqueue');
      });

      const rolledBack = await request(harness, 'POST', '/auth/tenant/invitations', {
        email: 'rolled-back@example.test',
        roles: ['administrator'],
      }, harness.ownerToken);
      expect(rolledBack.status).toBe(500);
      expect(count(harness.db, '_auth_tenant_invitations')).toBe(0);
      expect(count(harness.db, '_auth_email_outbox')).toBe(0);
      expect(emittedCodes.filter(
        (code) => code === OBS_CODES.AUTH_EMAIL_OUTBOX_ENQUEUED.code,
      )).toHaveLength(0);
      expect(wakes).toBe(0);

      invitationService.issueInvitation = originalIssue;
      const committed = await request(harness, 'POST', '/auth/tenant/invitations', {
        email: 'committed@example.test',
        roles: ['administrator'],
      }, harness.ownerToken);
      expect(committed.status).toBe(200);
      expect(count(harness.db, '_auth_tenant_invitations')).toBe(1);
      expect(count(harness.db, '_auth_email_outbox')).toBe(1);
      expect(emittedCodes.filter(
        (code) => code === OBS_CODES.AUTH_EMAIL_OUTBOX_ENQUEUED.code,
      )).toHaveLength(1);
      expect(wakes).toBe(1);
    } finally {
      invitationService.issueInvitation = originalIssue;
      internals.emitCode = originalEmitCode;
      internals.worker.wake = originalWake;
    }
  }, 60_000);

  test('retries with one stable provider idempotency key and no duplicate delivery', async () => {
    const provider = new AckLostProvider();
    const harness = await start(provider, { publicUrl: 'https://zero.example' });
    const issued = await request(harness, 'POST', '/auth/tenant/invitations', {
      email: 'retry@example.test',
      roles: ['administrator'],
    }, harness.ownerToken);
    expect(issued.status).toBe(200);

    const outbox = harness.runtime.getAuthEmailOutbox()!;
    outbox.start(false);
    expect(await outbox.processDue()).toBe(1);
    expect(provider.calls).toHaveLength(1);
    expect(provider.deliveries.size).toBe(1);
    expect(harness.db.prepare(`
      SELECT status, attempts FROM _auth_email_outbox
      WHERE invitation_id = ?
    `).get(issued.body.invitation.invitationId)).toEqual({
      status: 'pending',
      attempts: 1,
    });
    harness.db.prepare(`
      UPDATE _auth_email_outbox SET available_at = 0
      WHERE invitation_id = ?
    `).run(issued.body.invitation.invitationId);
    expect(await outbox.processDue()).toBe(1);
    expect(provider.calls).toHaveLength(2);
    expect(new Set(provider.calls).size).toBe(1);
    expect(provider.deliveries.size).toBe(1);
    expect(outbox.count('delivered')).toBe(1);
  }, 60_000);

  test('suppresses a revoked queued invite and revokes an invite on terminal delivery failure', async () => {
    const provider = new RejectingProvider();
    const harness = await start(provider, { publicUrl: 'https://zero.example' });
    const revokedIssue = await request(harness, 'POST', '/auth/tenant/invitations', {
      email: 'revoked@example.test',
      roles: ['administrator'],
    }, harness.ownerToken);
    expect((await request(
      harness,
      'DELETE',
      `/auth/tenant/invitations/${revokedIssue.body.invitation.invitationId}`,
      undefined,
      harness.ownerToken,
    )).status).toBe(200);
    const outbox = harness.runtime.getAuthEmailOutbox()!;
    outbox.start(false);
    expect(await outbox.processDue()).toBe(1);
    expect(provider.calls).toBe(0);
    expect(harness.db.prepare(`
      SELECT status, secret_envelope FROM _auth_email_outbox
      WHERE invitation_id = ?
    `).get(revokedIssue.body.invitation.invitationId)).toEqual({
      status: 'suppressed',
      secret_envelope: null,
    });
    await outbox.stop();

    const failedIssue = await request(harness, 'POST', '/auth/tenant/invitations', {
      email: 'rejected@example.test',
      roles: ['administrator'],
    }, harness.ownerToken);
    expect(failedIssue.status).toBe(200);
    outbox.start(false);
    expect(await outbox.processDue()).toBe(1);
    expect(provider.calls).toBe(1);
    expect(harness.db.prepare(`
      SELECT status, secret_envelope, last_error_code FROM _auth_email_outbox
      WHERE invitation_id = ?
    `).get(failedIssue.body.invitation.invitationId)).toEqual({
      status: 'dead',
      secret_envelope: null,
      last_error_code: 'EMAIL_DELIVERY_REJECTED',
    });
    expect(harness.db.prepare(`
      SELECT status FROM _auth_tenant_invitations WHERE invitation_id = ?
    `).get(failedIssue.body.invitation.invitationId)).toEqual({ status: 'revoked' });
  }, 60_000);
});

class AckLostProvider implements EmailProvider {
  readonly name = 'ack-lost-test';
  readonly calls: string[] = [];
  readonly deliveries = new Map<string, EmailMessage>();

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const key = message.idempotencyKey ?? '';
    this.calls.push(key);
    const alreadyDelivered = this.deliveries.has(key);
    if (!alreadyDelivered) this.deliveries.set(key, message);
    if (this.calls.length === 1) throw new Error('provider acknowledgement lost');
    return { provider: this.name, accepted: recipients(message) };
  }
}

class RejectingProvider implements EmailProvider {
  readonly name = 'rejecting-test';
  calls = 0;

  async send(message: EmailMessage): Promise<EmailSendResult> {
    this.calls += 1;
    return {
      provider: this.name,
      accepted: [],
      rejected: recipients(message),
    };
  }
}

async function start(
  provider: EmailProvider,
  appIdentity: { publicUrl?: string },
): Promise<Harness> {
  configureEmail(
    { from: 'Zero <noreply@zero.example>', provider },
    { name: 'Zero Test', ...appIdentity },
  );
  const db = createReactiveDB({ mode: 'memory' });
  let runtime: AuthRuntime | null = null;
  const app = new Elysia().use(createAuthPlugin({
    db,
    tenancy: {
      mode: 'multi',
      onboarding: {
        invitations: {
          delivery: {
            email: {
              enabled: true,
              landingPath: '/join-us',
              encryptionKey: ENCRYPTION_KEY,
              template: (context) => ({
                subject: `Custom ${context.tenant.kind} invitation for ${context.tenant.name}`,
                text: context.actionUrl,
              }),
            },
          },
        },
      },
    },
    authorization: 'simple',
    bootstrap: 'public',
    registration: { mode: 'disabled' },
    onRuntimeCreated(created) { runtime = created; },
  }));
  app.listen(0);
  const resolved = runtime as AuthRuntime | null;
  if (!resolved) throw new Error('Auth runtime was not created');
  const harness = {
    app,
    db,
    runtime: resolved,
    url: `http://localhost:${app.server!.port}`,
    ownerToken: '',
  };
  const deadline = Date.now() + 2_000;
  while (!resolved.getStore() || !resolved.getAuthEmailOutbox()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for auth runtime');
    await Bun.sleep(5);
  }
  // These tests drive the durable queue deterministically.
  await resolved.getAuthEmailOutbox()!.stop();
  const bootstrap = await request(harness, 'POST', '/auth/register', {
    username: 'owner',
    email: 'owner@example.test',
    password: 'password123',
    organizationName: 'Owner organization',
  });
  if (bootstrap.status !== 200) {
    throw new Error(`Bootstrap failed: ${JSON.stringify(bootstrap.body)}`);
  }
  harness.ownerToken = bootstrap.body.accessToken;
  active.push(harness);
  return harness;
}

async function request(
  harness: Pick<Harness, 'url'>,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  bearer?: string,
) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const response = await fetch(`${harness.url}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, any>,
  };
}

function recipients(message: EmailMessage): string[] {
  return Array.isArray(message.to) ? message.to : [message.to];
}

function count(db: ReactiveDB, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
}
