/** One facade for HTTP and server callers. Authority, routing and IDs never come from authored input. */
import type { ServiceDataScope } from '../auth/service-data-scope';
import type { CalendarCommandReceipt, CalendarControlOptions, CalendarReadOptions, CalendarOverrideReview,
  CalendarRequestOptions, CalendarWatchOptions, ScopedCalendar } from './contracts';
import { CalendarError } from './error';
import { calendarHash, calendarInteger, calendarKey, calendarRecord, calendarValue } from './validation';
import { admitCalendarRequest, type CalendarAuthority } from './authority';
import type { ResolvedCalendarConfig } from './config';
import { calendarLocationIds, calendarLocationInput, calendarPageQuery, calendarResourcePageQuery, calendarRange, calendarReceipt,
  calendarAppointmentTypePageQuery, calendarAppointmentTypeInput, calendarTypeReference, calendarResourceTypesInput,
  calendarLifecyclePolicyInput, calendarAppointmentTransitionInput, calendarLifecycleReason, calendarVisitInput, calendarVisitLocationQuery,
  calendarDateRange,
  calendarAppointmentTransportInput, calendarOverrideReviewResult } from './service-validation';
import { watchCalendarPage } from './watch';
import type { CalendarParticipantDirectory } from './participants-directory';
import { calendarParticipantBroker, calendarParticipantCommitGuard, calendarParticipantQuery } from './participants-service';
import { calendarParticipantReferences } from './participants-validation';
import { calendarCapabilitiesBroker } from './capabilities';
import { normalizeCalendarAvailabilityPolicy } from './working-hours-model';
import { normalizeCalendarResourceLocationPolicy, calendarLocationPolicyIds } from './location-policy-model';
import { normalizeCalendarAppointmentOverride, normalizeCalendarOverrideGrant } from './override-model';
import { calendarOverrideGrantCommitGuard, type CalendarOverrideGrantTargets } from './override-grant-targets';

export interface CalendarServiceBroker {
  read<T>(scope: ServiceDataScope, name: string, input: unknown, guard: () => void, signal?: AbortSignal): Promise<T>;
  write<T>(scope: ServiceDataScope, name: string, input: unknown, requestId: string, guard: () => void, signal?: AbortSignal,
    finalCommitGuard?: () => void): Promise<T>;
  /** Payload-free hints after actual commits. Every consumer must make a fresh authorized query. */
  subscribe?(scope: ServiceDataScope, listener: () => void, queryName?: string): () => void;
  /** Trusted synchronous publication projection after the last asynchronous authority check. */
  publish?<T>(scope: ServiceDataScope, name: string, input: unknown, value: T, guard: () => void): T;
}

/** No caller may choose an actor, scope or operation through this object. */
export class CalendarService {
  private readonly stop = new AbortController();
  private readonly active = new Set<Promise<unknown>>();
  private readonly signal: AbortSignal;
  constructor(private readonly broker: CalendarServiceBroker, private readonly config: ResolvedCalendarConfig,
    closing: AbortSignal, private readonly participantDirectory?: CalendarParticipantDirectory,
    private readonly overrideTargets?: CalendarOverrideGrantTargets) {
    this.signal = AbortSignal.any([closing, this.stop.signal]);
    this.broker = calendarCapabilitiesBroker(calendarParticipantBroker(broker, participantDirectory, config), config, participantDirectory !== undefined);
  }

