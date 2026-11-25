/** Private initial-source acceptance only. No registry, reservations, coverage or automatic native authority is enabled.
 * The managed broker MUST install command.assertCommitCurrent under its actual DatabaseCommitAuthority.
 * Calling run() alone is not evidence of cross-file/SYSTEM commit qualification. */
import { serviceDataScopeKey, type ServiceDataScope } from '../auth/service-data-scope';
import { invokeSynchronousAuthCallback } from '../auth/auth-synchronous-callback';
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import type { CalendarRequestAuthority } from './authority';
import type { CalendarParticipantDirectory } from './participants-directory';
import type { CalendarOwnerRecord } from './owner-schema';
import type { ResolvedCalendarConfig } from './config';
import type { CalendarTimedInterval } from './time';
import { admitCalendarTimedSeriesAuthoring, normalizeCalendarTimedSeriesAuthoring } from './series-authoring';
import { calendarRecurrenceTraversal } from './recurrence-engine';
import { calendarResource, requireCalendarRight } from './realm-model';
import { calendarHash, calendarInteger, calendarKey, calendarScope, calendarText } from './validation';
import { createCalendarInitialSeriesSourceAdmission, type CalendarInitialSeriesRequestFacts,
  type CalendarInitialSeriesCompilationFrame } from './series-source-admission';
export type { CalendarInitialSeriesRequestFacts, CalendarInitialSeriesCompilationFrame } from './series-source-admission';
import { CalendarError } from './error';

export interface CalendarSeriesPlanAcceptance {
  readonly operation: 'series.plan.accepted'; readonly requestId: string; readonly seriesId: string;
  readonly controlRevision: 1; readonly preparationId: string; readonly basePublicationId: null;
}
declare const requestBrand: unique symbol, compilationBrand: unique symbol;
export interface CalendarInitialSeriesRequest { readonly [requestBrand]: true }
export interface CalendarInitialSeriesCompilation { readonly [compilationBrand]: true }
type Request = CalendarInitialSeriesRequestFacts;
interface Compilation {
  readonly request: Request; readonly interval: Readonly<CalendarTimedInterval>;
  readonly engineGeneration: string; readonly assertEngineCurrent: () => void;
}
const requests = new WeakMap<object, Request>(), compilations = new WeakMap<object, Compilation>();
function invalid(): never { throw new CalendarError('CALENDAR_INPUT_INVALID'); }
function forbidden(): never { throw new CalendarError('CALENDAR_FORBIDDEN'); }
function state(): never { throw new CalendarError('CALENDAR_STATE_INVALID'); }
function synchronous(run: () => unknown): void {
  const result = invokeSynchronousAuthCallback(run, { component: 'calendar-series', invariant: 'native-series-guard-is-synchronous', message: 'Calendar series guards must not yield.' });
  if (result !== undefined) forbidden();
}
function request(handle: CalendarInitialSeriesRequest): Request {
  const result = handle && typeof handle === 'object' ? requests.get(handle) : undefined;
  if (!result) return forbidden(); return result;
}
function hash(value: unknown): string { const result = calendarText(value, 64); if (!/^[a-f0-9]{64}$/.test(result)) return invalid(); return result; }
function opaque<T>(map: WeakMap<object, T>, value: T): object { const handle = Object.freeze({}); map.set(handle, value); return handle; }

/** Native original-key reconciliation before any fresh Temporal/policy/target
 * admission. Facts remain runtime-owned, frozen and are never a write grant. */
export function inspectCalendarInitialSeriesRequest(handle: CalendarInitialSeriesRequest): CalendarInitialSeriesRequestFacts {
  return request(handle);
}

