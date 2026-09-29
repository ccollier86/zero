import { afterEach, describe, expect, test } from 'bun:test';

import { OBS_CODES } from '../observability/codes';
import type {
  PlatformCodeDefinition,
  PlatformCodeEmitOptions,
} from '../observability/types';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { AuthEmailOutbox } from './auth-email-outbox';
import type { AuthEmailEnqueueResult } from './auth-email-outbox-store';
import type { AuthEmailOutboxKind } from './auth-email-outbox-types';

interface CapturedEmission {
  definition: PlatformCodeDefinition;
  options: PlatformCodeEmitOptions | undefined;
}

interface TransactionHarness {
  db: ReactiveDB;
  outbox: AuthEmailOutbox;
  events: CapturedEmission[];
  wakeCount(): number;
}

interface EnqueueScenario {
  name: string;
  kind: AuthEmailOutboxKind;
  enqueue(outbox: AuthEmailOutbox): AuthEmailEnqueueResult;
}

const databases: ReactiveDB[] = [];

afterEach(() => {
  for (const db of databases.splice(0).reverse()) db.dispose();
});

const scenarios: EnqueueScenario[] = [
  {
    name: 'account link',
    kind: 'password_reset',
    enqueue: (outbox) => outbox.enqueue({
      kind: 'password_reset',
      recipient: 'account@example.test',
    }),
  },
  {
    name: 'verified-domain mailbox proof',
    kind: 'domain_mailbox_proof',
    enqueue: (outbox) => outbox.enqueueDomainMailboxProof({
      userId: 'usr_domain',
      email: 'domain@example.test',
      emailGeneration: 1,
      authGeneration: 1,
      identityKind: 'session',
      identityContinuationId: null,
    }),
  },
  {
    name: 'tenant invitation',
    kind: 'tenant_invitation',
    enqueue: (outbox) => outbox.enqueueInvitation({
      invitationId: 'inv_transaction',
      recipient: 'invitee@example.test',
      rawToken: 'zinv_private-test-token',
    }).result,
  },
];

describe('auth email outbox transaction effects', () => {
  test('verified-domain authority admission fails closed inside the enqueue transaction', () => {
    const harness = createHarness({ domain_mailbox_proof: 'enqueued' });
    const binding = {
      userId: 'usr_domain_fenced',
      email: 'fenced@example.test',
      emailGeneration: 1,
      authGeneration: 1,
      identityKind: 'session' as const,
      identityContinuationId: null,
    };

    expect(() => harness.outbox.enqueueDomainMailboxProof(
      binding,
      () => false,
    )).toThrow(expect.objectContaining({
      code: 'AUTH_STATE_CHANGED',
      status: 409,
    }));
    expect(persistedCount(harness.db, 'domain_mailbox_proof')).toBe(0);
    expect(enqueueEvents(
      harness.events,
      'domain_mailbox_proof',
      'enqueued',
    )).toHaveLength(0);
    expect(harness.wakeCount()).toBe(0);

    const asyncAdmission = (() => Promise.resolve(true)) as unknown as () => boolean;
    expect(() => harness.outbox.enqueueDomainMailboxProof(
      binding,
      asyncAdmission,
    )).toThrow(expect.objectContaining({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      message: '[auth] Domain mailbox enqueue admission must be synchronous.',
    }));
    expect(persistedCount(harness.db, 'domain_mailbox_proof')).toBe(0);
    expect(enqueueEvents(
      harness.events,
      'domain_mailbox_proof',
      'enqueued',
    )).toHaveLength(0);
    expect(harness.wakeCount()).toBe(0);
  });

  for (const scenario of scenarios) {
    test(`${scenario.name} publishes and wakes after a standalone durable commit`, () => {
      const harness = createHarness({ [scenario.kind]: 'enqueued' });

      expect(scenario.enqueue(harness.outbox)).toBe('enqueued');

      expect(persistedCount(harness.db, scenario.kind)).toBe(1);
      expect(enqueueEvents(harness.events, scenario.kind, 'enqueued')).toHaveLength(1);
      expect(harness.wakeCount()).toBe(1);
    });

    test(`${scenario.name} defers success effects to the outermost commit`, () => {
      const harness = createHarness({ [scenario.kind]: 'enqueued' });

      expect(() => harness.db.transaction(() => {
        expect(scenario.enqueue(harness.outbox)).toBe('enqueued');
        expect(persistedCount(harness.db, scenario.kind)).toBe(1);
        expect(enqueueEvents(harness.events, scenario.kind, 'enqueued')).toHaveLength(0);
        expect(harness.wakeCount()).toBe(0);
        throw new Error('roll back enclosing operation');
      })).toThrow('roll back enclosing operation');

      expect(persistedCount(harness.db, scenario.kind)).toBe(0);
      expect(enqueueEvents(harness.events, scenario.kind, 'enqueued')).toHaveLength(0);
      expect(harness.wakeCount()).toBe(0);

      harness.db.transaction(() => {
        expect(scenario.enqueue(harness.outbox)).toBe('enqueued');
        expect(enqueueEvents(harness.events, scenario.kind, 'enqueued')).toHaveLength(0);
        expect(harness.wakeCount()).toBe(0);
      });

      expect(persistedCount(harness.db, scenario.kind)).toBe(1);
      expect(enqueueEvents(harness.events, scenario.kind, 'enqueued')).toHaveLength(1);
      expect(harness.wakeCount()).toBe(1);
    });

    test(`${scenario.name} retains capacity telemetry across caller rollback without waking`, () => {
      const harness = createHarness({ [scenario.kind]: 'capacity' });

      expect(() => harness.db.transaction(() => {
        expect(scenario.enqueue(harness.outbox)).toBe('capacity');
        expect(capacityEvents(harness.events, scenario.kind)).toHaveLength(1);
        expect(harness.wakeCount()).toBe(0);
        throw new Error('caller reports capacity');
      })).toThrow('caller reports capacity');

      expect(persistedCount(harness.db, scenario.kind)).toBe(0);
      expect(capacityEvents(harness.events, scenario.kind)).toHaveLength(1);
      expect(enqueueEvents(harness.events, scenario.kind, 'capacity')).toHaveLength(0);
      expect(harness.wakeCount()).toBe(0);
    });
  }

  for (const scenario of scenarios.filter(({ kind }) => kind !== 'tenant_invitation')) {
    test(`${scenario.name} retains duplicate telemetry across caller rollback without waking`, () => {
      const harness = createHarness({ [scenario.kind]: 'duplicate' });

      expect(() => harness.db.transaction(() => {
        expect(scenario.enqueue(harness.outbox)).toBe('duplicate');
        expect(suppressionEvents(
          harness.events,
          scenario.kind,
          'request_window',
        )).toHaveLength(1);
        expect(harness.wakeCount()).toBe(0);
        throw new Error('caller reports duplicate');
      })).toThrow('caller reports duplicate');

      expect(persistedCount(harness.db, scenario.kind)).toBe(0);
      expect(suppressionEvents(
        harness.events,
        scenario.kind,
        'request_window',
      )).toHaveLength(1);
      expect(enqueueEvents(harness.events, scenario.kind, 'duplicate')).toHaveLength(0);
      expect(harness.wakeCount()).toBe(0);
    });
  }
});

