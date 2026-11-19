/** Private native composition only. No public config, automatic mount or provider bag. */
import { CalendarError } from '../../calendar/error';
import { CALENDAR_OBSERVATION_JOB, CALENDAR_OBSERVATION_WORKFLOW, CALENDAR_OBSERVATION_WORKFLOW_VERSION,
  calendarObservationPinInput, type CalendarObservationExecution, type CalendarObservationRule } from '../../calendar/integration-catalog';
import { CalendarIntegrationCoordinator } from '../../calendar/integration-coordinator';
import type { CalendarAuthority } from '../../calendar/authority';
import type { CalendarIntegrationNativeOperations } from '../../calendar/integration-operator';
import { calendarIntegrationInspectionForAuthority, type CalendarIntegrationInspectionForAuthority } from '../../calendar/integration-operator-service';
import { calendarIntegrationOperatorRequestsForAuthority, type CalendarIntegrationScopedOperatorRequests } from '../../calendar/integration-operator-request-service';
import { createManagedCalendarOperatorAuthority, runManagedCalendarOperatorAcceptance } from './app-calendar-operator-authority';
import type { ResolvedJobsConfig } from '../../jobs/config';
import { JobDefinitionCatalog } from '../../jobs/definition';
import { emitPlatformEventTo } from '../../observability/sink';
import { ZERO_OBSERVABILITY_RUNTIME, ZERO_WORKFLOW_SERVICE } from '../../runtime/service-keys';
import type { SchedulerService } from '../../scheduler/scheduler-service';
import { workflowDeferredStarts } from '../../workflows/workflow-deferred-start-bridge';
import type { WorkflowService } from '../../workflows/workflow-service';
import { prepareManagedCalendarCore, type ManagedCalendarCoreOwner, type ManagedCalendarInput, type ManagedCalendarProviderOwner } from './app-calendar';
import type { ManagedJobsOwner } from './app-jobs';

/** @internal Compose the exact branded source-only definition before preparing
 * Jobs. An authored same-name entry, even an equivalent clone, is a collision.
 * Reusing an already-composed native catalog is harmless and keeps its identity.
 */
export function withManagedCalendarObservationJobs(config: ResolvedJobsConfig): ResolvedJobsConfig {
  const definitions = config.catalog.list();
  if (definitions.some(definition => definition.name === CALENDAR_OBSERVATION_JOB.name && definition !== CALENDAR_OBSERVATION_JOB)) {
    throw new CalendarError('CALENDAR_CONFIG_INVALID');
  }
  if (definitions.includes(CALENDAR_OBSERVATION_JOB)) return config;
  return Object.freeze({ ...config, catalog: new JobDefinitionCatalog([...definitions, CALENDAR_OBSERVATION_JOB]) });
}

export interface ManagedCalendarIntegrationOwner extends CalendarObservationExecution {
  readonly coordinator: CalendarIntegrationCoordinator;
  /** Private native controls only; NOT a request provider or public route. */
  readonly operations: CalendarIntegrationNativeOperations;
  /** Guardian-managed read-only projection; no mutating operator access. */
  inspectionForAuthority(request: CalendarAuthority): CalendarIntegrationInspectionForAuthority;
  /** Private actor acceptance projection. Source-local truth only; no HTTP/SDK mount. */
  operatorForAuthority(request: CalendarAuthority): CalendarIntegrationScopedOperatorRequests;
  /** Call after Torrent publication and BEFORE enabling Jobs automatic wakes. */
  start(scheduler: SchedulerService): Promise<void>;
  /** Exactly the Jobs owner's shared close, not an independent Calendar close. */
  close(): Promise<void>;
}

/** @internal Called only from the unsealed native beforeRecovery factory, after
 * dormant Jobs preparation. The exact unpublished Workflow owner supplies fixed
 * pins and scoped inspection; no published-service lookup or recovery wait runs.
 * Caller seals Jobs dependencies before allowing recovery, then starts this owner
 * after publication. Disabled/core Calendar composition remains independent.
 */
