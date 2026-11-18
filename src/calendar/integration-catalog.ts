/** Closed native observation catalog. Registration is inert until the normal Torrent owner persists/runs it. */
import { defineJob } from '../jobs/definition';
import type { JobWorkflowPin } from '../jobs/model';
import { flow, step } from '../workflows/workflow-dsl';
import type { WorkflowRegistry } from '../workflows/workflow-registry';
import type { StepContext } from '../workflows/types';
import { CalendarError } from './error';
import { integrationPolicy, type CalendarIntegrationObservationInput, type CalendarIntegrationPolicySpec } from './integration-model';
import type { CalendarIntegrationOwner } from './integration-runtime';
import type { CalendarIntegrationObservationResult } from './integration-observation';
import { calendarHash, calendarInteger, calendarJson, calendarKey, calendarRecord } from './validation';

export const CALENDAR_OBSERVATION_WORKFLOW = 'zero.calendar.observation.v1';
export const CALENDAR_OBSERVATION_WORKFLOW_VERSION = 1;
export const CALENDAR_OBSERVATION_ACTIVITY = 'zero.calendar.observation.execute';
export const CALENDAR_OBSERVATION_ACTIVITY_VERSION = '1';
export const CALENDAR_OBSERVATION_SEMANTICS = 'calendar-observation-v1';

export function normalizeCalendarObservationInput(input: unknown): CalendarIntegrationObservationInput {
  const r = calendarRecord(input, ['kind', 'intentId', 'appointmentRevision', 'policyEpoch']);
  if (r.kind !== 'calendar-observation-v1') throw new CalendarError('CALENDAR_INPUT_INVALID');
  return { kind: r.kind, intentId: calendarKey(r.intentId), appointmentRevision: calendarInteger(r.appointmentRevision, 1), policyEpoch: calendarInteger(r.policyEpoch, 1) };
}

export const CALENDAR_OBSERVATION_JOB = defineJob({ name: 'zero.calendar.observation', version: '1', origin: 'source', access: 'admin',
  workflow: { name: CALENDAR_OBSERVATION_WORKFLOW, version: CALENDAR_OBSERVATION_WORKFLOW_VERSION }, parseInput: normalizeCalendarObservationInput });

export interface CalendarObservationRule {
  readonly id: string; readonly version: string; readonly dueOffsetMs: number; readonly maxLatenessMs: number;
}
export interface CalendarObservationExecution {
  /** No request services/provider bag, Jobs broker or arbitrary command selection enters this fixed activity. */
  execute(context: StepContext<CalendarIntegrationObservationInput, never>): Promise<CalendarIntegrationObservationResult>;
}

/** Shape-valid compilation exemplar only: never an admitted intent or execution proof. */
export function calendarObservationPinInput(epoch = 1): CalendarIntegrationObservationInput {
  return Object.freeze({ kind: 'calendar-observation-v1', intentId: 'calendar-policy-pin', appointmentRevision: 1, policyEpoch: calendarInteger(epoch, 1) });
}

/** Native composition only. A future config must explicitly enable dependencies;
 * calling this builder confers no physical owner, source or workflow authority.
 */
export function calendarObservationPolicy(owner: CalendarIntegrationOwner, ruleInput: CalendarObservationRule, pin: JobWorkflowPin): CalendarIntegrationPolicySpec {
  owner.assertCurrent();
  const r = calendarRecord(ruleInput, ['id', 'version', 'dueOffsetMs', 'maxLatenessMs']);
  const rule = { id: calendarKey(r.id, 64), version: calendarKey(r.version, 64), dueOffsetMs: calendarInteger(r.dueOffsetMs, -31 * 86_400_000, 31 * 86_400_000),
    maxLatenessMs: calendarInteger(r.maxLatenessMs, 0, 31 * 86_400_000) };
  if (pin.name !== CALENDAR_OBSERVATION_WORKFLOW || pin.version !== CALENDAR_OBSERVATION_WORKFLOW_VERSION) throw new CalendarError('CALENDAR_POLICY_STALE');
  const policy = integrationPolicy({ ruleId: rule.id, ruleVersion: rule.version, adapter: 'observation-v1', dueOffsetMs: rule.dueOffsetMs, maxLatenessMs: rule.maxLatenessMs,
    source: { identity: { domain: 'calendar.' + calendarHash(['observation-rule-v1', rule.id]).slice(0, 55), databaseId: owner.owner.id,
      ownerId: owner.owner.owner_id, rootHash: owner.owner.root_hash, scopeId: owner.owner.scope_id }, realmFingerprint: owner.owner.realm_fingerprint,
      policyVersion: calendarHash([CALENDAR_OBSERVATION_SEMANTICS, rule]), semanticsVersion: CALENDAR_OBSERVATION_SEMANTICS,
      definition: { name: CALENDAR_OBSERVATION_JOB.name, version: CALENDAR_OBSERVATION_JOB.version, fingerprint: CALENDAR_OBSERVATION_JOB.fingerprint }, workflow: pin } });
  return freeze(policy);
}

/** Pure registration with a late native executor lookup: no files, timers,
 * dependencies, policy writes or recovery waits are performed by this function.
 */
export function registerCalendarObservationWorkflow(registry: WorkflowRegistry, execution: () => CalendarObservationExecution): void {
  registry.registerActivity({ name: CALENDAR_OBSERVATION_ACTIVITY, version: CALENDAR_OBSERVATION_ACTIVITY_VERSION, databaseCallable: false,
    capabilities: ['calendar.effect.observation'], handler: async context => {
      if (context.execution.kind !== 'system' || context.execution.legacyCompatibility || !/^jobs:source:src_[a-f0-9]{64}$/.test(context.execution.principal)
        || !(context.signal instanceof AbortSignal)) throw new CalendarError('CALENDAR_FORBIDDEN');
      const input = normalizeCalendarObservationInput(context.input), original = normalizeCalendarObservationInput(context.workflowInput);
      if (calendarJson(input) !== calendarJson(original)) throw new CalendarError('CALENDAR_FORBIDDEN');
      context.signal.throwIfAborted(); context.assertCurrentAuthority();
      return execution().execute(Object.freeze({ input: Object.freeze(input), workflowInput: Object.freeze(original), instanceId: context.instanceId, stepIndex: context.stepIndex, attempt: context.attempt,
        ...(context.attemptId === undefined ? {} : { attemptId: context.attemptId }), ...(context.idempotencyKey === undefined ? {} : { idempotencyKey: context.idempotencyKey }),
        signal: context.signal, execution: context.execution, zero: null, assertCurrentAuthority: () => context.assertCurrentAuthority() }));
    } });
  registry.create({ name: CALENDAR_OBSERVATION_WORKFLOW, version: CALENDAR_OBSERVATION_WORKFLOW_VERSION, access: { start: 'admin', inspect: 'admin' },
    flow: flow(step('observe', { name: CALENDAR_OBSERVATION_ACTIVITY, version: CALENDAR_OBSERVATION_ACTIVITY_VERSION }, { retries: 1, timeoutMs: 30_000 })) });
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
