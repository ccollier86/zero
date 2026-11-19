/** Private Guardian projection of atomic LOCAL acceptance, never direct native control calls. */
import type { ServiceDataScope } from '../auth/service-data-scope';
import { admitCalendarRequest, type CalendarAuthority, type CalendarRequestAuthority } from './authority';
import type { ResolvedCalendarConfig } from './config';
import type { CalendarActor } from './contracts';
import { CalendarError } from './error';
import type { CalendarIntegrationPolicySelection } from './integration-controller';
import type { CalendarIntegrationPolicySpec } from './integration-model';
import { calendarIntegrationOperatorRequestIntent, type CalendarIntegrationOperatorAction,
  type CalendarIntegrationOperatorRequestReceipt } from './integration-operator-request-model';
import type { CalendarIntegrationNativeOperations } from './integration-operator';
import { calendarIntegrationInspectionForAuthority } from './integration-operator-service';
import { calendarHash, calendarKey, calendarRecord } from './validation';

export interface CalendarIntegrationOperatorRequestOptions {
  readonly idempotencyKey: string; readonly expected: CalendarIntegrationPolicySelection; readonly signal?: AbortSignal;
}
export interface CalendarIntegrationOperatorRequestBroker {
  integrationOperatorReceipt(scope: ServiceDataScope, input: { readonly actor: CalendarActor; readonly requestId: string },
    guard: () => void, signal?: AbortSignal): Promise<CalendarIntegrationOperatorRequestReceipt | null>;
  integrationOperatorRequest(scope: ServiceDataScope, input: unknown, guard: () => void,
    signal?: AbortSignal, finalCommitGuard?: () => void): Promise<CalendarIntegrationOperatorRequestReceipt>;
}
export interface CalendarIntegrationScopedOperatorRequests {
  readonly inspect: ReturnType<typeof calendarIntegrationInspectionForAuthority>['get'];
  readonly requests: { get(key: string, options?: { readonly signal?: AbortSignal }): Promise<CalendarIntegrationOperatorRequestReceipt | null> };
  retire(ruleId: string, options: CalendarIntegrationOperatorRequestOptions): Promise<CalendarIntegrationOperatorRequestReceipt>;
  reactivate(ruleId: string, options: CalendarIntegrationOperatorRequestOptions): Promise<CalendarIntegrationOperatorRequestReceipt>;
}
export interface CalendarIntegrationOperatorRequestServiceOptions {
  readonly native: Pick<CalendarIntegrationNativeOperations, 'inspect'> & {
    reactivationPolicy(scope: ServiceDataScope, ruleId: string): CalendarIntegrationPolicySpec;
  };
  readonly broker: CalendarIntegrationOperatorRequestBroker;
  /** Native managed attribution only, entered immediately around source acceptance. */
  readonly accept: (authority: CalendarRequestAuthority, operation: () => Promise<CalendarIntegrationOperatorRequestReceipt>) => Promise<CalendarIntegrationOperatorRequestReceipt>;
}

export function calendarIntegrationOperatorRequestsForAuthority(request: CalendarAuthority,
  config: Pick<ResolvedCalendarConfig, 'createOwn' | 'manage'>, closing: AbortSignal,
  options: CalendarIntegrationOperatorRequestServiceOptions): CalendarIntegrationScopedOperatorRequests {
  const native = options.native, broker = options.broker, accept = options.accept;
  const compile = native.reactivationPolicy.bind(native), read = broker.integrationOperatorReceipt.bind(broker), write = broker.integrationOperatorRequest.bind(broker);
  const inspection = calendarIntegrationInspectionForAuthority({ inspect: native.inspect.bind(native) }, request, config, closing);
  const admit = async (signal?: AbortSignal) => {
    const authority = await admitCalendarRequest(request, config, closing, signal);
    if (!authority.actor.manageAll) throw new CalendarError('CALENDAR_FORBIDDEN');
    authority.guard(); return authority;
  };
  const receipt = async (authority: CalendarRequestAuthority, requestId: string) => {
    authority.guard();
    const result = await read(authority.scope, { actor: authority.actor, requestId }, authority.guard, authority.signal);
    await authority.confirm(); authority.guard(); return result;
  };
  const submit = async (action: CalendarIntegrationOperatorAction, ruleInput: string, input: CalendarIntegrationOperatorRequestOptions) => {
    const r = calendarRecord(input, ['idempotencyKey', 'expected', 'signal']), requestId = calendarKey(r.idempotencyKey);
    const intent = calendarIntegrationOperatorRequestIntent({ action, ruleId: calendarKey(ruleInput, 64), expected: r.expected });
    const authority = await admit(r.signal as AbortSignal | undefined);
    // Original request acceptance is independent of later configuration, graph
    // availability and native running state, but NEVER independent of current rights.
    const prior = await receipt(authority, requestId);
    authority.guard();
    if (prior !== null) {
      const original = calendarIntegrationOperatorRequestIntent({ action: prior.action, ruleId: prior.ruleId, expected: prior.expected });
      if (original.digest !== intent.digest) throw new CalendarError('CALENDAR_INTENT_CONFLICT');
      return prior;
    }
    authority.guard();
    const desired = action === 'reactivate' ? compile(authority.scope, intent.ruleId) : undefined;
    authority.guard();
    const finalGuard = () => {
      authority.guard();
      if (desired && calendarHash(compile(authority.scope, intent.ruleId)) !== calendarHash(desired)) throw new CalendarError('CALENDAR_POLICY_STALE');
    };
    let invoked = false, accepted = false;
    try {
      const result = await accept(authority, async () => {
        authority.guard(); invoked = true;
        const result = await write(authority.scope,
          { actor: authority.actor, requestId, action, ruleId: intent.ruleId, expected: intent.expected, ...(desired ? { desired } : {}) },
          authority.guard, authority.signal, finalGuard);
        accepted = true; return result;
      });
      await authority.confirm(); authority.guard(); return result;
    } catch (error) {
      if (accepted || invoked && authority.signal.aborted && !(error instanceof CalendarError && error.outcome !== 'unknown')) throw new CalendarError('CALENDAR_OUTCOME_UNKNOWN');
      throw error;
    }
  };
  return Object.freeze({ inspect: inspection.get,
    requests: Object.freeze({ async get(key: string, input?: { readonly signal?: AbortSignal }) {
      const r = calendarRecord(input === undefined ? {} : input, ['signal']), requestId = calendarKey(key);
      return receipt(await admit(r.signal as AbortSignal | undefined), requestId);
    } }),
    retire: (ruleId: string, input: CalendarIntegrationOperatorRequestOptions) => submit('retire', ruleId, input),
    reactivate: (ruleId: string, input: CalendarIntegrationOperatorRequestOptions) => submit('reactivate', ruleId, input),
  });
}