/** Structural normalization only: exact replay can be resolved before touching Temporal or current selected catalogs. */
export function prepareCalendarInitialSeriesRequest(authority: CalendarRequestAuthority, requestInput: string, input: unknown,
  limits: Pick<ResolvedCalendarConfig, 'maxResources' | 'maxParticipants'>): CalendarInitialSeriesRequest {
  synchronous(authority.guard);
  const actor = authority.actor, scopeId = calendarScope(serviceDataScopeKey(authority.scope));
  if (!actor.manageAll || actor.scopeId !== scopeId) return forbidden();
  const principal = calendarText(actor.principal, 256), userId = calendarKey(actor.userId), requestId = calendarKey(requestInput);
  const seriesId = calendarHash(['calendar.series.v1', scopeId, principal, requestId]), authoring = normalizeCalendarTimedSeriesAuthoring(input, { maxResources: limits.maxResources, maxParticipants: limits.maxParticipants });
  const value = Object.freeze({ scopeId, principal, userId, requestId, seriesId, authoring, digest: calendarHash(['series.create.v1', seriesId, authoring]) });
  synchronous(authority.guard); return opaque(requests, value) as CalendarInitialSeriesRequest;
}

/** Fixed native DTSTART compilation, outside all SQL/Guardian leases. Caller JSON cannot reconstruct this proof. */
export function compileCalendarInitialSeriesRequest(handle: CalendarInitialSeriesRequest): CalendarInitialSeriesCompilation {
  const value = request(handle), admitted = admitCalendarTimedSeriesAuthoring(value.authoring, { maxResources: 16, maxParticipants: 100 });
  const traversal = calendarRecurrenceTraversal(value.authoring.recurrence);
  if (calendarHash(traversal.original) !== calendarHash(admitted.original)) throw new CalendarError('CALENDAR_TIME_RULES_UNAVAILABLE');
  traversal.assertCurrent();
  return opaque(compilations, Object.freeze({ request: value, interval: admitted.interval, engineGeneration: calendarHash(traversal.engine), assertEngineCurrent: traversal.assertCurrent })) as CalendarInitialSeriesCompilation;
}

/** Native signer only. Exact runtime-owned request/proof identity and current
 * engine are checked BEFORE exporting frozen detached facts. This data is not a
 * grant; an actor must independently verify the native signature and final real
 * parent Guardian/SYSTEM/owner COMMIT fence before using the canonical core. */
export function inspectCalendarInitialSeriesCompilation(handle: CalendarInitialSeriesRequest,
  compiled: CalendarInitialSeriesCompilation): CalendarInitialSeriesCompilationFrame {
  const value = request(handle), proof = compiled && typeof compiled === 'object' ? compilations.get(compiled) : undefined;
  if (!proof || proof.request !== value) return forbidden();
  synchronous(proof.assertEngineCurrent);
  return Object.freeze({ request: value, interval: proof.interval, engineGeneration: proof.engineGeneration });
}

export interface CalendarInitialSeriesManagedDependencies {
  readonly owner: CalendarOwnerRecord; readonly scope: ServiceDataScope;
  readonly config: Pick<ResolvedCalendarConfig, 'maxResources' | 'maxParticipants' | 'participants'>;
  readonly policyGeneration: string; readonly preparationTtlMs: number;
  readonly participants?: Pick<CalendarParticipantDirectory, 'assertBindable'>;
  /** Native physical owner/root/realm/lifetime equality, not an authored source claim. */
  assertOwnerCurrent(owner: CalendarOwnerRecord): void;
  /** Explicit configured service authority; this does not impersonate the initiating human on later work. */
  assertSeriesAuthorityCurrent(policyGeneration: string): void;
}
export interface CalendarInitialSeriesCommand {
  /** Call inside the broker's tracked native writer. The capability is never an IPC/browser payload. */
  run(context: DatabaseWriteCommandContext): CalendarSeriesPlanAcceptance;
  /** Mandatory actual-COMMIT callback, composed with the broker's Guardian revision/lease fence. */
  assertCommitCurrent(): void;
}