  forAuthority(request: CalendarAuthority): ScopedCalendar & {
    /** @internal Compatibility with the initial unexported foundation. */
    createResource(input: unknown, requestId: string): Promise<CalendarCommandReceipt>;
    createAppointment(input: unknown, requestId: string): Promise<CalendarCommandReceipt>;
  } {
    const createResource = (input: unknown, options: CalendarRequestOptions) => this.write(request, 'resource.create', input, options);
    const createAppointment = (input: unknown, options: CalendarRequestOptions) => this.write(request, 'appointment.create', input, options);
    return Object.freeze({
      overrides: Object.freeze({ grants: Object.freeze<ScopedCalendar['overrides']['grants']>({
        get: (id, userId, options) => this.read(request, 'overrideGrant', () => ({ id: calendarKey(id), userId: calendarKey(userId) }), options),
        replace: (id, userId, input, options) => this.write(request, 'resource.override-grant',
          { ...normalizeCalendarOverrideGrant(input), userId: calendarKey(userId) }, options, id),
        watch: (id, userId, listener, options: CalendarWatchOptions = {}) => {
          const query = Object.freeze({ id: calendarKey(id), userId: calendarKey(userId) }); this.ready();
          return watchCalendarPage({ request, broker: this.broker, config: this.config, closing: this.signal,
            queryName: 'calendar.overrideGrant', query, listener, options, track: task => this.track(task) });
        },
      }) }),
      capabilities: Object.freeze({
        get: options => this.read(request, 'capabilities', () => ({}), options),
        watch: (listener, options: CalendarWatchOptions = {}) => {
          this.ready();
          return watchCalendarPage({ request, broker: this.broker, config: this.config, closing: this.signal,
            queryName: 'calendar.capabilities', query: Object.freeze({}), listener, options, track: task => this.track(task) });
        },
      }),
      participants: Object.freeze({
        directory: (query = {}, options) => this.read(request, 'participantDirectory', () => calendarParticipantQuery(query, this.config), options),
        forAppointment: (id, options) => this.read(request, 'participantsForAppointment', () => ({ id: calendarKey(id) }), options),
        forHold: (id, options) => this.read(request, 'participantsForHold', () => ({ id: calendarKey(id) }), options),
        replace: (id, references, options) => this.write(request, 'appointment.participants', { references }, options, id),
        watchDirectory: (query, listener, options: CalendarWatchOptions = {}) => {
          const detached = calendarParticipantQuery(query, this.config); this.ready();
          return watchCalendarPage({ request, broker: this.broker, config: this.config, closing: this.signal,
            queryName: 'calendar.participantDirectory', query: detached, listener, options, track: task => this.track(task) });
        },
        watchForAppointment: (id, listener, options: CalendarWatchOptions = {}) => {
          const query = Object.freeze({ id: calendarKey(id) }); this.ready();
          return watchCalendarPage({ request, broker: this.broker, config: this.config, closing: this.signal,
            queryName: 'calendar.participantsForAppointment', query, listener, options, track: task => this.track(task) });
        },
        watchForHold: (id, listener, options: CalendarWatchOptions = {}) => {
          const query = Object.freeze({ id: calendarKey(id) }); this.ready();
          return watchCalendarPage({ request, broker: this.broker, config: this.config, closing: this.signal,
            queryName: 'calendar.participantsForHold', query, listener, options, track: task => this.track(task) });
        },
      }),
      lifecycle: Object.freeze({
        get: (options) => this.read(request, 'lifecycle', () => ({}), options),
        replace: (input, options) => this.write(request, 'lifecycle.replace', input, options, 'policy'),
        watch: (listener, options: CalendarWatchOptions = {}) => {
          this.ready();
          return watchCalendarPage({ request, broker: this.broker, config: this.config, closing: this.signal,
            queryName: 'calendar.lifecycle', query: Object.freeze({}), listener, options, track: task => this.track(task) });
        },
      }),
      types: Object.freeze({
        list: (query = {}, options?: CalendarReadOptions) => this.read(request, 'types', () => calendarAppointmentTypePageQuery(query, this.config), options),
        get: (id, options) => this.read(request, 'type', () => ({ id: calendarKey(id) }), options),
        create: (input, options) => this.write(request, 'type.create', input, options),
        replace: (id, input, options) => this.write(request, 'type.replace', input, options, id),
        forResource: (id, options) => this.read(request, 'resourceTypes', () => ({ id: calendarKey(id) }), options),
        watch: (query, listener, options: CalendarWatchOptions = {}) => {
          const detached = calendarAppointmentTypePageQuery(query, this.config); this.ready();
          return watchCalendarPage({ request, broker: this.broker, config: this.config, closing: this.signal,
            queryName: 'calendar.types', query: detached, listener, options, track: task => this.track(task) });
        },
        watchType: (id, listener, options: CalendarWatchOptions = {}) => {
          const query = Object.freeze({ id: calendarKey(id) }); this.ready();
          return watchCalendarPage({ request, broker: this.broker, config: this.config, closing: this.signal,
            queryName: 'calendar.type', query, listener, options, track: task => this.track(task) });
        },
        watchForResource: (id, listener, options: CalendarWatchOptions = {}) => {
          const query = Object.freeze({ id: calendarKey(id) }); this.ready();
          return watchCalendarPage({ request, broker: this.broker, config: this.config, closing: this.signal,
            queryName: 'calendar.resourceTypes', query, listener, options, track: task => this.track(task) });
        },
      }),
      locations: Object.freeze({
        policy: Object.freeze<ScopedCalendar['locations']['policy']>({
          get: (id, options) => this.read(request, 'resourceLocationPolicy', () => ({ id: calendarKey(id) }), options),
          replace: (id, input, options) => this.write(request, 'resource.location-policy', input, options, id),
          watch: (id, listener, options: CalendarWatchOptions = {}) => {
            const query = Object.freeze({ id: calendarKey(id) }); this.ready();
            return watchCalendarPage({ request, broker: this.broker, config: this.config, closing: this.signal,
              queryName: 'calendar.resourceLocationPolicy', query, listener, options, track: task => this.track(task) });
          },
        }),
        forVisit: (query, options) => this.read(request, 'visitLocations', () => calendarVisitLocationQuery(query, this.config), options),
        watchForVisit: (query, listener, options: CalendarWatchOptions = {}) => {
          const detached = calendarVisitLocationQuery(query, this.config); this.ready();
          return watchCalendarPage({ request, broker: this.broker, config: this.config, closing: this.signal,
            queryName: 'calendar.visitLocations', query: detached, listener, options, track: task => this.track(task) });
        },
        list: (query = {}, options?: CalendarReadOptions) => this.read(request, 'locations', () => calendarPageQuery(query, this.config), options),
        get: (id, options) => this.read(request, 'location', () => ({ id: calendarKey(id) }), options),
        create: (input, options) => this.write(request, 'location.create', input, options),
        replace: (id, input, options) => this.write(request, 'location.replace', input, options, id),
        forResource: (id, options) => this.read(request, 'resourceLocations', () => ({ id: calendarKey(id) }), options),
        watch: (query, listener, options: CalendarWatchOptions = {}) => {
          const detached = calendarPageQuery(query, this.config); this.ready();
          return watchCalendarPage({ request, broker: this.broker, config: this.config, closing: this.signal,
            queryName: 'calendar.locations', query: detached, listener, options, track: task => this.track(task) });
        },
        watchLocation: (id, listener, options: CalendarWatchOptions = {}) => {
          const query = Object.freeze({ id: calendarKey(id) }); this.ready();
          return watchCalendarPage({ request, broker: this.broker, config: this.config, closing: this.signal,
            queryName: 'calendar.location', query, listener, options, track: task => this.track(task) });
        },
        watchForResource: (id, listener, options: CalendarWatchOptions = {}) => {
          const query = Object.freeze({ id: calendarKey(id) }); this.ready();
          return watchCalendarPage({ request, broker: this.broker, config: this.config, closing: this.signal,
            queryName: 'calendar.resourceLocations', query, listener, options, track: task => this.track(task) });
        },
      }),
      resources: Object.freeze({
        list: (query = {}, options?: CalendarReadOptions) => this.read(request, 'resources', () => calendarResourcePageQuery(query, this.config), options),
        create: createResource,
        setGrants: (id: string, userId: string, grants: readonly string[], options: CalendarControlOptions) =>
          this.write(request, 'resource.grant', { userId, grants }, options, id),
        setLocations: (id, locationIds, options) => this.write(request, 'resource.locations', { locationIds }, options, id),
        setAppointmentTypes: (id, input, options) => this.write(request, 'resource.types', input, options, id),
        watch: (query, listener, options: CalendarWatchOptions = {}) => {
          const detached = calendarResourcePageQuery(query, this.config); this.ready();
          return watchCalendarPage({ request, broker: this.broker, config: this.config, closing: this.signal,
            queryName: 'calendar.resources', query: detached, listener, options, track: task => this.track(task) });
        },
      }),
      availability: Object.freeze<ScopedCalendar['availability']>({
        policy: Object.freeze<ScopedCalendar['availability']['policy']>({
          get: (id, options) => this.read(request, 'availabilityPolicy', () => ({ id: calendarKey(id) }), options),
          replace: (id, input, options) => this.write(request, 'resource.availability-policy', input, options, id),
          watch: (id, listener, options: CalendarWatchOptions = {}) => {
            const query = Object.freeze({ id: calendarKey(id) }); this.ready();
            return watchCalendarPage({ request, broker: this.broker, config: this.config, closing: this.signal,
              queryName: 'calendar.availabilityPolicy', query, listener, options, track: task => this.track(task) });
          },
        }),
        get: (id, options) => this.read(request, 'availability', () => ({ id: calendarKey(id) }), options),
        replace: (id, input, options) => this.write(request, 'resource.availability', input, options, id),
        watch: (id, listener, options: CalendarWatchOptions = {}) => {
          const query = Object.freeze({ id: calendarKey(id) }); this.ready();
          return watchCalendarPage({ request, broker: this.broker, config: this.config, closing: this.signal,
            queryName: 'calendar.availability', query, listener, options, track: task => this.track(task) });
        },
      }),
      blocks: Object.freeze({
        query: (query, options) => this.read(request, 'blocks', () => calendarRange(query, this.config), options),
        get: (id, options) => this.read(request, 'block', () => ({ id: calendarKey(id) }), options),
        create: (input, options) => this.write(request, 'block.create', input, options),
        reschedule: (id, input, options) => this.write(request, 'block.reschedule', input, options, id),
        cancel: (id, options) => this.write(request, 'block.cancel', {}, options, id),
        watch: (query, listener, options: CalendarWatchOptions = {}) => {
          const detached = calendarRange(query, this.config); this.ready();
          return watchCalendarPage({ request, broker: this.broker, config: this.config, closing: this.signal,
            queryName: 'calendar.blocks', query: detached, listener, options, track: task => this.track(task) });
        },
      }),
      holds: Object.freeze({
        query: (query, options) => this.read(request, 'holds', () => calendarRange(query, this.config), options),
        get: (id, options) => this.read(request, 'hold', () => ({ id: calendarKey(id) }), options),
        acquire: (input, options) => this.write(request, 'hold.acquire', input, options),
        release: (id, options) => this.write(request, 'hold.release', {}, options, id),
        confirm: (id, input, options) => this.write(request, 'hold.confirm', input, options, id),
        watch: (query, listener, options: CalendarWatchOptions = {}) => {
          const detached = calendarRange(query, this.config); this.ready();
          return watchCalendarPage({ request, broker: this.broker, config: this.config, closing: this.signal,
            queryName: 'calendar.holds', query: detached, listener, options, track: task => this.track(task) });
        },
      }),
      appointments: Object.freeze({
        query: (query, options) => this.read(request, 'appointments', () => calendarRange(query, this.config), options),
        queryDates: (query, options) => this.read(request, 'appointmentsByDate', () => calendarDateRange(query, this.config), options),
        get: (id, options) => this.read(request, 'appointment', () => ({ id: calendarKey(id) }), options),
        create: createAppointment,
        update: (id, input, options) => this.write(request, 'appointment.update', input, options, id),
        reviewCreate: (input, options) => this.review(request, 'appointment.create', input, options),
        reviewUpdate: (id, input, options) => this.review(request, 'appointment.update', input, options, id),
        reschedule: (id, input, options) => this.write(request, 'appointment.reschedule', input, options, id),
        cancel: (id, options) => this.write(request, 'appointment.cancel', {}, options, id),
        transitions: (id, options) => this.read(request, 'appointmentTransitions', () => ({ id: calendarKey(id) }), options),
        transition: (id, input, options) => this.write(request, 'appointment.transition', input, options, id),
        watchTransitions: (id, listener, options: CalendarWatchOptions = {}) => {
          const query = Object.freeze({ id: calendarKey(id) }); this.ready();
          return watchCalendarPage({ request, broker: this.broker, config: this.config, closing: this.signal,
            queryName: 'calendar.appointmentTransitions', query, listener, options, track: task => this.track(task) });
        },
        watch: (query, listener, options: CalendarWatchOptions = {}) => {
          const detached = calendarRange(query, this.config);
          this.ready();
          return watchCalendarPage({ request, broker: this.broker, config: this.config, closing: this.signal,
            query: detached, listener, options, track: task => this.track(task) });
        },
        watchDates: (query, listener, options: CalendarWatchOptions = {}) => {
          const detached = calendarDateRange(query, this.config); this.ready();
          return watchCalendarPage({ request, broker: this.broker, config: this.config, closing: this.signal,
            queryName: 'calendar.appointmentsByDate', query: detached, listener, options, track: task => this.track(task) });
        },
      }),
      busy: Object.freeze({ query: (query, options) => this.read(request, 'busy', () => calendarRange(query, this.config), options) }),
      receipts: Object.freeze({ get: (key, options) => this.read(request, 'receipt', () => ({ requestId: calendarKey(key) }), options) }),
      createResource: (input: unknown, key: string) => createResource(input, { idempotencyKey: key }),
      createAppointment: (input: unknown, key: string) => createAppointment(input, { idempotencyKey: key }),
    } satisfies ScopedCalendar & {
      createResource(input: unknown, requestId: string): Promise<CalendarCommandReceipt>;
      createAppointment(input: unknown, requestId: string): Promise<CalendarCommandReceipt>;
    });
  }

