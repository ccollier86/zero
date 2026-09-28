import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia, type AnyElysia } from 'elysia';

import { configureEmail, MemoryEmailProvider } from '../email';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import type { AuthRuntime } from './auth-runtime';
import { createAuthPlugin } from './auth.plugin';

interface Harness {
  app: AnyElysia;
  db: ReactiveDB;
  runtime: AuthRuntime;
  provider: MemoryEmailProvider;
  url: string;
  txtAnswers: readonly (readonly string[])[];
}

const active: Harness[] = [];

afterEach(async () => {
  for (const harness of active.splice(0).reverse()) {
    await harness.app.stop();
    harness.db.dispose();
  }
  configureEmail(false);
});

describe('verified-domain Elysia integration', () => {
  test('matches the browser DTO through DNS, email proof, and retained admission', async () => {
    const harness = await start();
    const owner = await json(harness, 'POST', '/auth/register', {
      username: 'owner',
      email: 'owner@platform.com',
      password: 'password123',
      organizationName: 'Acme',
    });
    expect(owner.status).toBe(200);
    const accessToken = String(owner.body.accessToken);

    const publicConfig = await json(harness, 'GET', '/auth/config');
    expect(publicConfig.body.tenancy.onboarding.verifiedDomains).toEqual({
      enabled: true,
      admission: 'request-to-join',
    });
    const administration = await json(
      harness,
      'GET',
      '/auth/tenant/domains',
      undefined,
      accessToken,
    );
    expect(administration.status).toBe(200);
    expect(administration.body).toMatchObject({
      actor: {
        capabilities: {
          canReadDomains: true,
          canCreateDomains: true,
          canVerifyDomains: true,
          canManagePolicy: true,
          canReleaseDomains: true,
        },
      },
      requestRoles: [{ key: 'member' }],
      claims: [],
    });

    const created = await json(
      harness,
      'POST',
      '/auth/tenant/domains',
      { domain: 'ACME.COM.' },
      accessToken,
    );
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      claim: { domain: 'acme.com', status: 'pending' },
      challenge: {
        recordType: 'TXT',
        name: '_zero-domain-verification.acme.com',
      },
    });
    harness.txtAnswers = [[created.body.challenge.value]];
    const verified = await json(
      harness,
      'POST',
      `/auth/tenant/domains/${created.body.claim.claimId}/verify`,
      { expectedRevision: created.body.claim.revision },
      accessToken,
    );
    expect(verified.status).toBe(200);
    expect(verified.body.claim.status).toBe('verified');
    const policy = await json(
      harness,
      'PATCH',
      `/auth/tenant/domains/${created.body.claim.claimId}/policy`,
      {
        enabled: true,
        requestRoleKey: 'member',
        expectedRevision: verified.body.claim.policy.revision,
      },
      accessToken,
    );
    expect(policy.status).toBe(200);
    expect(policy.body.claim.policy).toMatchObject({
      enabled: true,
      admission: 'request-to-join',
      requestRoleKey: 'member',
    });

    const applicant = await json(harness, 'POST', '/auth/register', {
      username: 'applicant',
      email: 'person@acme.com',
      password: 'password123',
    });
    expect(applicant.status).toBe(200);
    const identityContinuation = applicant.body.onboarding.continuation as string;
    expect(identityContinuation).toBeString();

    const genericInvalid = await json(
      harness,
      'POST',
      '/auth/onboarding/domain/start',
      { identityContinuation: 'zct_invalid-but-well-shaped' },
    );
    expect(genericInvalid).toMatchObject({ status: 200, body: { accepted: true } });
    expect(harness.provider.messages).toHaveLength(0);

    const started = await json(harness, 'POST', '/auth/onboarding/domain/start', {
      identityContinuation,
    });
    expect(started).toMatchObject({ status: 200, body: { accepted: true } });
    await waitFor(() => harness.provider.messages.length === 1);
    const message = harness.provider.messages[0]!.message;
    expect(message.idempotencyKey).toMatch(/^aem_.+:1$/);
    expect(message.text).not.toContain(identityContinuation);
    const proofToken = proofTokenFromEmail(message.text);

    const completed = await json(harness, 'POST', '/auth/onboarding/domain/complete', {
      proofToken,
    });
    expect(completed.status).toBe(200);
    expect(completed.body).toMatchObject({
      option: { action: 'request-to-join', tenant: { name: 'Acme', slug: 'acme' } },
    });
    expect(completed.body.option).not.toHaveProperty('tenantId');
    expect(completed.body).not.toHaveProperty('domain');
    expect(completed.body).not.toHaveProperty('role');

    const admitted = await json(harness, 'POST', '/auth/onboarding/domain/admit', {
      continuation: completed.body.continuation,
      identityContinuation,
    });
    expect(admitted.status).toBe(202);
    expect(admitted.body.request).toMatchObject({
      status: 'pending',
      tenant: { name: 'Acme', slug: 'acme' },
    });
    expect(admitted.body.request).not.toHaveProperty('role');
    expect(rowCount(harness.db, '_auth_domain_join_request_provenance')).toBe(1);
    const review = await json(
      harness,
      'GET',
      '/auth/tenant/join-requests?status=pending',
      undefined,
      accessToken,
    );
    expect(review.status).toBe(200);
    expect(review.body.requests).toHaveLength(1);
    expect(review.body.requests[0]).toMatchObject({
      joinRequestId: admitted.body.request.joinRequestId,
      approvalPolicy: {
        canApprove: true,
        roleSelection: {
          mode: 'fixed',
          roles: [{ key: 'member', label: 'Member' }],
        },
      },
    });

    const replay = await json(harness, 'POST', '/auth/onboarding/domain/admit', {
      continuation: completed.body.continuation,
      identityContinuation,
    });
    expect(replay.status).toBe(400);
    expect(replay.body.code).toBe('AUTH_DOMAIN_ONBOARDING_PROOF_INVALID');

    const confirmationMismatch = await json(
      harness,
      'POST',
      `/auth/tenant/domains/${created.body.claim.claimId}/release`,
      {
        expectedRevision: policy.body.claim.revision,
        expectedPolicyRevision: policy.body.claim.policy.revision,
        confirmDomain: 'ACME.COM',
      },
      accessToken,
    );
    expect(confirmationMismatch.status).toBe(422);
    expect(confirmationMismatch.body.code)
      .toBe('AUTH_DOMAIN_RELEASE_CONFIRMATION_MISMATCH');

    const released = await json(
      harness,
      'POST',
      `/auth/tenant/domains/${created.body.claim.claimId}/release`,
      {
        expectedRevision: policy.body.claim.revision,
        expectedPolicyRevision: policy.body.claim.policy.revision,
        confirmDomain: 'acme.com',
      },
      accessToken,
    );
    expect(released.status).toBe(200);
    expect(released.body.release).toMatchObject({
      claimId: created.body.claim.claimId,
      domain: 'acme.com',
    });
    expect(released.body.release.quarantineUntil)
      .toBe(released.body.release.releasedAt + 7 * 86_400_000);
    const afterRelease = await json(
      harness,
      'GET',
      '/auth/tenant/domains',
      undefined,
      accessToken,
    );
    expect(afterRelease.body.claims).toEqual([]);
    expect(harness.db.prepare(`SELECT status FROM _auth_tenant_join_requests
      WHERE join_request_id = ?`).get(admitted.body.request.joinRequestId)).toEqual({
      status: 'cancelled',
    });
    expect(rowCount(harness.db, '_auth_domain_join_request_provenance')).toBe(1);

    const reclaimed = await json(
      harness,
      'POST',
      '/auth/tenant/domains',
      { domain: 'acme.com' },
      accessToken,
    );
    expect(reclaimed.status).toBe(200);
    expect(reclaimed.body.claim.claimId).not.toBe(created.body.claim.claimId);
    expect(reclaimed.body.claim.status).toBe('pending');
  }, 60_000);

  test('withholds the public capability when email delivery is not operational', async () => {
    configureEmail(false);
    const db = createReactiveDB({ mode: 'memory' });
    let runtime: AuthRuntime | null = null;
    const app = new Elysia().use(createAuthPlugin({
      db,
      tenancy: {
        mode: 'multi',
        onboarding: { verifiedDomains: { enabled: true } },
      },
      onRuntimeCreated(value) { runtime = value; },
    }));
    app.listen(0);
    const createdRuntime = runtime as AuthRuntime | null;
    if (!createdRuntime) throw new Error('Auth runtime unavailable');
    const harness: Harness = {
      app,
      db,
      runtime: createdRuntime,
      provider: new MemoryEmailProvider(),
      url: `http://localhost:${app.server!.port}`,
      txtAnswers: [],
    };
    active.push(harness);
    await waitFor(() => Boolean(createdRuntime.getStore()));
    const result = await json(harness, 'GET', '/auth/config');
    expect(result.status).toBe(200);
    expect(result.body.tenancy.onboarding).not.toHaveProperty('verifiedDomains');
  });
});