function createHarness(
  results: Partial<Record<AuthEmailOutboxKind, AuthEmailEnqueueResult>>,
): TransactionHarness {
  const db = createReactiveDB({ mode: 'memory' });
  databases.push(db);
  db.exec('CREATE TABLE _test_email_outbox_effect (kind TEXT NOT NULL)');
  const events: CapturedEmission[] = [];
  let wakes = 0;
  const persist = (kind: AuthEmailOutboxKind): AuthEmailEnqueueResult => {
    return db.transaction(() => {
      const result = results[kind] ?? 'enqueued';
      if (result === 'enqueued') {
        db.prepare('INSERT INTO _test_email_outbox_effect (kind) VALUES (?)').run(kind);
      }
      return result;
    });
  };
  const outbox = Object.create(AuthEmailOutbox.prototype) as AuthEmailOutbox;
  Object.assign(outbox as unknown as Record<string, unknown>, {
    db,
    assertCurrentProfile: () => {},
    clock: () => 100,
    emitCode: (
      definition: PlatformCodeDefinition,
      options?: PlatformCodeEmitOptions,
    ) => { events.push({ definition, options }); },
    invitationEnvelope: { encrypt: () => 'v1.test-envelope' },
    options: {
      requestWindowMs: 100,
      maxActiveJobs: 10,
      maxStoredJobs: 10,
    },
    store: {
      enqueue: () => persist('password_reset'),
      enqueueDomainMailbox: () => persist('domain_mailbox_proof'),
      enqueueInvitation: () => persist('tenant_invitation'),
    },
    worker: { wake: () => { wakes += 1; } },
  });
  return { db, outbox, events, wakeCount: () => wakes };
}

function persistedCount(db: ReactiveDB, kind: AuthEmailOutboxKind): number {
  const row = db.prepare(`
    SELECT COUNT(*) AS count FROM _test_email_outbox_effect WHERE kind = ?
  `).get(kind) as { count: number };
  return row.count;
}

function enqueueEvents(
  events: CapturedEmission[],
  kind: AuthEmailOutboxKind,
  result: AuthEmailEnqueueResult,
): CapturedEmission[] {
  return events.filter((event) => {
    return event.definition.code === OBS_CODES.AUTH_EMAIL_OUTBOX_ENQUEUED.code
      && event.options?.metadata?.kind === kind
      && event.options.metadata.result === result;
  });
}

function capacityEvents(
  events: CapturedEmission[],
  kind: AuthEmailOutboxKind,
): CapturedEmission[] {
  return suppressionEvents(events, kind, 'queue_capacity');
}

function suppressionEvents(
  events: CapturedEmission[],
  kind: AuthEmailOutboxKind,
  reason: 'queue_capacity' | 'request_window',
): CapturedEmission[] {
  return events.filter((event) => {
    return event.definition.code === OBS_CODES.AUTH_EMAIL_OUTBOX_SUPPRESSED.code
      && event.options?.metadata?.kind === kind
      && event.options.metadata.reason === reason;
  });
}