  private ready() { this.signal.throwIfAborted(); if (this.config.readiness !== 'configured') throw new CalendarError('CALENDAR_NOT_READY'); }
  private track<T>(task: Promise<T>): Promise<T> {
    this.active.add(task);
    void task.then(() => this.active.delete(task), () => this.active.delete(task));
    return task;
  }
  async close(): Promise<void> { this.stop.abort(); await Promise.allSettled([...this.active]); }

  private read<T>(request: CalendarAuthority, name: string, prepare: () => object, options?: CalendarReadOptions): Promise<T> {
    return this.track((async () => {
      this.ready();
      // Every Promise-returning facade rejects asynchronously, while query and
      // option admission still detaches caller input before the first await.
      const body = prepare(), opts = calendarRecord(options ?? {}, ['signal']);
      const authority = await admitCalendarRequest(request, this.config, this.signal, opts.signal as AbortSignal | undefined);
      authority.guard();
      let dirty = false;
      const remove = this.broker.subscribe?.(authority.scope, () => { dirty = true; }, 'calendar.' + name);
      try {
        // Strong SQL reads linearize at their query. If this owner observes a
        // newer domain commit during the final async Guardian check, do not
        // deliver the known-stale private page. Bound retries under a hot writer.
        for (let attempt = 0; attempt < 4; attempt++) {
          authority.guard(); dirty = false;
          const result = await this.broker.read<T>(authority.scope, 'calendar.' + name, { ...body, actor: authority.actor }, authority.guard, authority.signal);
          await authority.confirm(); authority.guard();
          if (!dirty) return this.broker.publish?.(authority.scope, 'calendar.' + name,
            { ...body, actor: authority.actor }, result, authority.guard) ?? result;
        }
        throw new CalendarError('CALENDAR_NOT_READY');
      } finally { remove?.(); }
    })());
  }

