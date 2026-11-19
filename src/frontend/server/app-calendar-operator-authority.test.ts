/** Real Guardian + LoggingAdmission + semantic source capture, MEMORY only.
 * LoggingRuntime's process boundary is an explicit adapter; no files, actors, mounts or providers are opened.
 */
import { expect, test } from 'bun:test';
import { readAuthAuthorityProperties } from '../../auth/auth-authority-properties';
import { resolveAuthBehaviorConfig } from '../../auth/auth-config';
import { createRequestAuthorizationAccess } from '../../auth/authorization-access';
import { createAuthorizationKernel } from '../../auth/authorization-kernel';
import { serviceDataScopeKey, trustedSystemServiceDataScope } from '../../auth/service-data-scope';
import type { UserStore } from '../../auth/user-store';
import type { AuthContext } from '../../auth/types';
import { admitCalendarRequest, type CalendarAuthority, type CalendarRequestAuthority } from '../../calendar/authority';
import type { CalendarIntegrationOperatorRequestReceipt } from '../../calendar/integration-operator-request-model';
import { calendarRealm } from '../../calendar/realm';
import { memoryCalendarServiceFixture } from '../../calendar/test-support/memory-service-fixture';
import { runDatabaseRealmCommand } from '../../databases/database-realm';
import { calendarValue } from '../../calendar/validation';
import { LoggingAdmission } from '../../logging/logging-admission';
import { LoggingActorSource, normalizeLoggingActorSourceBinding } from '../../logging/logging-actor-source';
import { currentLoggingAttribution, withoutLoggingAttribution } from '../../logging/logging-attribution';
import { loggingAuthContext } from '../../logging/logging-auth-context';
import type { LoggingEvent } from '../../logging/logging-contracts';
import type { LoggingRuntime } from '../../logging/logging-runtime';
import { ZERO_AUTH_STORE, ZERO_LOGGING_RUNTIME } from '../../runtime/service-keys';
import { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import { createManagedCalendarOperatorAuthority, runManagedCalendarOperatorAcceptance } from './app-calendar-operator-authority';

const policyVersion = 'synthetic-calendar-operator-policy';
const selected = Object.freeze({ id: '1'.repeat(64), epoch: 1, policyDigest: '2'.repeat(64) });
const receipt: CalendarIntegrationOperatorRequestReceipt = Object.freeze({ requestId: 'operator-request', action: 'retire',
  ruleId: 'observe', expected: selected, policy: selected, localState: 'retired', changed: true, acceptedAtMs: 1 });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(options: { tenancy?: 'single' | 'multi'; logging?: boolean; required?: boolean; context?: Partial<AuthContext> } = {}) {
  const calendar = memoryCalendarServiceFixture({ tenancy: options.tenancy ?? 'multi' }), runtime = new ZeroAppRuntime('synthetic-calendar-operator');
  const closing = new AbortController(), session = calendar.session('operator', { manager: true, context: options.context });
  const properties: Record<string, string> = { department: 'scheduling' }, propertyReads: string[] = [];
  const store = { getProperties() { throw new Error('Legacy properties must not replace authority properties.'); },
    getAuthorityProperties(userId: string) { propertyReads.push(userId); return { ...properties }; } } as unknown as UserStore;
  runtime.set(ZERO_AUTH_STORE, store);
  let now = 0, probes = 0, callbacks = 0;
  const events: LoggingEvent[] = [];
  const admission = new LoggingAdmission(options.required ?? true, policyVersion, async event => {
    events.push(event); return { id: event.id, sourceId: event.sourceId, ordinal: events.length, duplicate: false };
  }, () => now, 60000, 16, () => true, async () => { probes++; });
  const logging = { admission, config: { policyVersion } } as unknown as LoggingRuntime;
  const snapshot = options.logging === false ? null : logging;
  if (snapshot) runtime.set(ZERO_LOGGING_RUNTIME, snapshot);
  const request = createManagedCalendarOperatorAuthority(runtime, session.authority, snapshot);
  const admit = () => admitCalendarRequest(request, calendar.config, closing.signal);
  return { calendar, runtime, closing, session, request, logging, snapshot, admission, events, properties, propertyReads, admit,
    probes: () => probes, callbacks: () => callbacks, advance(ms: number) { now += ms; },
    async grant() {
      const auth = session.authority.access.requireUser();
      await admission.acknowledge({ auth, properties: readAuthAuthorityProperties(store, auth.userId) },
        loggingAuthContext(auth, policyVersion), policyVersion, session.authority.assertCurrentAuthority);
    },
    async accept() {
      const context = await admit();
      return runManagedCalendarOperatorAcceptance(snapshot, request, context, async () => { callbacks++; return receipt; });
    },
    async close() {
      closing.abort(); admission.close();
      try { await runtime.dispose(); } finally { await calendar.close(); }
    },
  };
}

test('missing, expired and invalidated required grants cannot reach acceptance and never create an implicit grant or probe', async () => {
  for (const state of ['missing', 'expired', 'invalidated'] as const) {
    const f = fixture();
    try {
      if (state !== 'missing') await f.grant();
      if (state === 'expired') f.advance(60000);
      if (state === 'invalidated') f.admission.invalidate();
      const events = f.events.length;
      await expect(f.accept()).rejects.toMatchObject({ code: 'LOGGING_ADMISSION_REQUIRED' });
      expect(f.callbacks()).toBe(0); expect(f.events).toHaveLength(events); expect(f.probes()).toBe(0);
      expect(f.admission.diagnostics().pending).toBe(0);
      expect(f.calendar.stats()).toMatchObject({ planes: 0, ownerRows: 0, acquisitions: 0 });
    } finally { await f.close(); }
  }
});

test('an existing exact web grant admits canonical application and tenant scopes without a Request owner or renewal', async () => {
  for (const tenancy of ['single', 'multi'] as const) {
    const f = fixture({ tenancy });
    try {
      await f.grant();
      expect(await f.accept()).toBe(receipt); expect(f.callbacks()).toBe(1);
      expect(f.events.map(event => event.action)).toEqual(['logging.delivery.acknowledged']); expect(f.probes()).toBe(0);
      const context = await f.admit(); context.guard(); await context.confirm();
      expect(context.scope).toBe(f.session.scope); expect(context.actor.scopeId).toBe(serviceDataScopeKey(f.session.scope));
      expect(f.propertyReads.length).toBeGreaterThan(3); expect(f.propertyReads.every(id => id === f.session.userId)).toBe(true);
    } finally { await f.close(); }
  }
});

test('disabled logging on an empty runtime and optional capture preserve ordinary Guardian admission', async () => {
  for (const logging of [false, true]) {
    const f = fixture({ logging, required: false });
    try {
      if (!logging) expect(f.runtime.get(ZERO_LOGGING_RUNTIME)).toBeNull();
      expect(await f.accept()).toBe(receipt); expect(f.events).toEqual([]); expect(f.probes()).toBe(0);
      f.session.revoke(); await expect(f.accept()).rejects.toBeInstanceOf(Error); expect(f.callbacks()).toBe(1);
    } finally { await f.close(); }
  }
});

test('live authority properties, scope replacement and Logging owner replacement fence already admitted contexts', async () => {
  for (const replace of ['properties', 'scope', 'logging', 'logging-clear', 'logging-enable'] as const) {
    const f = fixture({ logging: replace !== 'logging-enable' });
    try {
      if (f.snapshot) await f.grant();
      const context = await f.admit();
      if (replace === 'properties') f.properties.department = 'retired';
      if (replace === 'scope') f.session.replaceScope('tenant-b');
      if (replace === 'logging') f.runtime.set(ZERO_LOGGING_RUNTIME, { ...f.logging } as LoggingRuntime);
      if (replace === 'logging-clear') f.runtime.clear(ZERO_LOGGING_RUNTIME);
      if (replace === 'logging-enable') f.runtime.set(ZERO_LOGGING_RUNTIME, f.logging);
      expect(() => context.guard()).toThrow(); await expect(context.confirm()).rejects.toBeInstanceOf(Error);
      let reached = false;
      await expect(runManagedCalendarOperatorAcceptance(f.snapshot, f.request, context, async () => { reached = true; return receipt; })).rejects.toBeInstanceOf(Error);
      expect(reached).toBe(false); expect(f.probes()).toBe(0);
    } finally { await f.close(); }
  }
});

test('a replacement Logging owner during the asynchronous Guardian wait cannot admit acceptance', async () => {
  const f = fixture(), entered = deferred(), release = deferred();
  let pending: Promise<CalendarRequestAuthority> | undefined;
  try {
    await f.grant();
    const request: CalendarAuthority = { ...f.session.authority, async assertCurrentAuthority() {
      entered.resolve(); await release.promise; await f.session.authority.assertCurrentAuthority();
    } };
    const derived = createManagedCalendarOperatorAuthority(f.runtime, request, f.logging);
    pending = admitCalendarRequest(derived, f.calendar.config, f.closing.signal);
    await entered.promise; f.runtime.set(ZERO_LOGGING_RUNTIME, { ...f.logging } as LoggingRuntime); release.resolve();
    await expect(pending).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' }); expect(f.probes()).toBe(0);
  } finally { release.resolve(); await pending?.catch(() => {}); await f.close(); }
});

test('native and previously admitted API-key authority are still rejected by Calendar request admission', async () => {
  const native = fixture({ required: false, context: { sessionKind: 'native' } });
  try { await expect(native.accept()).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' }); expect(native.callbacks()).toBe(0); }
  finally { await native.close(); }
  const f = fixture({ tenancy: 'single', required: false });
  try {
    const access = createRequestAuthorizationAccess({ kernel: createAuthorizationKernel(resolveAuthBehaviorConfig({ tenancy: 'single' })),
      authContext: { ...f.session.authority.access.requireUser(), credentialKind: 'api-key', credentialId: 'synthetic-key' } });
    access.authorize({ user: 'required', credentials: ['api-key'] }); expect(access.requireUser().credentialKind).toBe('api-key');
    const derived = createManagedCalendarOperatorAuthority(f.runtime, { ...f.session.authority, access }, f.logging);
    await expect(admitCalendarRequest(derived, f.calendar.config, f.closing.signal)).rejects.toBeInstanceOf(Error);
    expect(access.context).toBeNull(); expect(f.events).toEqual([]);
  } finally { await f.close(); }
});

test('the frozen derived authority preserves live getters without mutating input or hiding an asynchronous synchronous guard', async () => {
  const f = fixture({ logging: false });
  try {
    const first = new AbortController(), second = new AbortController(); let signal = first.signal;
    const original: CalendarAuthority = { ...f.session.authority, get signal() { return signal; } };
    const before = Reflect.ownKeys(original), derived = createManagedCalendarOperatorAuthority(f.runtime, original, null);
    expect(Object.isFrozen(derived)).toBe(true); expect(Object.isFrozen(original)).toBe(false);
    expect(Reflect.ownKeys(original)).toEqual(before); expect(derived.signal).toBe(first.signal);
    signal = second.signal; expect(derived.signal).toBe(second.signal); expect(derived.scope).toBe(original.scope);
    const invalid = createManagedCalendarOperatorAuthority(f.runtime, { ...original, async assertCurrentAuthoritySync() {} }, null);
    expect(() => invalid.assertCurrentAuthoritySync()).toThrow(expect.objectContaining({ code: 'AUTH_STATE_INVARIANT_FAILED' }));
  } finally { await f.close(); }
});

test('acceptance attribution is the verified human in the real MEMORY source outbox and recovery stays system-owned', async () => {
  const f = fixture(); let source: LoggingActorSource | undefined;
  try {
    await f.grant();
    await f.session.api.resources.create({ label: 'Synthetic setup', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'setup' });
    const db = f.calendar.sourceDatabase(f.session.scope)!;
    source = new LoggingActorSource(db, normalizeLoggingActorSourceBinding({ records: false, workflow: true, policyVersion,
      scope: { kind: 'tenant', tenantId: f.session.scope.tenantId } }));
    const context = await f.admit(), actor = context.actor;
    const command = (id: string) => runDatabaseRealmCommand(calendarRealm, db, 'calendar.resource.create', calendarValue({
      actor, requestId: id, id, label: 'PRIVATE_CALENDAR_LABEL', kind: 'person', ownerId: actor.userId, timeZone: 'UTC',
    }));
    await runManagedCalendarOperatorAcceptance(f.logging, f.request, context, async () => {
      const attribution = currentLoggingAttribution(f.logging); expect(attribution).not.toBeNull();
      source!.run(attribution!, () => command('accepted')); return receipt;
    });
    expect(currentLoggingAttribution(f.logging)).toBeNull();
    withoutLoggingAttribution(() => {
      expect(currentLoggingAttribution(f.logging)).toBeNull(); source!.run(undefined, () => command('recovered'));
    });
    const events = source.control({}).rows.map(row => row.event);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ actor: { kind: 'user', id: f.session.userId, sessionId: 'session-operator', initiatorId: null },
      origin: 'backend', scope: { kind: 'tenant', tenantId: 'tenant-a' }, policyVersion, evidence: 'server-confirmed' });
    expect(events[1]).toMatchObject({ actor: { kind: 'system', id: 'zero.database', sessionId: null, initiatorId: null }, origin: 'system' });
    expect(JSON.stringify(events)).not.toContain('PRIVATE_CALENDAR_LABEL');
  } finally { source?.close(); await f.close(); }
});

