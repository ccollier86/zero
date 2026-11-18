/** Fixed native catalog registration is pure. All execution/physical ownership seams here are explicit doubles. */
import { expect, test } from 'bun:test';
import { applicationServiceDataScope } from '../auth/service-data-scope';
import { createSystemAuthority } from '../workflows/workflow-execution-authority';
import { WorkflowRegistry } from '../workflows/workflow-registry';
import type { StepContext } from '../workflows/types';
import { CALENDAR_OBSERVATION_ACTIVITY, CALENDAR_OBSERVATION_ACTIVITY_VERSION, CALENDAR_OBSERVATION_JOB,
  CALENDAR_OBSERVATION_WORKFLOW, calendarObservationPolicy, registerCalendarObservationWorkflow } from './integration-catalog';
import type { CalendarIntegrationOwner } from './integration-runtime';
import { calendarDatabaseId } from './runtime';

const input = { kind: 'calendar-observation-v1' as const, intentId: 'opaque-intent', appointmentRevision: 2, policyEpoch: 3 };
function fixture() {
  const lifetime = new AbortController(), scope = applicationServiceDataScope();
  let proofs = 0, calls = 0;
  const owner: CalendarIntegrationOwner = { owner: { id: calendarDatabaseId('application'), owner_id: 'synthetic-owner', scope_id: 'application', root_hash: '1'.repeat(64), realm_fingerprint: 'sha256:' + '2'.repeat(64), established: 1 },
    scope, signal: lifetime.signal, assertCurrent() { lifetime.signal.throwIfAborted(); },
    async verify() { proofs++; }, async read() { throw new Error('Catalog must not read storage.'); }, async command() { throw new Error('Catalog must not mutate storage.'); } };
  const registry = new WorkflowRegistry(), contexts: StepContext[] = [];
  registerCalendarObservationWorkflow(registry, () => { calls++; return { async execute(context) { contexts.push(context); return { intentId: context.input.intentId, state: 'observed' }; } }; });
  const context: StepContext = { input, workflowInput: input, instanceId: 'synthetic-instance', stepIndex: 0, attempt: 0,
    attemptId: 'physical-attempt', idempotencyKey: 'logical-step', signal: lifetime.signal,
    execution: createSystemAuthority({ principal: 'jobs:source:src_' + '3'.repeat(64), reason: 'Synthetic source observation', scope }).identity,
    zero: { forbiddenProviderBag: true }, memory: { forbiddenStorage: true } as never,
    assertCurrentAuthority() { lifetime.signal.throwIfAborted(); } };
  const handler = registry.activities.get(CALENDAR_OBSERVATION_ACTIVITY, CALENDAR_OBSERVATION_ACTIVITY_VERSION)!.handler;
  return { owner, lifetime, registry, context, handler, contexts, calls: () => calls, proofs: () => proofs, close: () => lifetime.abort() };
}

test('fixed source-only job and code-only activity register without opening dependencies or resolving execution', () => {
  const f = fixture(); try {
    expect(CALENDAR_OBSERVATION_JOB.origin).toBe('source'); expect(CALENDAR_OBSERVATION_JOB.workflow).toEqual({ name: CALENDAR_OBSERVATION_WORKFLOW, version: 1 });
    expect(CALENDAR_OBSERVATION_JOB.parseInput(input)).toEqual(input);
    expect(() => CALENDAR_OBSERVATION_JOB.parseInput({ ...input, email: 'PRIVATE' })).toThrow();
    expect(() => CALENDAR_OBSERVATION_JOB.parseInput({ ...input, appointmentRevision: 0 })).toThrow();
    const activity = f.registry.activities.get(CALENDAR_OBSERVATION_ACTIVITY, CALENDAR_OBSERVATION_ACTIVITY_VERSION)!;
    expect(activity.databaseCallable).toBe(false); expect(Object.isFrozen(activity)).toBe(true);
    expect(() => f.registry.activities.resolveDatabaseCallable({ name: CALENDAR_OBSERVATION_ACTIVITY, version: CALENDAR_OBSERVATION_ACTIVITY_VERSION })).toThrow();
    expect(f.registry.getCompiledWorkflow(CALENDAR_OBSERVATION_WORKFLOW)).toBeDefined();
    expect(f.calls()).toBe(0); expect(f.proofs()).toBe(0);
  } finally { f.close(); }
});

test('fixed entry rejects ordinary actor, legacy, wrong principal, changed input and aborted authority before native lookup', async () => {
  const f = fixture(); try {
    for (const context of [
      { ...f.context, execution: { ...f.context.execution, kind: 'actor' } },
      { ...f.context, execution: { ...f.context.execution, legacyCompatibility: true } },
      { ...f.context, execution: { ...f.context.execution, principal: 'not-a-source' } },
      { ...f.context, workflowInput: { ...input, policyEpoch: 99 } },
    ]) await expect(f.handler(context as StepContext)).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    expect(f.calls()).toBe(0);
    f.lifetime.abort(); await expect(f.handler(f.context)).rejects.toBeDefined(); expect(f.calls()).toBe(0);
  } finally { f.close(); }
});

test('closed activity forwards only the native observation context, never request services, memory or provider handles', async () => {
  const f = fixture(); try {
    expect(await f.handler(f.context)).toEqual({ intentId: input.intentId, state: 'observed' });
    expect(f.calls()).toBe(1); expect(f.contexts).toHaveLength(1);
    expect(f.contexts[0]!.zero).toBeNull(); expect(f.contexts[0]!.memory).toBeUndefined();
    expect(Object.isFrozen(f.contexts[0])).toBe(true); expect(Object.isFrozen(f.contexts[0]!.input)).toBe(true);
    expect(f.contexts[0]).toMatchObject({ input, workflowInput: input, instanceId: f.context.instanceId, attemptId: 'physical-attempt', idempotencyKey: 'logical-step' });
  } finally { f.close(); }
});

test('policy semantics hash includes scheduling settings while stable source identity belongs to the rule, not its version', () => {
  const f = fixture(); try {
    const pin = { name: CALENDAR_OBSERVATION_WORKFLOW, version: 1, definitionId: 'definition', versionId: 'version', fingerprint: '4'.repeat(64) };
    const rule = { id: 'a'.repeat(64), version: '1', dueOffsetMs: -60_000, maxLatenessMs: 60_000 };
    const a = calendarObservationPolicy(f.owner, rule, pin), repeat = calendarObservationPolicy(f.owner, rule, pin);
    expect(a).toEqual(repeat); expect(Object.isFrozen(a.source.identity)).toBe(true); expect(a.source.identity.domain).toHaveLength(64);
    for (const next of [{ ...rule, version: '2' }, { ...rule, dueOffsetMs: 0 }, { ...rule, maxLatenessMs: 5_000 }]) {
      const b = calendarObservationPolicy(f.owner, next, pin);
      expect(b.source.identity).toEqual(a.source.identity); expect(b.source.policyVersion).not.toBe(a.source.policyVersion);
    }
    expect(calendarObservationPolicy(f.owner, { ...rule, id: 'other' }, pin).source.identity).not.toEqual(a.source.identity);
    expect(() => calendarObservationPolicy(f.owner, rule, { ...pin, version: 2 })).toThrow();
    expect(() => calendarObservationPolicy(f.owner, { ...rule, maxLatenessMs: 32 * 86_400_000 }, pin)).toThrow();
    expect(f.proofs()).toBe(0); expect(f.calls()).toBe(0);
  } finally { f.close(); }
});