  /** A proposed key is read-only here. Only an explicit later write can spend it. */
  private review(request: CalendarAuthority, operation: 'appointment.create' | 'appointment.update', input: unknown,
    options: CalendarRequestOptions, target?: string): Promise<CalendarOverrideReview> {
    return this.track((async () => {
      this.ready();
      const body = calendarAppointmentTransportInput(input, this.config, operation === 'appointment.update');
      const opts = calendarRecord(options, ['idempotencyKey', 'signal', ...(target === undefined ? [] : ['expectedRevision'])]);
      const key = calendarKey(opts.idempotencyKey), id = target === undefined ? null : calendarKey(target);
      const expectedRevision = id === null ? undefined : calendarInteger(opts.expectedRevision, 1);
      const authority = await admitCalendarRequest(request, this.config, this.signal, opts.signal as AbortSignal | undefined);
      authority.guard();
      const participantGuard = await calendarParticipantCommitGuard({ broker: this.broker, directory: this.participantDirectory,
        config: this.config, authority, operation, body, key, id, expectedRevision });
      const guard = () => { authority.guard(); participantGuard(); authority.guard(); };
      const name = operation === 'appointment.create' ? 'calendar.appointmentReviewCreate' : 'calendar.appointmentReviewUpdate';
      const query = { ...body, actor: authority.actor, requestId: key,
        id: id ?? calendarHash([authority.actor.scopeId, authority.actor.principal, key]),
        ...(expectedRevision === undefined ? {} : { expectedRevision }) };
      let dirty = false;
      const remove = this.broker.subscribe?.(authority.scope, () => { dirty = true; }, name);
      try {
        for (let attempt = 0; attempt < 4; attempt++) {
          guard(); dirty = false;
          const result = await this.broker.read<unknown>(authority.scope, name, query, guard, authority.signal);
          await authority.confirm(); guard();
          if (!dirty) {
            const admitted = calendarOverrideReviewResult(result);
            return this.broker.publish?.(authority.scope, name, query, admitted, guard) ?? admitted;
          }
        }
        throw new CalendarError('CALENDAR_NOT_READY');
      } finally { remove?.(); }
    })());
  }