export async function prepareManagedCalendarIntegration(input: ManagedCalendarInput & {
  readonly workflows: WorkflowService;
  readonly jobs: ManagedJobsOwner;
  readonly rules: readonly CalendarObservationRule[];
}): Promise<ManagedCalendarIntegrationOwner | null> {
  const calendarConfig = input.config.calendar;
  if (!calendarConfig) return null;
  const { jobs, workflows, runtime } = input;
  let core: ManagedCalendarCoreOwner | null = null;
  let provider: ManagedCalendarProviderOwner | null = null;
  let preparation: Promise<ManagedCalendarCoreOwner | null> | null = null;
  let coordinator: CalendarIntegrationCoordinator | undefined;
  const construction = new AbortController();
  const signal = input.signal ? AbortSignal.any([input.signal, construction.signal]) : construction.signal;
  const failuresAfter = async (label: string, operations: readonly (() => void | Promise<void>)[]) => {
    const failures: unknown[] = [];
    for (const operation of operations) try { await operation(); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, label);
  };
  try {
    signal.throwIfAborted();
    if (!input.config.jobs || input.config.workflows === false) throw new CalendarError('CALENDAR_NOT_READY');
    jobs.assertDependency(workflows, CALENDAR_OBSERVATION_JOB);
    const bridge = workflowDeferredStarts(workflows);
    coordinator = new CalendarIntegrationCoordinator({ rules: input.rules,
      owner: record => {
        if (!provider) throw new CalendarError('CALENDAR_NOT_READY');
        return provider.persistence.forIntegrationOwner(record);
      },
      discover: ({ after, limit, signal }) => {
        signal.throwIfAborted();
        if (!provider) throw new CalendarError('CALENDAR_NOT_READY');
        return provider.persistence.integrationOwnerPage({ ...(after === undefined ? {} : { after }), limit });
      },
      resolveOwner: scope => {
        if (!provider) throw new CalendarError('CALENDAR_NOT_READY');
        return provider.persistence.integrationOwnerForScope(scope);
      },
      pin: owner => bridge.pinRegistered(bridge.system({ principal: 'calendar:observation:catalog',
        reason: 'Fixed native Calendar observation graph', scope: owner.scope }),
      CALENDAR_OBSERVATION_WORKFLOW, calendarObservationPinInput(), CALENDAR_OBSERVATION_WORKFLOW_VERSION),
      jobs: jobs.service,
      inspect: (id, scope) => workflows.getInstance(id, scope),
      onFailure: code => emitPlatformEventTo(runtime.require(ZERO_OBSERVABILITY_RUNTIME), {
        level: 'warn', category: 'calendar', code: 'calendar.integration.retry',
        message: 'Native Calendar integration requires reconciliation.', metadata: { failureCode: code },
      }),
    });
    const selected = coordinator;
    jobs.attachDependency({
      quiesce() {
        // Retire the facade and construction before cancelling native intake.
        construction.abort(new CalendarError('CALENDAR_NOT_READY'));
        provider?.quiesce(); selected.quiesce();
      },
      async drainIntake() {
        // A source/runtime factory can ignore cancellation. Wait for its exact
        // physical preparation before any shared provider is allowed to close.
        await preparation?.catch(() => undefined);
        await failuresAfter('Managed Calendar intake shutdown failed.', [
          () => selected.drain(), () => selected.drainPhysicalIntake(),
          async () => { await provider?.drainFacade(); },
        ]);
      },
      async drainEvidence() {
        // Torrent logical stop and physical drain happen first in the Jobs
        // owner. Join raw evidence bodies even if bounded pool close rejected.
        await failuresAfter('Managed Calendar evidence shutdown failed.', [
          () => selected.closeEvidence(), () => selected.drainPhysicalEvidence(),
        ]);
      },
      async closeProvider() { await provider?.closeProvider(); },
    });
    preparation = prepareManagedCalendarCore({ ...input, signal }, { source: () => selected.source, closeWith: jobs.close,
      retainProvider: owner => { provider = owner; } });
    core = await preparation;
    signal.throwIfAborted();
    if (!core) throw new CalendarError('CALENDAR_NOT_READY');
    const operations = Object.freeze<CalendarIntegrationNativeOperations>({
      inspect: (scope, options) => selected.inspect(scope, options),
      retire: (scope, options) => selected.retire(scope, options),
      reactivate: (scope, options) => selected.reactivate(scope, options),
    });
    const prepared = core;
    const nativeRequests = Object.freeze({ inspect: operations.inspect,
      reactivationPolicy: (scope: Parameters<CalendarIntegrationCoordinator['reactivationPolicy']>[0], ruleId: string) => selected.reactivationPolicy(scope, ruleId) });
    return Object.freeze({ coordinator: selected,
      operations,
      inspectionForAuthority: (request: CalendarAuthority) => calendarIntegrationInspectionForAuthority(operations,
        createManagedCalendarOperatorAuthority(runtime, request, prepared.logging), calendarConfig, signal),
      operatorForAuthority(request: CalendarAuthority) {
        const authority = createManagedCalendarOperatorAuthority(runtime, request, prepared.logging);
        return calendarIntegrationOperatorRequestsForAuthority(authority, calendarConfig, signal, { native: nativeRequests,
          broker: prepared.persistence,
          accept: (context, operation) => runManagedCalendarOperatorAcceptance(prepared.logging, authority, context, operation) });
      },
      execute: (context: Parameters<CalendarObservationExecution['execute']>[0]) => selected.execute(context),
      async start(scheduler: SchedulerService) {
        const assertPublished = () => {
          if (runtime.get(ZERO_WORKFLOW_SERVICE) !== workflows) throw new CalendarError('CALENDAR_NOT_READY');
          bridge.assertRuntimeCurrent();
        };
        assertPublished();
        await selected.start(scheduler);
        try { assertPublished(); }
        catch (error) {
          // Publication can retire while startup awaits another native writer.
          // Fence fresh eligibility, retaining original receipt/evidence paths.
          try { selected.quiesce(); }
          catch (cleanup) { throw new AggregateError([error, cleanup], 'Calendar publication retired during startup and wake cleanup failed.'); }
          throw error;
        }
      },
      close: jobs.close,
    });
  } catch (error) {
    // This factory never seals/admit recovery itself. Cancellation is legal
    // only before the caller seals; it must not recursively stop that caller's
    // Workflow initializer. A concurrently initiated shared close still owns
    // the same physical joins; recursively awaiting it here could deadlock the
    // Workflow stop that is already joining this dependency-preparation hook.
    const failures: unknown[] = [error];
    try { await jobs.cancelPreparation(); } catch (cleanup) {
      failures.push(cleanup);
      // cancelPreparation is forbidden once shared close/sealing began. Do not
      // infer that recovery was absent from the dormant Jobs runner's state.
    }
    if (failures.length > 1) throw new AggregateError(failures, 'Managed Calendar integration preparation and cleanup failed.');
    throw error;
  }
}
