/** Private fixed observation adapter. No provider bag, public workflow entry or managed activation. */
import type { ServiceDataScope } from '../auth/service-data-scope';
import { serviceDataScopeKey } from '../auth/service-data-scope';
import { jobSourcePrincipal, jobSourceId, jobSourceScheduleId } from '../jobs/source-model';
import type { SourceJobs } from '../jobs/source-service';
import type { StepContext, WorkflowInstanceRecord } from '../workflows/types';
import { CalendarError } from './error';
import { normalizeCalendarObservationInput as observationInput } from './integration-catalog';
import type { CalendarIntegrationEffectView, CalendarIntegrationIntentView, CalendarIntegrationObservationInput } from './integration-model';
import type { CalendarIntegrationOwner } from './integration-runtime';
import { calendarHash, calendarInteger, calendarJson, calendarKey } from './validation';

export interface CalendarIntegrationObservationDependencies {
  readonly owner: CalendarIntegrationOwner;
  /** Native Torrent inspection in the SAME verified scope; never a browser-provided record. */
  readonly inspect: (instanceId: string, scope: ServiceDataScope) => WorkflowInstanceRecord | null;
  /** Owner-bound original Jobs occurrence/sealed Torrent receipt evidence, including before dispatch acknowledgment. */
  readonly executions: SourceJobs['executions'];
  readonly now?: () => number;
}
export interface CalendarIntegrationObservationResult { readonly intentId: string; readonly state: 'observed' | 'admitted' }

/** Register only behind a fixed native activity with its sealed context. A historical
 * admission can be inspected, but cannot authorize a second effect. Even though an
 * observation has no external side effect, it exercises the same cutoff discipline.
 */
export async function observeCalendarIntegration(deps: CalendarIntegrationObservationDependencies,
  context: StepContext): Promise<CalendarIntegrationObservationResult> {
  const identity = context.execution;
  if (identity.kind !== 'system' || identity.legacyCompatibility || !(context.signal instanceof AbortSignal)) throw new CalendarError('CALENDAR_FORBIDDEN');
  const expectedScope = serviceDataScopeKey(deps.owner.scope);
  if (identity.scopeKind === 'application' ? expectedScope !== 'application' || identity.tenantId !== null || identity.scopeId !== 'application'
    : expectedScope !== 'tenant:' + identity.tenantId || identity.scopeId !== identity.tenantId) throw new CalendarError('CALENDAR_FORBIDDEN');
  const guard = () => { deps.owner.assertCurrent(); context.signal!.throwIfAborted(); context.assertCurrentAuthority(); };
  guard();
  const input = observationInput(context.input), workflowInput = observationInput(context.workflowInput);
  if (calendarJson(input) !== calendarJson(workflowInput)) throw new CalendarError('CALENDAR_FORBIDDEN');
  const intent = await deps.owner.read<CalendarIntegrationIntentView | null>('calendar.integration.intent', { id: input.intentId },
    { signal: context.signal, assertCurrent: guard });
  guard();
  if (!intent || !intent.registration || identity.principal !== jobSourcePrincipal(jobSourceId(intent.policy.source.identity))
    || calendarJson(input) !== calendarJson(intent.input) || intent.policy.adapter !== 'observation-v1') throw new CalendarError('CALENDAR_FORBIDDEN');
  const instance = deps.inspect(calendarKey(context.instanceId), deps.owner.scope), pin = intent.policy.source.workflow;
  if (!instance || instance.instance_id !== context.instanceId || instance.tenant_id !== identity.tenantId
    || instance.name !== pin.name || instance.definition_id !== pin.definitionId || instance.definition_version !== pin.version
    || instance.definition_version_id !== pin.versionId || instance.graph_fingerprint !== pin.fingerprint
    || instance.status !== 'running' || instance.input === null) throw new CalendarError('CALENDAR_FORBIDDEN');
  let retainedInput: CalendarIntegrationObservationInput;
  try { retainedInput = observationInput(JSON.parse(instance.input)); } catch { throw new CalendarError('CALENDAR_STATE_INVALID'); }
  if (calendarJson(retainedInput) !== calendarJson(input)) throw new CalendarError('CALENDAR_FORBIDDEN');
  const scheduleId = jobSourceScheduleId(intent.policy.source.identity, intent.createKey);
  const evidence = await deps.executions.get(scheduleId, { generation: 1, scheduledAt: Date.parse(intent.at) });
  guard();
  if (!evidence || evidence.instanceId !== context.instanceId || evidence.scheduleId !== scheduleId || evidence.generation !== 1
    || evidence.scheduledAt !== Date.parse(intent.at) || evidence.sourceId !== intent.registration.id
    || evidence.policyGeneration !== intent.registration.generation || evidence.policyHash !== intent.registration.policyHash
    || evidence.inputHash !== calendarHash(input) || calendarJson(evidence.workflow) !== calendarJson(pin)) throw new CalendarError('CALENDAR_FORBIDDEN');
  guard();
  const now = () => calendarInteger((deps.now ?? Date.now)(), 0, 8_640_000_000_000_000);
  // A fresh PHYSICAL admission key is intentional. Replaying a successful native
  // transport receipt must not return its earlier admitted:true as fresh permission.
  // The immutable intent ID remains the single logical effect identity.
  const nonce = 'observe_' + crypto.randomUUID();
  const admitted = await deps.owner.command<{ admitted: boolean; effect: CalendarIntegrationEffectView }>('calendar.integration.effect.admit', {
    id: input.intentId, executionId: context.instanceId, nonce, registration: intent.registration, workflow: pin,
  }, { idempotencyKey: 'calendar-observe-admit:' + nonce, signal: context.signal, assertCurrent: guard });
  guard();
  if (!admitted.admitted) return { intentId: input.intentId, state: admitted.effect.outcome === 'observed' ? 'observed' : 'admitted' };
  const effect = await deps.owner.command<CalendarIntegrationEffectView>('calendar.integration.effect.settle', {
    id: input.intentId, executionId: context.instanceId, nonce, outcome: 'observed', now: now(),
  }, { idempotencyKey: 'calendar-observe-settle:' + calendarHash([input.intentId, nonce]), signal: context.signal, assertCurrent: guard });
  guard();
  if (effect.outcome !== 'observed') throw new CalendarError('CALENDAR_OUTCOME_UNKNOWN');
  return { intentId: input.intentId, state: 'observed' };
}