  private write(request: CalendarAuthority, operation: string, input: unknown, options: CalendarRequestOptions, target?: string): Promise<CalendarCommandReceipt> {
    return this.track((async () => {
      this.ready();
      const fields = operation === 'resource.create' ? ['label', 'kind', 'ownerId', 'timeZone']
        : operation === 'resource.availability-policy' ? ['kind', 'mode', 'windows', 'coverage', 'fold', 'weekly', 'overrides']
        : operation === 'appointment.participants' ? ['references']
        : operation === 'lifecycle.replace' ? ['extended', 'cancellationReason', 'noShowReason']
        : operation === 'appointment.transition' ? ['status', 'policyRevision', 'reason']
        : operation === 'type.create' || operation === 'type.replace' ? ['label', 'durationMinutes', 'bufferBeforeMinutes', 'bufferAfterMinutes', 'colorKey', 'active']
        : operation === 'resource.types' ? ['mode', 'typeIds']
        : operation === 'location.create' || operation === 'location.replace' ? ['label', 'region', 'active']
        : operation === 'resource.locations' ? ['locationIds']
        : operation === 'resource.location-policy' ? ['kind', 'locationIds', 'assignments']
        : operation === 'resource.grant' ? ['userId', 'grants']
        : operation === 'resource.override-grant' ? ['userId', 'categories']
        : operation === 'resource.availability' ? ['mode', 'windows']
        : operation === 'block.cancel' || operation === 'appointment.cancel' || operation === 'hold.release' ? []
        : operation === 'hold.confirm' ? ['title']
        : operation === 'hold.acquire' ? ['resourceIds', 'startAt', 'endAt', 'timeZone', 'bufferBeforeMinutes', 'bufferAfterMinutes', 'ttlSeconds', 'appointmentType', 'visit', 'participants']
        : operation === 'block.reschedule' ? ['startAt', 'endAt', 'timeZone']
        : operation === 'block.create' ? ['resourceIds', 'title', 'startAt', 'endAt', 'timeZone']
        : operation === 'appointment.reschedule' ? ['startAt', 'endAt', 'timeZone', 'bufferBeforeMinutes', 'bufferAfterMinutes', 'appointmentType', 'visit']
        : ['resourceIds', 'title', 'startAt', 'endAt', 'timeZone', 'bufferBeforeMinutes', 'bufferAfterMinutes', 'appointmentType', 'visit', 'participants', 'interval'];
      // Detach before the first await; authored mutation cannot alter an admitted command.
      const appointmentIntent = operation === 'appointment.create' || operation === 'appointment.update';
      const body = appointmentIntent ? calendarAppointmentTransportInput(input, this.config, operation === 'appointment.update')
        : calendarValue(calendarRecord(input, fields)) as Record<string, unknown>;
      for (const field of ['participants', 'references'] as const) if (Object.hasOwn(body, field)) {
        body[field] = calendarParticipantReferences(body[field]);
        if ((body[field] as unknown[]).length > this.config.maxParticipants) throw new CalendarError('CALENDAR_INPUT_INVALID');
      }
      if (operation === 'location.create' || operation === 'location.replace') calendarLocationInput(body, operation === 'location.replace');
      if (operation === 'resource.locations') body.locationIds = calendarLocationIds(body.locationIds);
      if (operation === 'resource.location-policy') Object.assign(body, normalizeCalendarResourceLocationPolicy(body));
      if (operation === 'resource.override-grant') {
        const { userId, ...grant } = body;
        Object.assign(body, normalizeCalendarOverrideGrant(grant), { userId: calendarKey(userId) });
      }
      if (operation === 'type.create' || operation === 'type.replace') calendarAppointmentTypeInput(body, operation === 'type.replace');
      if (operation === 'resource.types') Object.assign(body, calendarResourceTypesInput(body));
      if (operation === 'lifecycle.replace') Object.assign(body, calendarLifecyclePolicyInput(body));
      if (operation === 'resource.availability-policy') Object.assign(body, normalizeCalendarAvailabilityPolicy(body));
      if (operation === 'appointment.transition') Object.assign(body, calendarAppointmentTransitionInput(body));
      if (Object.hasOwn(body, 'appointmentType')) {
        if (body.appointmentType === null) { if (operation !== 'appointment.reschedule' && operation !== 'appointment.update') throw new CalendarError('CALENDAR_INPUT_INVALID'); }
        else body.appointmentType = calendarTypeReference(body.appointmentType);
      }
      if (Object.hasOwn(body, 'visit')) {
        if (body.visit === null) { if (operation !== 'appointment.reschedule' && operation !== 'appointment.update') throw new CalendarError('CALENDAR_INPUT_INVALID'); }
        else body.visit = calendarVisitInput(body.visit);
      }
      const opts = calendarRecord(options, [...(target === undefined ? ['idempotencyKey', 'signal']
        : ['idempotencyKey', 'signal', 'expectedRevision', ...(operation === 'appointment.cancel' ? ['reason'] : [])]),
        ...(appointmentIntent ? ['override'] : [])]);
      if (Object.hasOwn(opts, 'override')) body.override = normalizeCalendarAppointmentOverride(opts.override);
      if (operation === 'appointment.cancel' && Object.hasOwn(opts, 'reason')) body.reason = calendarLifecycleReason(opts.reason);
      const key = calendarKey(opts.idempotencyKey), id = target === undefined ? null : calendarKey(target);
      const expectedRevision = id === null ? undefined : calendarInteger(opts.expectedRevision, 1);
      if ((operation === 'appointment.create' || operation === 'block.create' || operation === 'hold.acquire')
        && (!Array.isArray(body.resourceIds) || body.resourceIds.length > this.config.maxResources)) throw new CalendarError('CALENDAR_INPUT_INVALID');
      if (operation === 'hold.acquire' && body.ttlSeconds !== undefined) calendarInteger(body.ttlSeconds, 1, 900);
      const authority = await admitCalendarRequest(request, this.config, this.signal, opts.signal as AbortSignal | undefined);
      authority.guard();
      const participantGuard = await calendarParticipantCommitGuard({ broker: this.broker, directory: this.participantDirectory,
        config: this.config, authority, operation, body, key, id, expectedRevision });
      authority.guard();
      const targetGuard = await calendarOverrideGrantCommitGuard({ broker: this.broker, targets: this.overrideTargets,
        authority, operation, body, key, id, expectedRevision });
      const commitGuard = () => { participantGuard(); targetGuard(); };
      authority.guard();
      if ((operation === 'resource.locations' || operation === 'resource.location-policy') && !authority.actor.manageAll) {
        // A location ID is metadata, not a visibility grant. Capture a currently
        // authorized assignment witness; the final writer checks its live rights
        // and membership again rather than trusting this read across the await.
        const prior = await this.broker.read<CalendarCommandReceipt | null>(authority.scope, 'calendar.receipt',
          { actor: authority.actor, requestId: key }, authority.guard, authority.signal);
        await authority.confirm(); authority.guard();
        if (prior === null) {
          body.locationWitnesses = await this.broker.read(authority.scope, 'calendar.locationAssignmentWitnesses',
            { actor: authority.actor, locationIds: operation === 'resource.locations' ? body.locationIds
              : calendarLocationPolicyIds(normalizeCalendarResourceLocationPolicy(body)) }, authority.guard, authority.signal);
          await authority.confirm(); authority.guard();
        }
      }
      const resolvedId = id ?? calendarHash([authority.actor.scopeId, authority.actor.principal, key]);
      // A hold is not an appointment identity. Only admitted server authority can
      // derive the appointment created by confirmation; authored IDs are rejected.
      const appointmentId = operation === 'hold.confirm'
        ? calendarHash(['appointment-from-hold', authority.actor.scopeId, authority.actor.principal, key]) : undefined;
      if (operation === 'resource.create' && body.ownerId === undefined) body.ownerId = body.kind === 'person' ? authority.actor.userId : null;
      const result = await this.broker.write<CalendarCommandReceipt>(authority.scope, 'calendar.' + operation,
        { ...body, actor: authority.actor, requestId: key, ...(operation === 'lifecycle.replace' ? {} : { id: resolvedId }),
          ...(expectedRevision === undefined ? {} : { expectedRevision }),
          ...(appointmentId === undefined ? {} : { appointmentId }),
          ...(operation === 'appointment.cancel' || operation === 'block.cancel' || operation === 'hold.release' ? { confirmed: true } : {}) }, key, authority.guard, authority.signal, commitGuard);
      try { await authority.confirm(); authority.guard(); return calendarReceipt(result, key, operation, appointmentId ?? resolvedId, expectedRevision); }
      catch { throw new CalendarError('CALENDAR_OUTCOME_UNKNOWN'); }
    })());
  }
}
