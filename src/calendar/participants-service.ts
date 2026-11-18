/** Native target admission is resolved in SYSTEM at the parent's actual commit fence, never in a calendar actor. */
import type { ServiceDataScope } from '../auth/service-data-scope';
import { invokeSynchronousAuthCallback } from '../auth/auth-synchronous-callback';
import type { CalendarRequestAuthority } from './authority';
import type { ResolvedCalendarConfig } from './config';
import type { CalendarActor, CalendarCommandReceipt, CalendarParticipantReference } from './contracts';
import type { CalendarParticipantDirectory } from './participants-directory';
import type { CalendarServiceBroker } from './service';
import { CalendarError } from './error';
import { calendarInteger, calendarKey, calendarRecord } from './validation';
import { calendarParticipantReferences, calendarParticipantSearch } from './participants-validation';

interface BoundReferences { readonly id: string; readonly revision: number; readonly references: readonly CalendarParticipantReference[] | null }
const PARTICIPANT_QUERIES = ['calendar.participantDirectory', 'calendar.participantsForAppointment', 'calendar.participantsForHold'];
function synchronousProjection<T>(project: () => T): T {
  return invokeSynchronousAuthCallback(project, { component: 'calendar', invariant: 'participant-projection-is-synchronous',
    message: 'Calendar participant projection must not yield.' });
}

export function calendarParticipantQuery(input: unknown, config: ResolvedCalendarConfig) {
  const value = calendarRecord(input, ['search', 'limit', 'after']);
  return Object.freeze({
    ...(value.search === undefined ? {} : { search: calendarParticipantSearch(value.search) }),
    ...(value.limit === undefined ? {} : { limit: calendarInteger(value.limit, 1, config.maxPageSize) }),
    ...(value.after === undefined ? {} : { after: calendarKey(value.after) }),
  });
}

function requireParticipants(config: ResolvedCalendarConfig, directory: CalendarParticipantDirectory | undefined, actor: CalendarActor): CalendarParticipantDirectory {
  if (!actor.manageAll) throw new CalendarError('CALENDAR_FORBIDDEN');
  if (!config.participants || !directory) throw new CalendarError('CALENDAR_NOT_READY');
  return directory;
}

/** Only these fixed local queries may resolve SYSTEM presentation. Actors receive opaque references, never profiles. */
export function calendarParticipantBroker(broker: CalendarServiceBroker, directory: CalendarParticipantDirectory | undefined,
  config: ResolvedCalendarConfig): CalendarServiceBroker {
  return {
    async read<T>(scope: ServiceDataScope, name: string, input: unknown, guard: () => void, signal?: AbortSignal): Promise<T> {
      if (!PARTICIPANT_QUERIES.includes(name)) {
        return broker.read(scope, name, input, guard, signal);
      }
      signal?.throwIfAborted(); guard();
      const value = calendarRecord(input, name === 'calendar.participantDirectory' ? ['actor', 'search', 'limit', 'after'] : ['actor', 'id']);
      const actor = value.actor as CalendarActor, source = requireParticipants(config, directory, actor);
      let result: unknown;
      if (name === 'calendar.participantDirectory') {
        const { actor: _actor, ...query } = value;
        result = synchronousProjection(() => source.list(scope, calendarParticipantQuery(query, config)));
      } else {
        const bound = await broker.read<BoundReferences>(scope,
          name === 'calendar.participantsForAppointment' ? 'calendar.appointmentParticipants' : 'calendar.holdParticipants',
          { actor, id: calendarKey(value.id) }, guard, signal);
        signal?.throwIfAborted(); guard();
        result = { id: bound.id, revision: bound.revision, participants: synchronousProjection(() => source.resolve(scope, bound.references ?? [])) };
      }
      signal?.throwIfAborted(); guard(); return result as T;
    },
    write: (scope, name, input, requestId, guard, signal, finalCommitGuard) => broker.write(scope, name, input, requestId, guard, signal, finalCommitGuard),
    publish<T>(scope: ServiceDataScope, name: string, input: unknown, value: T, guard: () => void): T {
      if (!PARTICIPANT_QUERIES.includes(name)) return value;
      guard();
      const r = input as { actor: CalendarActor }, source = requireParticipants(config, directory, r.actor);
      let result: unknown;
      if (name === 'calendar.participantDirectory') {
        const { actor: _actor, ...query } = input as Record<string, unknown>;
        result = synchronousProjection(() => source.list(scope, calendarParticipantQuery(query, config)));
      } else {
        const page = value as { id: string; revision: number; participants: readonly { ref: CalendarParticipantReference }[] };
        result = { id: page.id, revision: page.revision, participants: synchronousProjection(() => source.resolve(scope, page.participants.map(item => item.ref))) };
      }
      guard(); return result as T;
    },
    subscribe(scope, listener, queryName) {
      const remove = broker.subscribe?.(scope, listener, queryName);
      let removeDirectory: (() => void) | undefined;
      try { if (queryName && PARTICIPANT_QUERIES.includes(queryName)) removeDirectory = directory?.subscribe(scope, listener); }
      catch (error) { remove?.(); throw error; }
      return () => { try { remove?.(); } finally { removeDirectory?.(); } };
    },
  };
}