/** Constructs one private command from code-owned dependencies. No session, grant or ambient SYSTEM fallback is invented. */
export function createCalendarInitialSeriesCommand(dependencies: CalendarInitialSeriesManagedDependencies,
  authority: CalendarRequestAuthority, requestHandle: CalendarInitialSeriesRequest,
  compiled?: CalendarInitialSeriesCompilation): CalendarInitialSeriesCommand {
  const value = request(requestHandle), scopeId = calendarScope(serviceDataScopeKey(dependencies.scope));
  const owner = Object.freeze({ ...dependencies.owner }), policyGeneration = hash(dependencies.policyGeneration);
  const ttl = calendarInteger(dependencies.preparationTtlMs, 1_000, 86_400_000);
  if (owner.established !== 1 || owner.scope_id !== scopeId || owner.id !== 'calendar:' + calendarHash(scopeId)
    || !/^[a-f0-9]{64}$/.test(owner.root_hash) || !/^sha256:[a-f0-9]{64}$/.test(owner.realm_fingerprint)) return state();
  if (scopeId !== value.scopeId || serviceDataScopeKey(authority.scope) !== scopeId || authority.actor.scopeId !== scopeId
    || authority.actor.principal !== value.principal || authority.actor.userId !== value.userId || !authority.actor.manageAll) return forbidden();
  const checkOwner = dependencies.assertOwnerCurrent.bind(dependencies), checkPolicy = dependencies.assertSeriesAuthorityCurrent.bind(dependencies);
  const directory = dependencies.participants, config = dependencies.config;
  const maximumResources = calendarInteger(config.maxResources, 1, 16), maximumParticipants = calendarInteger(config.maxParticipants, 1, 100);
  const participantPolicy = calendarHash(config.participants), participantMethod = directory?.assertBindable;
  const assertParticipants = participantMethod?.bind(directory), assertAuthority = authority.guard.bind(authority);
  const assertConfiguration = () => {
    if (dependencies.config !== config || config.maxResources !== maximumResources || config.maxParticipants !== maximumParticipants || calendarHash(config.participants) !== participantPolicy
      || dependencies.participants !== directory || directory?.assertBindable !== participantMethod) throw new CalendarError('CALENDAR_POLICY_STALE');
  };
  let fresh = false, assertEngineCurrent: (() => void) | undefined;
  const guard = () => {
    if (!(authority.signal instanceof AbortSignal)) return forbidden(); authority.signal.throwIfAborted();
    synchronous(assertAuthority); synchronous(() => checkOwner(owner));
    if (serviceDataScopeKey(authority.scope) !== scopeId || authority.actor.scopeId !== scopeId || authority.actor.principal !== value.principal
      || authority.actor.userId !== value.userId || !authority.actor.manageAll) return forbidden();
    if (fresh) {
      assertConfiguration();
      if (assertEngineCurrent) synchronous(assertEngineCurrent);
      synchronous(() => checkPolicy(policyGeneration));
      if (value.authoring.template.participants.length) {
        if (!config.participants || !assertParticipants) throw new CalendarError('CALENDAR_NOT_READY');
        synchronous(() => assertParticipants(authority.scope, value.authoring.template.participants));
      }
      if (assertEngineCurrent) synchronous(assertEngineCurrent);
      assertConfiguration();
    }
    synchronous(assertAuthority);
  };
  const admission = createCalendarInitialSeriesSourceAdmission({ owner, policyGeneration, preparationTtlMs: ttl, maximumResources, maximumParticipants,
    guard(isFresh) { fresh = isFresh; guard(); },
    compilation() {
      const proof = compiled && typeof compiled === 'object' ? compilations.get(compiled) : undefined;
      if (!proof || proof.request !== value) return forbidden();
      assertEngineCurrent = proof.assertEngineCurrent;
      return inspectCalendarInitialSeriesCompilation(requestHandle, compiled!);
    },
    resource(context, id) {
      const row = calendarResource(context, authority.actor, id); requireCalendarRight(context, authority.actor, row, 'book'); return row;
    },
  }, value);
  return Object.freeze({ run: admission.run, assertCommitCurrent: admission.assertCommitCurrent });
}
