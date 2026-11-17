/** One facade for HTTP and server callers. Authority, routing and IDs never come from authored input. */
import type { ServiceDataScope } from '../auth/service-data-scope';
import type { CalendarCommandReceipt, CalendarControlOptions, CalendarReadOptions,
  CalendarRequestOptions, CalendarWatchOptions, ScopedCalendar } from './contracts';
import { CalendarError } from './error';
import { calendarHash, calendarInteger, calendarKey, calendarRecord, calendarValue } from './validation';
import { admitCalendarRequest, type CalendarAuthority } from './authority';
import type { ResolvedCalendarConfig } from './config';
import { calendarPageQuery, calendarRange, calendarReceipt } from './service-validation';
import { watchCalendarPage } from './watch';

export interface CalendarServiceBroker {
  read<T>(scope: ServiceDataScope, name: string, input: unknown, guard: () => void, signal?: AbortSignal): Promise<T>;
  write<T>(scope: ServiceDataScope, name: string, input: unknown, requestId: string, guard: () => void, signal?: AbortSignal): Promise<T>;
  /** Payload-free hints after actual commits. Every consumer must make a fresh authorized query. */
  subscribe?(scope: ServiceDataScope, listener: () => void): () => void;
}

/** No caller may choose an actor, scope or operation through this object. */
export class CalendarService {
  private readonly stop = new AbortController();
  private readonly active = new Set<Promise<unknown>>();
  private readonly signal: AbortSignal;
  constructor(private readonly broker: CalendarServiceBroker, private readonly config: ResolvedCalendarConfig,
    closing: AbortSignal) { this.signal = AbortSignal.any([closing, this.stop.signal]); }

  forAuthority(request: CalendarAuthority): ScopedCalendar & {
    /** @internal Compatibility with the initial unexported foundation. */
    createResource(input: unknown, requestId: string): Promise<CalendarCommandReceipt>;
    createAppointment(input: unknown, requestId: string): Promise<CalendarCommandReceipt>;
  } {
    const createResource = (input: unknown, options: CalendarRequestOptions) => this.write(request, 'resource.create', input, options);
    const createAppointment = (input: unknown, options: CalendarRequestOptions) => this.write(request, 'appointment.create', input, options);
    return Object.freeze({
      resources: Object.freeze({
        list: (query = {}, options?: CalendarReadOptions) => this.read(request, 'resources', () => calendarPageQuery(query, this.config), options),
        create: createResource,
        setGrants: (id: string, userId: string, grants: readonly string[], options: CalendarControlOptions) =>
          this.write(request, 'resource.grant', { userId, grants }, options, id),
      }),
      availability: Object.freeze({
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
        get: (id, options) => this.read(request, 'appointment', () => ({ id: calendarKey(id) }), options),
        create: createAppointment,
        reschedule: (id, input, options) => this.write(request, 'appointment.reschedule', input, options, id),
        cancel: (id, options) => this.write(request, 'appointment.cancel', {}, options, id),
        watch: (query, listener, options: CalendarWatchOptions = {}) => {
          const detached = calendarRange(query, this.config);
          this.ready();
          return watchCalendarPage({ request, broker: this.broker, config: this.config, closing: this.signal,
            query: detached, listener, options, track: task => this.track(task) });
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
      const result = await this.broker.read<T>(authority.scope, 'calendar.' + name, { ...body, actor: authority.actor }, authority.guard, authority.signal);
      await authority.confirm(); authority.guard(); return result;
    })());
  }

  private write(request: CalendarAuthority, operation: string, input: unknown, options: CalendarRequestOptions, target?: string): Promise<CalendarCommandReceipt> {
    return this.track((async () => {
      this.ready();
      const fields = operation === 'resource.create' ? ['label', 'kind', 'ownerId', 'timeZone']
        : operation === 'resource.grant' ? ['userId', 'grants']
        : operation === 'resource.availability' ? ['mode', 'windows']
        : operation === 'block.cancel' || operation === 'appointment.cancel' || operation === 'hold.release' ? []
        : operation === 'hold.confirm' ? ['title']
        : operation === 'hold.acquire' ? ['resourceIds', 'startAt', 'endAt', 'timeZone', 'bufferBeforeMinutes', 'bufferAfterMinutes', 'ttlSeconds']
        : operation === 'block.reschedule' ? ['startAt', 'endAt', 'timeZone']
        : operation === 'block.create' ? ['resourceIds', 'title', 'startAt', 'endAt', 'timeZone']
        : operation === 'appointment.reschedule' ? ['startAt', 'endAt', 'timeZone', 'bufferBeforeMinutes', 'bufferAfterMinutes']
        : ['resourceIds', 'title', 'startAt', 'endAt', 'timeZone', 'bufferBeforeMinutes', 'bufferAfterMinutes'];
      // Detach before the first await; authored mutation cannot alter an admitted command.
      const body = calendarValue(calendarRecord(input, fields)) as Record<string, unknown>;
      const opts = calendarRecord(options, target === undefined ? ['idempotencyKey', 'signal'] : ['idempotencyKey', 'signal', 'expectedRevision']);
      const key = calendarKey(opts.idempotencyKey), id = target === undefined ? null : calendarKey(target);
      const expectedRevision = id === null ? undefined : calendarInteger(opts.expectedRevision, 1);
      if ((operation === 'appointment.create' || operation === 'block.create' || operation === 'hold.acquire')
        && (!Array.isArray(body.resourceIds) || body.resourceIds.length > this.config.maxResources)) throw new CalendarError('CALENDAR_INPUT_INVALID');
      if (operation === 'hold.acquire' && body.ttlSeconds !== undefined) calendarInteger(body.ttlSeconds, 1, 900);
      const authority = await admitCalendarRequest(request, this.config, this.signal, opts.signal as AbortSignal | undefined);
      authority.guard();
      const resolvedId = id ?? calendarHash([authority.actor.scopeId, authority.actor.principal, key]);
      // A hold is not an appointment identity. Only admitted server authority can
      // derive the appointment created by confirmation; authored IDs are rejected.
      const appointmentId = operation === 'hold.confirm'
        ? calendarHash(['appointment-from-hold', authority.actor.scopeId, authority.actor.principal, key]) : undefined;
      if (operation === 'resource.create' && body.ownerId === undefined) body.ownerId = body.kind === 'person' ? authority.actor.userId : null;
      const result = await this.broker.write<CalendarCommandReceipt>(authority.scope, 'calendar.' + operation,
        { ...body, actor: authority.actor, requestId: key, id: resolvedId,
          ...(expectedRevision === undefined ? {} : { expectedRevision }),
          ...(appointmentId === undefined ? {} : { appointmentId }),
          ...(operation === 'appointment.cancel' || operation === 'block.cancel' || operation === 'hold.release' ? { confirmed: true } : {}) }, key, authority.guard, authority.signal);
      try { await authority.confirm(); authority.guard(); return calendarReceipt(result, key, operation, appointmentId ?? resolvedId); }
      catch { throw new CalendarError('CALENDAR_OUTCOME_UNKNOWN'); }
    })());
  }
}
