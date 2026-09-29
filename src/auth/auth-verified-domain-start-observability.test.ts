import { describe, expect, test } from 'bun:test';
import { Elysia, type AnyElysia } from 'elysia';
import {
  emitPlatformCodeTo,
  MemoryEventStore,
  OBS_CODES,
} from '../observability';
import type { PlatformObservabilityRuntime } from '../observability/types';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import {
  createAuthVerifiedDomainPlugin,
  type AuthVerifiedDomainPluginConfig,
} from './auth-verified-domain.plugin';

const PUBLIC_CONTINUATION = 'zct_private-continuation-value';
const PRIVATE_EMAIL = 'person@private-company.test';

describe('verified-domain onboarding start observability', () => {
  const failures = [
    {
      name: 'profile preparation',
      setup: (error: Error) => ({
        prepareMailboxRequest: () => { throw error; },
      }),
    },
    {
      name: 'email readiness',
      setup: (error: Error) => ({
        assertEmailReady: () => { throw error; },
      }),
    },
    {
      name: 'outbox enqueue',
      setup: (error: Error) => ({
        enqueue: () => { throw error; },
      }),
    },
  ] as const;

  for (const failure of failures) {
    test(`suppresses ${failure.name} failures publicly and emits the internal error`, async () => {
      const error = new Error(`${failure.name} failed internally`);
      const harness = createHarness(failure.setup(error));

      expect(await startDomainOnboarding(harness.app)).toEqual({
        status: 200,
        body: { accepted: true },
      });

      const events = failureEvents(harness.events);
      expect(events).toHaveLength(1);
      expect(events[0]!.error).toBe(error);
      expectSafeEventSurface(events[0]!);
    });
  }

  test('treats missing email and outbox dependencies as observable operational failures', async () => {
    for (const missing of ['email', 'outbox'] as const) {
      const harness = createHarness({
        accountEmailService: missing === 'email' ? null : undefined,
        outbox: missing === 'outbox' ? null : undefined,
      });

      expect(await startDomainOnboarding(harness.app)).toEqual({
        status: 200,
        body: { accepted: true },
      });

      const events = failureEvents(harness.events);
      expect(events).toHaveLength(1);
      expect(events[0]!.error).toBeInstanceOf(Error);
      expectSafeEventSurface(events[0]!);
    }
  });

  test('treats a missing verified-domain service after identity resolution as operational', async () => {
    const harness = createHarness({ service: null });

    expect(await startDomainOnboarding(harness.app)).toEqual({
      status: 200,
      body: { accepted: true },
    });

    const events = failureEvents(harness.events);
    expect(events).toHaveLength(1);
    expect(events[0]!.error).toBeInstanceOf(Error);
    expectSafeEventSurface(events[0]!);
  });

  test('does not emit for invalid or ineligible identities', async () => {
    const invalid = createHarness({ inspectContinuation: () => null });
    expect(await startDomainOnboarding(invalid.app)).toEqual({
      status: 200,
      body: { accepted: true },
    });
    expect(failureEvents(invalid.events)).toHaveLength(0);

    const ineligible = createHarness({ prepareMailboxRequest: () => null });
    expect(await startDomainOnboarding(ineligible.app)).toEqual({
      status: 200,
      body: { accepted: true },
    });
    expect(failureEvents(ineligible.events)).toHaveLength(0);
  });

  test('threads exact continuation authority into the durable enqueue boundary', async () => {
    let authGeneration = 1;
    let enqueueCalls = 0;
    const harness = createHarness({
      userStore: {
        getAuthGeneration: () => authGeneration,
      },
      enqueue: (_binding: unknown, admit: () => boolean) => {
        enqueueCalls += 1;
        authGeneration += 1;
        expect(admit()).toBe(false);
        return 'enqueued';
      },
    });

    expect(await startDomainOnboarding(harness.app)).toEqual({
      status: 200,
      body: { accepted: true },
    });
    expect(enqueueCalls).toBe(1);
  });
});

interface HarnessOverrides {
  service?: object | null;
  accountEmailService?: object | null;
  outbox?: object | null;
  userStore?: object | null;
  inspectContinuation?: () => object | null;
  prepareMailboxRequest?: () => object | null;
  assertEmailReady?: () => void;
  enqueue?: (binding: unknown, admit: () => boolean) => unknown;
}

function createHarness(overrides: HarnessOverrides = {}) {
  const events = new MemoryEventStore();
  const observability: PlatformObservabilityRuntime = {
    sink: events,
    store: events,
    config: { console: false },
  };
  const emitCode: AuthPlatformCodeEmitter = (definition, options) => (
    emitPlatformCodeTo(observability, definition, options)
  );
  const continuation = {
    continuationId: 'actc_private-record-id',
    applicationId: 'app_private-id',
    userId: 'usr_private-id',
    purpose: 'tenant_onboarding',
    authGeneration: 1,
    mfaVerifiedAt: null,
    expiresAt: Date.now() + 60_000,
    consumedAt: null,
    createdAt: Date.now(),
  };
  const binding = {
    userId: continuation.userId,
    email: PRIVATE_EMAIL,
    emailGeneration: 1,
    authGeneration: continuation.authGeneration,
    identityKind: 'continuation',
    identityContinuationId: continuation.continuationId,
  };
  const service = overrides.service === null
    ? null
    : overrides.service ?? {
        prepareMailboxRequest: overrides.prepareMailboxRequest ?? (() => binding),
      };
  const accountEmailService = overrides.accountEmailService === null
    ? null
    : overrides.accountEmailService ?? {
        assertReady: overrides.assertEmailReady ?? (() => {}),
      };
  const outbox = overrides.outbox === null
    ? null
    : overrides.outbox ?? {
        enqueueDomainMailboxProof: overrides.enqueue ?? (() => 'enqueued'),
      };
  const config = {
    getService: () => service,
    getUserStore: () => overrides.userStore ?? null,
    getTokenService: () => null,
    getTenantSessionService: () => ({
      continuations: {
        inspect: overrides.inspectContinuation ?? (() => continuation),
      },
    }),
    getRequestAdmissionService: () => null,
    getAuthorizationKernel: () => null,
    getAuthorizationRoleService: () => null,
    getAccountEmailService: () => accountEmailService,
    getAuthEmailOutbox: () => outbox,
    emitCode,
  } as unknown as AuthVerifiedDomainPluginConfig;
  return {
    app: new Elysia().use(createAuthVerifiedDomainPlugin(config)),
    events,
  };
}

async function startDomainOnboarding(app: AnyElysia) {
  const response = await app.handle(new Request(
    'http://localhost/onboarding/domain/start',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identityContinuation: PUBLIC_CONTINUATION }),
    },
  ));
  return {
    status: response.status,
    body: await response.json(),
  };
}

function failureEvents(events: MemoryEventStore) {
  return events.query({ code: OBS_CODES.AUTH_DOMAIN_START_FAILED.code }).events;
}

function expectSafeEventSurface(event: {
  message: string;
  metadata?: Record<string, unknown>;
}) {
  expect(event.message).toBe(OBS_CODES.AUTH_DOMAIN_START_FAILED.message);
  expect(event.metadata).toBeUndefined();
  const publicSurface = JSON.stringify({
    message: event.message,
    metadata: event.metadata,
  });
  expect(publicSurface).not.toContain(PUBLIC_CONTINUATION);
  expect(publicSurface).not.toContain(PRIVATE_EMAIL);
  expect(publicSurface).not.toContain('private-company.test');
}