test('attribution checks current admission before source dispatch and cannot survive acceptance settlement in a retained child', async () => {
  const f = fixture(), release = deferred(); let child: Promise<unknown> | undefined;
  try {
    await f.grant(); const context = await f.admit();
    await runManagedCalendarOperatorAcceptance(f.logging, f.request, context, async () => {
      child = (async () => { await release.promise; return currentLoggingAttribution(f.logging); })();
      void child.catch(() => {}); return receipt;
    });
    release.resolve(); await expect(child!).rejects.toThrow('Logging attribution lifetime is closed.');
    let reached = false;
    await expect(runManagedCalendarOperatorAcceptance(f.logging, f.request, context, async () => {
      f.admission.invalidate(); currentLoggingAttribution(f.logging); reached = true; return receipt;
    })).rejects.toMatchObject({ code: 'LOGGING_ADMISSION_REQUIRED' });
    expect(reached).toBe(false);
  } finally { release.resolve(); await child?.catch(() => {}); await f.close(); }
});

test('a mismatched trusted context cannot retarget the human attribution to another scope or user', async () => {
  const f = fixture();
  try {
    await f.grant(); const context = await f.admit();
    const scope = trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'tenant-b' });
    for (const forged of [{ ...context, actor: { ...context.actor, userId: 'other-user' } },
      { ...context, scope, actor: { ...context.actor, scopeId: serviceDataScopeKey(scope) } }]) {
      let reached = false;
      await expect(runManagedCalendarOperatorAcceptance(f.logging, f.request, forged, async () => { reached = true; return receipt; }))
        .rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
      expect(reached).toBe(false);
    }
  } finally { await f.close(); }
});