async function start(): Promise<Harness> {
  const provider = new MemoryEmailProvider();
  configureEmail({
    from: 'Zero <zero@example.test>',
    provider,
  }, {
    name: 'Zero',
    publicUrl: 'https://app.example.test',
  });
  const db = createReactiveDB({ mode: 'memory' });
  let runtime: AuthRuntime | null = null;
  const harness = {
    db,
    provider,
    txtAnswers: [] as readonly (readonly string[])[],
  };
  const app = new Elysia().use(createAuthPlugin({
    db,
    bootstrap: 'public',
    registration: { mode: 'public' },
    tenancy: {
      mode: 'multi',
      onboarding: {
        verifiedDomains: {
          enabled: true,
          resolveTxt: async () => harness.txtAnswers,
        },
      },
    },
    onRuntimeCreated(value) { runtime = value; },
  }));
  app.listen(0);
  const createdRuntime = runtime as AuthRuntime | null;
  if (!createdRuntime) throw new Error('Auth runtime unavailable');
  const complete = Object.assign(harness, {
    app,
    runtime: createdRuntime,
    url: `http://localhost:${app.server!.port}`,
  });
  active.push(complete);
  await waitFor(() => Boolean(createdRuntime.getStore() && createdRuntime.getAuthEmailOutbox()));
  return complete;
}

async function json(
  harness: Harness,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  accessToken?: string,
) {
  const response = await fetch(`${harness.url}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}

function proofTokenFromEmail(text: string): string {
  const match = /https:\/\/app\.example\.test\/domain-onboarding\?token=([^\s]+)/.exec(text);
  if (!match?.[1]) throw new Error('Domain mailbox email did not contain a proof token');
  return decodeURIComponent(match[1]);
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for auth runtime work');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function rowCount(db: ReactiveDB, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  }).count;
}