/** A receipt lookup is not a replay bypass: the actor still compares the entire original intent. */
export async function calendarParticipantCommitGuard(input: {
  broker: CalendarServiceBroker; directory?: CalendarParticipantDirectory; config: ResolvedCalendarConfig;
  authority: CalendarRequestAuthority; operation: string; body: Record<string, unknown>; key: string;
  id: string | null; expectedRevision?: number;
}): Promise<() => void> {
  const { broker, directory, config, authority, operation, body, key, id, expectedRevision } = input;
  const supplied = Object.hasOwn(body, 'participants') || operation === 'appointment.participants';
  if (!supplied && operation !== 'hold.confirm') return authority.guard;
  if (supplied) requireParticipants(config, directory, authority.actor);
  const prior = await broker.read<CalendarCommandReceipt | null>(authority.scope, 'calendar.receipt',
    { actor: authority.actor, requestId: key }, authority.guard, authority.signal);
  await authority.confirm(); authority.guard();
  if (prior !== null) return authority.guard;
  let references: readonly CalendarParticipantReference[] = [];
  if (operation === 'hold.confirm' || operation === 'appointment.participants') {
    const bound = await broker.read<BoundReferences>(authority.scope,
      operation === 'hold.confirm' ? 'calendar.holdParticipantAdmission' : 'calendar.appointmentParticipants',
      { actor: authority.actor, id }, authority.guard, authority.signal);
    await authority.confirm(); authority.guard();
    if (bound.id !== id || bound.revision !== expectedRevision) throw new CalendarError('CALENDAR_REVISION_CONFLICT');
    if (operation === 'hold.confirm') {
      if (bound.references === null) return authority.guard;
      requireParticipants(config, directory, authority.actor);
      references = calendarParticipantReferences(bound.references);
    } else {
      const previous = new Set((bound.references ?? []).map(ref => ref.userId));
      references = calendarParticipantReferences(body.references).filter(ref => !previous.has(ref.userId));
    }
  } else references = calendarParticipantReferences(body.participants);
  const source = requireParticipants(config, directory, authority.actor);
  // DatabaseCommitAuthority captures the durable Guardian revision before this
  // callback and validates it under the shared authority fence at SQLite COMMIT.
  // Never turn this synchronous callback into an async preflight-only policy.
  const assertTargets = () => {
    authority.guard();
    const result: unknown = invokeSynchronousAuthCallback(() => source.assertBindable(authority.scope, references), {
      component: 'calendar', invariant: 'participant-target-admission-is-synchronous',
      message: 'Calendar participant target admission must not yield.',
    });
    if (result !== undefined) throw new CalendarError('CALENDAR_CONFIG_INVALID');
    authority.guard();
  };
  // Friendly current rejection before queue admission; never a substitute for
  // the same synchronous check under the real final commit fence.
  assertTargets();
  return assertTargets;
}
