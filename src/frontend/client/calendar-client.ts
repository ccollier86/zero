/** Browser-safe scoped calendar commands. The SDK retires this entire transport on every authority replacement. */
import type { CalendarAppointmentCreateInput, CalendarAppointmentIntervalInput, CalendarAllDayAppointmentInterval, CalendarDateRangeQuery, CalendarAppointmentUpdateInput, CalendarAppointmentPage, CalendarAppointmentView, CalendarBusyPage, CalendarCommandReceipt, CalendarCapabilities,
  CalendarAppointmentStatus, CalendarAppointmentLifecycle, CalendarAppointmentTransitionInput, CalendarAppointmentTransitions,
  CalendarLifecyclePolicyInput, CalendarLifecyclePolicy, CalendarCancellationOptions,
  CalendarAvailabilityInput, CalendarAvailabilityView, CalendarAvailabilityWindow, CalendarAvailabilityPolicyInput, CalendarAvailabilityPolicyView, CalendarBlockInput, CalendarBlockPage, CalendarBlockRescheduleInput, CalendarBlockView,
  CalendarHoldInput, CalendarHoldView, CalendarHoldPage, CalendarHoldConfirmationInput,
  CalendarVisitInput, CalendarVisitSnapshot, CalendarVisitLocationQuery,
  CalendarParticipantReference, CalendarParticipantView, CalendarParticipantDirectoryQuery, CalendarParticipantDirectoryPage, CalendarParticipantsView,
  CalendarAppointmentTypeInput, CalendarAppointmentTypeReplacement, CalendarAppointmentTypeReference, CalendarAppointmentTypeSnapshot,
  CalendarAppointmentTypeView, CalendarAppointmentTypePageQuery, CalendarAppointmentTypePage, CalendarResourceTypesInput, CalendarResourceTypesView,
  CalendarLocationInput, CalendarLocationReplacement, CalendarLocationView, CalendarLocationPageQuery, CalendarLocationPage, CalendarResourceLocationsView,
  CalendarResourceLocationPolicyInput, CalendarResourceLocationPolicyView,
  CalendarControlOptions, CalendarGrant, CalendarRangeQuery, CalendarReadOptions, CalendarRequestOptions, CalendarRescheduleInput, CalendarResourceInput,
  CalendarResourcePage, CalendarResourcePageQuery, CalendarResourceView, CalendarWatchOptions, CalendarWatchUpdate, ScopedCalendar } from '../../calendar/contracts';
import type { FetchInit } from './sdk';
import { calendarFailureDetails, calendarMutationFailure, CalendarReadError } from './calendar-mutation';
import { watchCalendarRange } from './calendar-client-watch';
import { calendarAvailabilityPolicyInput, calendarAvailabilityPolicyView } from './calendar-client-availability-policy';
import { calendarLocationPolicyInput, calendarLocationPolicyView } from './calendar-client-location-policy';
export interface CalendarClient extends ScopedCalendar { clear(): void }
export function createCalendarClient(fetch: <T = unknown>(path: string, init?: FetchInit) => Promise<T>,
  open?: (path: string, init: RequestInit) => Promise<Response>): CalendarClient {
  let generation = 0, boundary = new AbortController();
  async function call(path: string, method = 'GET', body?: unknown, signal?: AbortSignal, dispatched?: () => void): Promise<unknown> {
    const epoch = generation, combined = AbortSignal.any([boundary.signal, ...(signal ? [signal] : [])]); combined.throwIfAborted();
    const captured = body === undefined ? undefined : structuredClone(body); dispatched?.();
    let result: unknown;
    try { result = await fetch('/api/calendar' + path, { method, ...(captured === undefined ? {} : { body: captured }), signal: combined }); }
    catch (error) { if (epoch !== generation || combined.aborted) throw retired(); throw error; }
    if (epoch !== generation || combined.aborted) throw retired(); return result;
  }
  async function read<T>(path: string, parse: (value: unknown) => T, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
    try { return parse(await call(path, method, body, signal)); }
    catch (cause) { if (cause instanceof Error && cause.name === 'AbortError') throw cause;
      const { code, status } = calendarFailureDetails(cause); throw new CalendarReadError(code, status); }
  }
  async function mutation(path: string, body: unknown, supplied: CalendarRequestOptions,
    operation: CalendarCommandReceipt['operation'], id?: string, forbiddenId?: string, method = 'POST', expectedRevision?: number): Promise<CalendarCommandReceipt> {
    const key = requestKey(supplied.idempotencyKey); let dispatched = false;
    try { const receipt = calendarReceipt(await call(path, method, body, supplied.signal, () => { dispatched = true; }));
      if (receipt.requestId !== key || receipt.operation !== operation || id !== undefined && receipt.id !== id
        || forbiddenId !== undefined && receipt.id === forbiddenId
        || expectedRevision !== undefined && receipt.revision !== expectedRevision + (receipt.changed ? 1 : 0)) throw invalid(); return receipt; }
    catch (error) { if (!dispatched) throw error; throw calendarMutationFailure(error, key); }
  }
  function watch<T>(path: string, parse: (value: unknown) => T, listener: (value: T, update?: CalendarWatchUpdate) => void,
    supplied: CalendarWatchOptions): () => void {
    const o = record(supplied, ['signal', 'onError']);
    if (!open || typeof listener !== 'function' || o.signal !== undefined && !(o.signal instanceof AbortSignal)
      || o.onError !== undefined && typeof o.onError !== 'function') throw invalid();
    const accepted: CalendarWatchOptions = { ...(o.signal === undefined ? {} : { signal: o.signal as AbortSignal }),
      ...(o.onError === undefined ? {} : { onError: o.onError as (error: unknown) => void }) };
    return watchCalendarRange(open, '/api/calendar' + path, boundary.signal, listener, parse, accepted);
  }
  function watchRange<T>(kind: 'appointments' | 'blocks' | 'holds', query: CalendarRangeQuery, parse: (value: unknown) => T,
    listener: (value: T, update?: CalendarWatchUpdate) => void, supplied: CalendarWatchOptions): () => void {
    const r = range(query), params = new URLSearchParams({ resourceIds: (r.resourceIds as string[]).join(','), startAt: String(r.startAt), endAt: String(r.endAt) });
    if (r.limit !== undefined) params.set('limit', String(r.limit));
    return watch('/' + kind + '/live?' + params, parse, listener, supplied);
  }
  return Object.freeze({
    capabilities: Object.freeze({
      get(supplied?: CalendarReadOptions) { return read('/capabilities', capabilityView, 'GET', undefined, readSignal(supplied)); },
      watch(listener: (value: CalendarCapabilities, update?: CalendarWatchUpdate) => void, supplied: CalendarWatchOptions = {}) {
        return watch('/capabilities/live', capabilityView, listener, supplied);
      },
    }),
    participants: Object.freeze({
      directory(query: CalendarParticipantDirectoryQuery = {}, supplied?: CalendarReadOptions) {
        const page = participantRequest(query);
        return read('/participants' + page.search, value => participantDirectory(value, page.query), 'GET', undefined, readSignal(supplied));
      },
      forAppointment(id: string, supplied?: CalendarReadOptions) {
        const target = requestKey(id);
        return read('/appointments/' + encodeURIComponent(target) + '/participants', value => participantBindings(value, target), 'GET', undefined, readSignal(supplied));
      },
      forHold(id: string, supplied?: CalendarReadOptions) {
        const target = requestKey(id);
        return read('/holds/' + encodeURIComponent(target) + '/participants', value => participantBindings(value, target), 'GET', undefined, readSignal(supplied));
      },
      replace(id: string, references: readonly CalendarParticipantReference[], supplied: CalendarControlOptions) {
        const target = requestKey(id), control = options(supplied, true);
        return mutation('/appointments/' + encodeURIComponent(target) + '/participants', { references: participantReferences(references), options: control },
          supplied, 'appointment.participants-changed', target, undefined, 'PUT', control.expectedRevision as number);
      },
      watchDirectory(query: CalendarParticipantDirectoryQuery, listener: (page: CalendarParticipantDirectoryPage, update?: CalendarWatchUpdate) => void, supplied: CalendarWatchOptions = {}) {
        const page = participantRequest(query);
        return watch('/participants/live' + page.search, value => participantDirectory(value, page.query), listener, supplied);
      },
      watchForAppointment(id: string, listener: (page: CalendarParticipantsView, update?: CalendarWatchUpdate) => void, supplied: CalendarWatchOptions = {}) {
        const target = requestKey(id);
        return watch('/appointments/' + encodeURIComponent(target) + '/participants/live', value => participantBindings(value, target), listener, supplied);
      },
      watchForHold(id: string, listener: (page: CalendarParticipantsView, update?: CalendarWatchUpdate) => void, supplied: CalendarWatchOptions = {}) {
        const target = requestKey(id);
        return watch('/holds/' + encodeURIComponent(target) + '/participants/live', value => participantBindings(value, target), listener, supplied);
      },
    }),
    lifecycle: Object.freeze({
      get(readOptions?: CalendarReadOptions) { return read('/lifecycle', lifecyclePolicy, 'GET', undefined, readSignal(readOptions)); },
      replace(input: CalendarLifecyclePolicyInput, supplied: CalendarControlOptions) {
        const policy = lifecyclePolicyInput(input), control = options(supplied, true);
        return mutation('/lifecycle', { policy, options: control }, supplied, 'lifecycle.policy-changed', 'policy', undefined, 'PUT', control.expectedRevision as number);
      },
      watch(listener: (policy: CalendarLifecyclePolicy, update?: CalendarWatchUpdate) => void, supplied: CalendarWatchOptions = {}) {
        return watch('/lifecycle/live', lifecyclePolicy, listener, supplied);
      },
    }),
    types: Object.freeze({
      list(supplied?: CalendarAppointmentTypePageQuery, readOptions?: CalendarReadOptions) {
        const page = typePageRequest(supplied);
        return read('/types' + page.search, value => typePage(value, page.query), 'GET', undefined, readSignal(readOptions));
      },
      get(id: string, readOptions?: CalendarReadOptions) {
        const targetId = requestKey(id);
        return read('/types/' + encodeURIComponent(targetId), value => {
          const accepted = typeView(value); if (accepted.id !== targetId) throw invalid(); return accepted;
        }, 'GET', undefined, readSignal(readOptions));
      },
      create(input: CalendarAppointmentTypeInput, supplied: CalendarRequestOptions) {
        return mutation('/types', { type: typeInput(input), options: options(supplied) }, supplied, 'type.created');
      },
      replace(id: string, input: CalendarAppointmentTypeReplacement, supplied: CalendarControlOptions) {
        return mutation('/types/' + encodeURIComponent(requestKey(id)),
          { type: typeInput(input, true), options: options(supplied, true) }, supplied, 'type.updated', id, undefined, 'PUT');
      },
      forResource(id: string, readOptions?: CalendarReadOptions) {
        const resourceId = requestKey(id);
        return read('/resources/' + encodeURIComponent(resourceId) + '/types', value => {
          const accepted = resourceTypesView(value); if (accepted.resourceId !== resourceId) throw invalid(); return accepted;
        }, 'GET', undefined, readSignal(readOptions));
      },
      watch(query: CalendarAppointmentTypePageQuery, listener: (page: CalendarAppointmentTypePage, update?: CalendarWatchUpdate) => void, supplied: CalendarWatchOptions = {}) {
        const page = typePageRequest(query);
        return watch('/types/live' + page.search, value => typePage(value, page.query), listener, supplied);
      },
      watchType(id: string, listener: (type: CalendarAppointmentTypeView, update?: CalendarWatchUpdate) => void, supplied: CalendarWatchOptions = {}) {
        const targetId = requestKey(id);
        return watch('/types/' + encodeURIComponent(targetId) + '/live', value => {
          const accepted = typeView(value); if (accepted.id !== targetId) throw invalid(); return accepted;
        }, listener, supplied);
      },
      watchForResource(id: string, listener: (types: CalendarResourceTypesView, update?: CalendarWatchUpdate) => void, supplied: CalendarWatchOptions = {}) {
        const resourceId = requestKey(id);
        return watch('/resources/' + encodeURIComponent(resourceId) + '/types/live', value => {
          const accepted = resourceTypesView(value); if (accepted.resourceId !== resourceId) throw invalid(); return accepted;
        }, listener, supplied);
      },
    }),
    locations: Object.freeze({
      policy: Object.freeze({
        get(id: string, supplied?: CalendarReadOptions) {
          const target = requestKey(id);
          return read('/resources/' + encodeURIComponent(target) + '/location-policy', value => calendarLocationPolicyView(value, target), 'GET', undefined, readSignal(supplied));
        },
        replace(id: string, input: CalendarResourceLocationPolicyInput, supplied: CalendarControlOptions) {
          const target = requestKey(id), policy = calendarLocationPolicyInput(input), control = options(supplied, true);
          return mutation('/resources/' + encodeURIComponent(target) + '/location-policy', { policy, options: control }, supplied,
            'resource.location-policy-changed', target, undefined, 'PUT', control.expectedRevision as number);
        },
        watch(id: string, listener: (policy: CalendarResourceLocationPolicyView, update?: CalendarWatchUpdate) => void, supplied: CalendarWatchOptions = {}) {
          const target = requestKey(id);
          return watch('/resources/' + encodeURIComponent(target) + '/location-policy/live', value => calendarLocationPolicyView(value, target), listener, supplied);
        },
      }),
      forVisit(supplied: CalendarVisitLocationQuery, readOptions?: CalendarReadOptions) {
        const page = visitPageRequest(supplied);
        return read('/visit-locations' + page.search, value => visitLocationPage(value, page.query), 'GET', undefined, readSignal(readOptions));
      },
      watchForVisit(query: CalendarVisitLocationQuery, listener: (page: CalendarLocationPage, update?: CalendarWatchUpdate) => void, supplied: CalendarWatchOptions = {}) {
        const page = visitPageRequest(query);
        return watch('/visit-locations/live' + page.search, value => visitLocationPage(value, page.query), listener, supplied);
      },
      list(supplied?: CalendarLocationPageQuery, readOptions?: CalendarReadOptions) {
        const page = pageRequest(supplied);
        return read('/locations' + page.search, value => locationPage(value, page.query), 'GET', undefined, readSignal(readOptions));
      },
      get(id: string, readOptions?: CalendarReadOptions) {
        const targetId = requestKey(id);
        return read('/locations/' + encodeURIComponent(targetId), value => {
          const accepted = locationView(value); if (accepted.id !== targetId) throw invalid(); return accepted;
        }, 'GET', undefined, readSignal(readOptions));
      },
      create(input: CalendarLocationInput, supplied: CalendarRequestOptions) {
        return mutation('/locations', { location: locationInput(input), options: options(supplied) }, supplied, 'location.created');
      },
      replace(id: string, input: CalendarLocationReplacement, supplied: CalendarControlOptions) {
        return mutation('/locations/' + encodeURIComponent(requestKey(id)),
          { location: locationInput(input, true), options: options(supplied, true) }, supplied, 'location.updated', id, undefined, 'PUT');
      },
      forResource(id: string, readOptions?: CalendarReadOptions) {
        const resourceId = requestKey(id);
        return read('/resources/' + encodeURIComponent(resourceId) + '/locations', value => {
          const accepted = resourceLocationsView(value); if (accepted.resourceId !== resourceId) throw invalid(); return accepted;
        }, 'GET', undefined, readSignal(readOptions));
      },
      watch(query: CalendarLocationPageQuery, listener: (page: CalendarLocationPage, update?: CalendarWatchUpdate) => void, supplied: CalendarWatchOptions = {}) {
        const page = pageRequest(query);
        return watch('/locations/live' + page.search, value => locationPage(value, page.query), listener, supplied);
      },
      watchLocation(id: string, listener: (location: CalendarLocationView, update?: CalendarWatchUpdate) => void, supplied: CalendarWatchOptions = {}) {
        const targetId = requestKey(id);
        return watch('/locations/' + encodeURIComponent(targetId) + '/live', value => {
          const accepted = locationView(value); if (accepted.id !== targetId) throw invalid(); return accepted;
        }, listener, supplied);
      },
      watchForResource(id: string, listener: (locations: CalendarResourceLocationsView, update?: CalendarWatchUpdate) => void, supplied: CalendarWatchOptions = {}) {
        const resourceId = requestKey(id);
        return watch('/resources/' + encodeURIComponent(resourceId) + '/locations/live', value => {
          const accepted = resourceLocationsView(value); if (accepted.resourceId !== resourceId) throw invalid(); return accepted;
        }, listener, supplied);
      },
    }),
    resources: Object.freeze({
      list(supplied?: CalendarResourcePageQuery, readOptions?: CalendarReadOptions) {
        const page = pageRequest(supplied, true);
        return read('/resources' + page.search, value => resourcePage(value, page.query), 'GET', undefined, readSignal(readOptions));
      },
      create(input: CalendarResourceInput, supplied: CalendarRequestOptions) {
        const r = record(input, ['label', 'kind', 'ownerId', 'timeZone']);
        identifier(r.label, 256); zone(r.timeZone); if (r.kind !== 'person' && r.kind !== 'room' && r.kind !== 'equipment') throw invalid();
        if (r.ownerId !== undefined && r.ownerId !== null) requestKey(r.ownerId);
        return mutation('/resources', { resource: r, options: options(supplied) }, supplied, 'resource.created');
      },
      setGrants(id: string, userId: string, grants: readonly CalendarGrant[], supplied: CalendarControlOptions) {
        requestKey(id); requestKey(userId);
        const accepted = values(grants, 4);
        if (accepted.some(grant => grant !== 'busy' && grant !== 'details' && grant !== 'book' && grant !== 'manage')) throw invalid();
        unique(accepted);
        return mutation('/resources/' + encodeURIComponent(id) + '/grants', { userId, grants: accepted, options: options(supplied, true) }, supplied, 'resource.grant-changed', id);
      },
      setLocations(id: string, locationIds: readonly string[], supplied: CalendarControlOptions) {
        return mutation('/resources/' + encodeURIComponent(requestKey(id)) + '/locations',
          { locationIds: ids(locationIds, true).sort(), options: options(supplied, true) }, supplied, 'resource.locations-changed', id, undefined, 'PUT');
      },
      setAppointmentTypes(id: string, input: CalendarResourceTypesInput, supplied: CalendarControlOptions) {
        return mutation('/resources/' + encodeURIComponent(requestKey(id)) + '/types',
          { ...resourceTypesInput(input), options: options(supplied, true) }, supplied, 'resource.types-changed', id, undefined, 'PUT');
      },
      watch(query: CalendarResourcePageQuery, listener: (page: CalendarResourcePage, update?: CalendarWatchUpdate) => void, supplied: CalendarWatchOptions = {}) {
        const page = pageRequest(query, true);
        return watch('/resources/live' + page.search, value => resourcePage(value, page.query), listener, supplied);
      },
    }),
    availability: Object.freeze({
      policy: Object.freeze({
        get(id: string, supplied?: CalendarReadOptions) {
          const resourceId = requestKey(id);
          return read('/availability/' + encodeURIComponent(resourceId) + '/policy', value => {
            const accepted = calendarAvailabilityPolicyView(value); if (accepted.resourceId !== resourceId) throw invalid(); return accepted;
          }, 'GET', undefined, readSignal(supplied));
        },
        replace(id: string, input: CalendarAvailabilityPolicyInput, supplied: CalendarControlOptions) {
          const resourceId = requestKey(id), control = options(supplied, true);
          return mutation('/availability/' + encodeURIComponent(resourceId) + '/policy',
            { policy: calendarAvailabilityPolicyInput(input), options: control }, supplied, 'resource.availability-policy-changed', resourceId,
            undefined, 'PUT', Number(control.expectedRevision));
        },
        watch(id: string, listener: (policy: CalendarAvailabilityPolicyView, update?: CalendarWatchUpdate) => void, supplied: CalendarWatchOptions = {}) {
          const resourceId = requestKey(id);
          return watch('/availability/' + encodeURIComponent(resourceId) + '/policy/live', value => {
            const accepted = calendarAvailabilityPolicyView(value); if (accepted.resourceId !== resourceId) throw invalid(); return accepted;
          }, listener, supplied);
        },
      }),
      get(id: string, readOptions?: CalendarReadOptions) {
        const resourceId = requestKey(id);
        return read('/availability/' + encodeURIComponent(resourceId), value => {
          const accepted = availabilityView(value); if (accepted.resourceId !== resourceId) throw invalid(); return accepted;
        }, 'GET', undefined, readSignal(readOptions));
      },
      replace(id: string, input: CalendarAvailabilityInput, supplied: CalendarControlOptions) {
        return mutation('/availability/' + encodeURIComponent(requestKey(id)),
          { availability: availabilityInput(input), options: options(supplied, true) }, supplied, 'resource.availability-changed', id);
      },
      watch(id: string, listener: (availability: CalendarAvailabilityView, update?: CalendarWatchUpdate) => void, supplied: CalendarWatchOptions = {}) {
        const resourceId = requestKey(id);
        return watch('/availability/' + encodeURIComponent(resourceId) + '/live', value => {
          const accepted = availabilityView(value); if (accepted.resourceId !== resourceId) throw invalid(); return accepted;
        }, listener, supplied);
      },
    }),
    blocks: Object.freeze({
      query(supplied: CalendarRangeQuery, readOptions?: CalendarReadOptions) { return read('/blocks/query', blockPage, 'POST', { query: range(supplied) }, readSignal(readOptions)); },
      get(id: string, readOptions?: CalendarReadOptions) {
        const targetId = requestKey(id);
        return read('/blocks/' + encodeURIComponent(targetId), value => {
          const accepted = blockView(value); if (accepted.id !== targetId) throw invalid(); return accepted;
        }, 'GET', undefined, readSignal(readOptions));
      },
      create(input: CalendarBlockInput, supplied: CalendarRequestOptions) {
        return mutation('/blocks', { block: blockInput(input, true), options: options(supplied) }, supplied, 'block.created');
      },
      reschedule(id: string, input: CalendarBlockRescheduleInput, supplied: CalendarControlOptions) {
        return mutation('/blocks/' + encodeURIComponent(requestKey(id)) + '/reschedule',
          { block: blockInput(input, false), options: options(supplied, true) }, supplied, 'block.rescheduled', id);
      },
      cancel(id: string, supplied: CalendarControlOptions) {
        return mutation('/blocks/' + encodeURIComponent(requestKey(id)) + '/cancel', { options: options(supplied, true) }, supplied, 'block.cancelled', id);
      },
      watch(query: CalendarRangeQuery, listener: (page: CalendarBlockPage, update?: CalendarWatchUpdate) => void, supplied: CalendarWatchOptions = {}) {
        return watchRange('blocks', query, blockPage, listener, supplied);
      },
    }),
    holds: Object.freeze({
      query(supplied: CalendarRangeQuery, readOptions?: CalendarReadOptions) { return read('/holds/query', holdPage, 'POST', { query: range(supplied) }, readSignal(readOptions)); },
      get(id: string, readOptions?: CalendarReadOptions) {
        const targetId = requestKey(id);
        return read('/holds/' + encodeURIComponent(targetId), value => {
          const accepted = holdView(value); if (accepted.id !== targetId) throw invalid(); return accepted;
        }, 'GET', undefined, readSignal(readOptions));
      },
      acquire(input: CalendarHoldInput, supplied: CalendarRequestOptions) {
        return mutation('/holds', { hold: holdInput(input), options: options(supplied) }, supplied, 'hold.acquired');
      },
      release(id: string, supplied: CalendarControlOptions) {
        return mutation('/holds/' + encodeURIComponent(requestKey(id)) + '/release',
          { options: options(supplied, true) }, supplied, 'hold.released', id);
      },
      confirm(id: string, input: CalendarHoldConfirmationInput, supplied: CalendarControlOptions) {
        const appointment = record(input, ['title']); identifier(appointment.title, 512);
        // The server creates a new appointment identity; the hold ID must never
        // be used as the expected appointment receipt identity.
        return mutation('/holds/' + encodeURIComponent(requestKey(id)) + '/confirm',
          { appointment, options: options(supplied, true) }, supplied, 'appointment.created', undefined, id);
      },
      watch(query: CalendarRangeQuery, listener: (page: CalendarHoldPage, update?: CalendarWatchUpdate) => void, supplied: CalendarWatchOptions = {}) {
        return watchRange('holds', query, holdPage, listener, supplied);
      },
    }),
    appointments: Object.freeze({
      query(supplied: CalendarRangeQuery, readOptions?: CalendarReadOptions) { return read('/appointments/query', appointmentPage, 'POST', { query: range(supplied) }, readSignal(readOptions)); },
      queryDates(supplied: CalendarDateRangeQuery, readOptions?: CalendarReadOptions) {
        const query = dateRange(supplied);
        return read('/appointments/query-dates', value => appointmentDatePage(value, query), 'POST', { query }, readSignal(readOptions));
      },
      get(id: string, readOptions?: CalendarReadOptions) {
        const targetId = requestKey(id);
        return read('/appointments/' + encodeURIComponent(targetId), value => {
          const accepted = appointmentView(value); if (accepted.id !== targetId) throw invalid(); return accepted;
        }, 'GET', undefined, readSignal(readOptions));
      },
      create(input: CalendarAppointmentCreateInput, supplied: CalendarRequestOptions) {
        const r = appointmentInput(input, true); return mutation('/appointments', { appointment: r, options: options(supplied) }, supplied, 'appointment.created');
      },
      update(id: string, input: CalendarAppointmentUpdateInput, supplied: CalendarControlOptions) {
        const target = requestKey(id), appointment = appointmentUpdateInput(input), control = options(supplied, true);
        return mutation('/appointments/' + encodeURIComponent(target), { appointment, options: control }, supplied,
          'appointment.updated', target, undefined, 'PUT', control.expectedRevision as number);
      },
      reschedule(id: string, input: CalendarRescheduleInput, supplied: CalendarControlOptions) {
        return mutation('/appointments/' + encodeURIComponent(requestKey(id)) + '/reschedule',
          { appointment: appointmentInput(input, false), options: options(supplied, true) }, supplied, 'appointment.rescheduled', id);
      },
      cancel(id: string, supplied: CalendarCancellationOptions) {
        const captured = record(supplied, ['idempotencyKey', 'expectedRevision', 'signal', 'reason']);
        const { reason: _reason, ...control } = captured;
        return mutation('/appointments/' + encodeURIComponent(requestKey(id)) + '/cancel',
          { options: options(control, true), ...(Object.hasOwn(captured, 'reason') ? { reason: lifecycleReason(captured.reason) } : {}) }, supplied, 'appointment.cancelled', id);
      },
      transitions(id: string, readOptions?: CalendarReadOptions) {
        const targetId = requestKey(id);
        return read('/appointments/' + encodeURIComponent(targetId) + '/transitions', value => appointmentTransitions(value, targetId), 'GET', undefined, readSignal(readOptions));
      },
      transition(id: string, input: CalendarAppointmentTransitionInput, supplied: CalendarControlOptions) {
        const targetId = requestKey(id), transition = appointmentTransitionInput(input), control = options(supplied, true);
        return mutation('/appointments/' + encodeURIComponent(targetId) + '/transition', { transition, options: control }, supplied,
          'appointment.transitioned', targetId, undefined, 'POST', control.expectedRevision as number);
      },
      watchTransitions(id: string, listener: (transitions: CalendarAppointmentTransitions, update?: CalendarWatchUpdate) => void, supplied: CalendarWatchOptions = {}) {
        const targetId = requestKey(id);
        return watch('/appointments/' + encodeURIComponent(targetId) + '/transitions/live', value => appointmentTransitions(value, targetId), listener, supplied);
      },
      watch(query: CalendarRangeQuery, listener: (page: CalendarAppointmentPage, update?: CalendarWatchUpdate) => void, supplied: CalendarWatchOptions = {}) {
        return watchRange('appointments', query, appointmentPage, listener, supplied);
      },
      watchDates(suppliedQuery: CalendarDateRangeQuery, listener: (page: CalendarAppointmentPage, update?: CalendarWatchUpdate) => void, supplied: CalendarWatchOptions = {}) {
        const query = dateRange(suppliedQuery), params = new URLSearchParams({ resourceIds: query.resourceIds.join(','), startDate: query.startDate, endDate: query.endDate });
        if (query.limit !== undefined) params.set('limit', String(query.limit));
        return watch('/appointments/dates/live?' + params, value => appointmentDatePage(value, query), listener, supplied);
      },
    }),
    busy: Object.freeze({ query(query: CalendarRangeQuery, readOptions?: CalendarReadOptions) { return read('/busy/query', busyPage, 'POST', { query: range(query) }, readSignal(readOptions)); } }),
    receipts: Object.freeze({ get(key: string, readOptions?: CalendarReadOptions) {
      const requestId = requestKey(key);
      return read('/receipts/' + encodeURIComponent(requestId), value => {
        const r = record(value, ['receipt']); if (!Object.hasOwn(r, 'receipt')) throw invalid();
        if (r.receipt === null) return null;
        const accepted = calendarReceipt(r.receipt); if (accepted.requestId !== requestId) throw invalid(); return accepted;
      }, 'GET', undefined, readSignal(readOptions));
    } }),
    clear() { generation++; boundary.abort(); boundary = new AbortController(); },
  });
}
function options(value: unknown, control = false): Record<string, unknown> {
  const { signal, ...r } = record(value, ['idempotencyKey', 'signal', ...(control ? ['expectedRevision'] : [])]);
  requestKey(r.idempotencyKey); if (signal !== undefined && !(signal instanceof AbortSignal)) throw invalid();
  if (control) integer(r.expectedRevision, 1); return r;
}
function readSignal(value: unknown): AbortSignal | undefined {
  const r = record(value ?? {}, ['signal']); if (r.signal !== undefined && !(r.signal instanceof AbortSignal)) throw invalid(); return r.signal as AbortSignal | undefined;
}
function lifecyclePolicyInput(value: unknown): CalendarLifecyclePolicyInput {
  const r = record(value, ['extended', 'cancellationReason', 'noShowReason']);
  if (Object.keys(r).length !== 3 || typeof r.extended !== 'boolean' || r.cancellationReason !== 'optional' && r.cancellationReason !== 'required'
    || r.noShowReason !== 'optional' && r.noShowReason !== 'required') throw invalid();
  return Object.freeze(r) as unknown as CalendarLifecyclePolicyInput;
}
function lifecyclePolicy(value: unknown): CalendarLifecyclePolicy {
  const r = record(value, ['revision', 'extended', 'cancellationReason', 'noShowReason']);
  if (Object.keys(r).length !== 4) throw invalid();
  const revision = integer(r.revision, 1), { revision: _revision, ...input } = r;
  return Object.freeze({ revision, ...lifecyclePolicyInput(input) });
}
function lifecycleStatus(value: unknown): CalendarAppointmentStatus {
  if (!['tentative', 'confirmed', 'completed', 'no-show', 'cancelled'].includes(value as string)) throw invalid();
  return value as CalendarAppointmentStatus;
}
function lifecycleReason(value: unknown): string {
  const accepted = identifier(value, 1024).trim(); if (!accepted) throw invalid(); return accepted;
}
function appointmentTransitionInput(value: unknown): CalendarAppointmentTransitionInput {
  const r = record(value, ['status', 'policyRevision', 'reason']);
  const status = lifecycleStatus(r.status), policyRevision = integer(r.policyRevision, 1);
  if (Object.hasOwn(r, 'reason') && status !== 'cancelled' && status !== 'no-show') throw invalid();
  return Object.freeze({ status, policyRevision, ...(Object.hasOwn(r, 'reason') ? { reason: lifecycleReason(r.reason) } : {}) });
}
function appointmentLifecycle(value: unknown, appointment: Record<string, unknown>): CalendarAppointmentLifecycle {
  const r = record(value, ['status', 'revision', 'policyRevision', 'reason']);
  if (Object.keys(r).length !== 4) throw invalid();
  const status = lifecycleStatus(r.status), revision = integer(r.revision, 1, Number(appointment.revision)), policyRevision = integer(r.policyRevision, 1);
  if ((status === 'cancelled') !== (appointment.status === 'cancelled')) throw invalid();
  const reason = r.reason === null ? null : lifecycleReason(r.reason);
  if (reason !== r.reason || reason !== null && status !== 'cancelled' && status !== 'no-show') throw invalid();
  return Object.freeze({ status, revision, policyRevision, reason });
}
function appointmentTransitions(value: unknown, targetId: string): CalendarAppointmentTransitions {
  const r = record(value, ['id', 'revision', 'policyRevision', 'status', 'allowed']);
  if (Object.keys(r).length !== 5 || requestKey(r.id) !== targetId) throw invalid();
  const revision = integer(r.revision, 1), policyRevision = integer(r.policyRevision, 1), status = lifecycleStatus(r.status);
  const allowed = values(r.allowed, 5).map(value => {
    const entry = record(value, ['status', 'requiresReason']), next = lifecycleStatus(entry.status);
    if (Object.keys(entry).length !== 2 || typeof entry.requiresReason !== 'boolean' || next === status
      || entry.requiresReason && next !== 'no-show' && next !== 'cancelled') throw invalid();
    return Object.freeze({ status: next, requiresReason: entry.requiresReason });
  });
  unique(allowed.map(entry => entry.status));
  if (['completed', 'no-show', 'cancelled'].includes(status) && allowed.length !== 0) throw invalid();
  return Object.freeze({ id: targetId, revision, policyRevision, status, allowed: Object.freeze(allowed) });
}
function region(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(value)) throw invalid(); return value;
}
function pageRequest(value: unknown, resource = false): { search: string; query: CalendarLocationPageQuery } {
  const r = record(value ?? {}, ['limit', 'after', ...(resource ? ['locationIds', 'regions'] : [])]), params = new URLSearchParams();
  if (r.limit !== undefined) params.set('limit', String(integer(r.limit, 1, 100)));
  if (r.after !== undefined) params.set('after', requestKey(r.after));
  if (r.locationIds !== undefined) params.set('locationIds', ids(r.locationIds, true).sort().join(','));
  if (r.regions !== undefined) {
    const accepted = values(r.regions, 16).map(region); unique(accepted); params.set('regions', accepted.sort().join(','));
  }
  return { search: params.size ? '?' + params : '', query: Object.freeze({ ...(r.limit === undefined ? {} : { limit: r.limit as number }),
    ...(r.after === undefined ? {} : { after: r.after as string }) }) };
}
function typePageRequest(value: unknown): { search: string; query: CalendarAppointmentTypePageQuery } {
  const r = record(value ?? {}, ['limit', 'after', 'resourceIds']), params = new URLSearchParams();
  const limit = r.limit === undefined ? undefined : integer(r.limit, 1, 100);
  const after = r.after === undefined ? undefined : requestKey(r.after);
  const resourceIds = r.resourceIds === undefined ? undefined : Object.freeze(ids(r.resourceIds, true).sort());
  if (limit !== undefined) params.set('limit', String(limit));
  if (after !== undefined) params.set('after', after);
  if (resourceIds !== undefined) params.set('resourceIds', resourceIds.join(','));
  return { search: params.size ? '?' + params : '', query: Object.freeze({ ...(limit === undefined ? {} : { limit }),
    ...(after === undefined ? {} : { after }), ...(resourceIds === undefined ? {} : { resourceIds }) }) };
}
function visitPageRequest(value: unknown): { search: string; query: CalendarVisitLocationQuery } {
  // Unlike catalog discovery, omission is never a manager-wide visit selection.
  const row = record(value, ['resourceIds', 'limit', 'after', 'interval']), { interval: suppliedInterval, ...paging } = row;
  const page = typePageRequest(paging);
  if (page.query.resourceIds === undefined) throw invalid();
  if (!Object.hasOwn(row, 'interval')) return page as { search: string; query: CalendarVisitLocationQuery };
  const bounds = record(suppliedInterval, ['startAt', 'endAt']);
  if (Object.keys(bounds).length !== 2) throw invalid(); instant(bounds.startAt); instant(bounds.endAt);
  const duration = Date.parse(String(bounds.endAt)) - Date.parse(String(bounds.startAt)); if (duration <= 0 || duration > 33 * 86400_000) throw invalid();
  const params = new URLSearchParams(page.search), interval = Object.freeze({ startAt: bounds.startAt as string, endAt: bounds.endAt as string });
  params.set('startAt', interval.startAt); params.set('endAt', interval.endAt);
  return { search: '?' + params, query: Object.freeze({ ...page.query, resourceIds: page.query.resourceIds, interval }) };
}
function visitInput(value: unknown): CalendarVisitInput {
  const r = record(value, ['mode', 'location']);
  if (r.mode === 'in-person') return Object.freeze({ mode: r.mode, location: typeReference(r.location) });
  if ((r.mode !== 'video' && r.mode !== 'phone') || Object.hasOwn(r, 'location')) throw invalid();
  return Object.freeze({ mode: r.mode });
}
function visitSnapshot(value: unknown): CalendarVisitSnapshot {
  const r = record(value, ['mode', 'location']);
  if (r.mode === 'in-person') {
    const location = record(r.location, ['id', 'revision', 'label', 'region']);
    if (Object.keys(location).length !== 4 || location.region === undefined) throw invalid();
    requestKey(location.id); integer(location.revision, 1); identifier(location.label, 256);
    if (location.region !== null) region(location.region);
    return Object.freeze({ mode: r.mode, location: Object.freeze(location) }) as unknown as CalendarVisitSnapshot;
  }
  return visitInput(r) as CalendarVisitSnapshot;
}
function typeInput(value: unknown, replacement = false): Record<string, unknown> {
  const fields = ['label', 'durationMinutes', 'bufferBeforeMinutes', 'bufferAfterMinutes', 'colorKey', 'active'];
  const r = record(value, fields); identifier(r.label, 256); integer(r.durationMinutes, 1, 44_640);
  if (replacement && fields.some(field => !Object.hasOwn(r, field) || r[field] === undefined)) throw invalid();
  for (const key of ['bufferBeforeMinutes', 'bufferAfterMinutes']) if (r[key] !== undefined) integer(r[key], 0, 1440);
  if (r.colorKey !== undefined && r.colorKey !== null) region(r.colorKey);
  if (r.active !== undefined && typeof r.active !== 'boolean') throw invalid();
  return r;
}
function typeReference(value: unknown): CalendarAppointmentTypeReference {
  const r = record(value, ['id', 'revision']);
  if (Object.keys(r).length !== 2) throw invalid();
  return Object.freeze({ id: requestKey(r.id), revision: integer(r.revision, 1) });
}
function typeSnapshot(value: unknown, view = false): CalendarAppointmentTypeSnapshot {
  const r = record(value, ['id', 'revision', 'label', 'durationMinutes', 'bufferBeforeMinutes', 'bufferAfterMinutes', 'colorKey', ...(view ? ['active'] : [])]);
  if (Object.keys(r).length !== (view ? 8 : 7) || r.colorKey === undefined || view && typeof r.active !== 'boolean') throw invalid();
  requestKey(r.id); integer(r.revision, 1); identifier(r.label, 256); integer(r.durationMinutes, 1, 44_640);
  integer(r.bufferBeforeMinutes, 0, 1440); integer(r.bufferAfterMinutes, 0, 1440); if (r.colorKey !== null) region(r.colorKey);
  return Object.freeze(r) as unknown as CalendarAppointmentTypeSnapshot;
}
function typeView(value: unknown): CalendarAppointmentTypeView { return typeSnapshot(value, true) as CalendarAppointmentTypeView; }
function typePage(value: unknown, query: CalendarAppointmentTypePageQuery): CalendarAppointmentTypePage {
  const r = record(value, ['items', 'truncated', 'nextAfter']);
  if (Object.keys(r).length !== 3 || typeof r.truncated !== 'boolean') throw invalid();
  if (r.nextAfter !== null) requestKey(r.nextAfter);
  const items = values(r.items, 100).map(typeView); unique(items.map(item => item.id));
  if (query.resourceIds !== undefined) {
    if (query.resourceIds.length === 0 && (items.length !== 0 || r.truncated || r.nextAfter !== null)) throw invalid();
    if (query.resourceIds.length > 0 && items.some(item => !item.active)) throw invalid();
  }
  pageBoundary(items, r.truncated, r.nextAfter, query);
  return Object.freeze({ items: Object.freeze(items), truncated: r.truncated, nextAfter: r.nextAfter as string | null });
}
function resourceTypesInput(value: unknown): CalendarResourceTypesInput {
  const r = record(value, ['mode', 'typeIds']);
  if (Object.keys(r).length !== 2 || r.mode !== 'unrestricted' && r.mode !== 'optional' && r.mode !== 'required') throw invalid();
  const typeIds = ids(r.typeIds, true).sort();
  if (r.mode === 'unrestricted' && typeIds.length !== 0) throw invalid();
  return Object.freeze({ mode: r.mode, typeIds: Object.freeze(typeIds) });
}
function resourceTypesView(value: unknown): CalendarResourceTypesView {
  const r = record(value, ['resourceId', 'resourceRevision', 'mode', 'typeIds']);
  if (Object.keys(r).length !== 4) throw invalid();
  const resourceId = requestKey(r.resourceId), resourceRevision = integer(r.resourceRevision, 1);
  const policy = resourceTypesInput({ mode: r.mode, typeIds: r.typeIds });
  const original = values(r.typeIds, 16);
  if (original.some((id, index) => id !== policy.typeIds[index])) throw invalid();
  return Object.freeze({ resourceId, resourceRevision, ...policy });
}
function locationInput(value: unknown, replacement = false): Record<string, unknown> {
  const r = record(value, ['label', 'region', 'active']); identifier(r.label, 256);
  if (replacement && (Object.keys(r).length !== 3 || r.region === undefined || typeof r.active !== 'boolean')) throw invalid();
  if (r.region !== undefined && r.region !== null) region(r.region);
  if (r.active !== undefined && typeof r.active !== 'boolean') throw invalid(); return r;
}
function locationView(value: unknown): CalendarLocationView {
  const r = record(value, ['id', 'label', 'region', 'active', 'revision']);
  if (Object.keys(r).length !== 5 || r.region === undefined || typeof r.active !== 'boolean') throw invalid();
  requestKey(r.id); identifier(r.label, 256); if (r.region !== null) region(r.region); integer(r.revision, 1);
  return Object.freeze(r) as unknown as CalendarLocationView;
}
function locationPage(value: unknown, query: CalendarLocationPageQuery): CalendarLocationPage {
  const r = record(value, ['items', 'truncated', 'nextAfter']);
  if (Object.keys(r).length !== 3 || typeof r.truncated !== 'boolean') throw invalid();
  if (r.nextAfter !== null) requestKey(r.nextAfter);
  const items = values(r.items, 100).map(locationView); unique(items.map(item => item.id));
  pageBoundary(items, r.truncated, r.nextAfter, query);
  return Object.freeze({ items: Object.freeze(items), truncated: r.truncated, nextAfter: r.nextAfter as string | null });
}
function visitLocationPage(value: unknown, query: CalendarVisitLocationQuery): CalendarLocationPage {
  const page = locationPage(value, query);
  if (page.items.some(location => !location.active)
    || query.resourceIds.length === 0 && (page.items.length !== 0 || page.truncated || page.nextAfter !== null)) throw invalid();
  return page;
}
function resourceLocationsView(value: unknown): CalendarResourceLocationsView {
  const r = record(value, ['resourceId', 'resourceRevision', 'locationIds']);
  if (Object.keys(r).length !== 3) throw invalid(); requestKey(r.resourceId); integer(r.resourceRevision, 1);
  const locationIds = ids(r.locationIds, true);
  if (locationIds.some((id, index) => index > 0 && locationIds[index - 1]! >= id)) throw invalid();
  return Object.freeze({ resourceId: r.resourceId as string, resourceRevision: r.resourceRevision as number, locationIds: Object.freeze(locationIds) });
}
function capabilityView(value: unknown): CalendarCapabilities {
  const r = record(value, ['timeZone', 'createOwn', 'manage', 'participants', 'limits', 'allDayAppointments', 'locationPolicies']), limits = record(r.limits, ['maxRangeDays', 'maxPageSize', 'maxResources', 'maxParticipants']);
  if (Object.keys(r).length !== 5 + (Object.hasOwn(r, 'allDayAppointments') ? 1 : 0) + (Object.hasOwn(r, 'locationPolicies') ? 1 : 0) || Object.keys(limits).length !== 4 || typeof r.createOwn !== 'boolean'
    || Object.hasOwn(r, 'allDayAppointments') && typeof r.allDayAppointments !== 'boolean'
    || Object.hasOwn(r, 'locationPolicies') && typeof r.locationPolicies !== 'boolean'
    || typeof r.manage !== 'boolean' || typeof r.participants !== 'boolean' || r.participants && !r.manage) throw invalid();
  zone(r.timeZone);
  return Object.freeze({ timeZone: r.timeZone as string, createOwn: r.createOwn, manage: r.manage, participants: r.participants,
    ...(Object.hasOwn(r, 'allDayAppointments') ? { allDayAppointments: r.allDayAppointments as boolean } : {}),
    ...(Object.hasOwn(r, 'locationPolicies') ? { locationPolicies: r.locationPolicies as boolean } : {}),
    limits: Object.freeze({ maxRangeDays: integer(limits.maxRangeDays, 1, 31), maxPageSize: integer(limits.maxPageSize, 1, 100),
      maxResources: integer(limits.maxResources, 1, 16), maxParticipants: integer(limits.maxParticipants, 1, 100) }) });
}
function participantReferences(value: unknown): readonly CalendarParticipantReference[] {
  const refs = values(value, 100).map(item => {
    const r = record(item, ['kind', 'userId']);
    if (Object.keys(r).length !== 2 || r.kind !== 'guardian-user') throw invalid();
    return Object.freeze({ kind: 'guardian-user' as const, userId: requestKey(r.userId) });
  });
  unique(refs.map(ref => ref.userId));
  return Object.freeze(refs.sort((a, b) => a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
}
function participantView(value: unknown): CalendarParticipantView {
  const r = record(value, ['ref', 'availability', 'name']), ref = participantReferences([r.ref])[0]!;
  if (r.availability === 'unavailable' && Object.keys(r).length === 2) return Object.freeze({ ref, availability: 'unavailable' });
  if (r.availability !== 'available' || Object.keys(r).length !== 3) throw invalid();
  return Object.freeze({ ref, availability: 'available', name: identifier(r.name, 241) });
}
function participantRequest(value: unknown): { search: string; query: CalendarParticipantDirectoryQuery } {
  const r = record(value, ['search', 'limit', 'after']), params = new URLSearchParams();
  const search = r.search === undefined ? undefined : typeof r.search === 'string' && r.search.length <= 100 && !/[\u0000-\u001f\u007f]/.test(r.search) ? r.search.trim() : (() => { throw invalid(); })();
  const limit = r.limit === undefined ? undefined : integer(r.limit, 1, 100), after = r.after === undefined ? undefined : requestKey(r.after);
  if (search !== undefined) params.set('search', search);
  if (limit !== undefined) params.set('limit', String(limit));
  if (after !== undefined) params.set('after', after);
  return { search: params.size ? '?' + params : '', query: Object.freeze({ ...(search === undefined ? {} : { search }),
    ...(limit === undefined ? {} : { limit }), ...(after === undefined ? {} : { after }) }) };
}
function participantDirectory(value: unknown, query: CalendarParticipantDirectoryQuery): CalendarParticipantDirectoryPage {
  const r = record(value, ['items', 'truncated', 'nextAfter']);
  if (Object.keys(r).length !== 3 || typeof r.truncated !== 'boolean') throw invalid();
  const items = values(r.items, query.limit ?? 100).map(participantView);
  if (items.some(item => item.availability !== 'available')) throw invalid();
  unique(items.map(item => item.ref.userId));
  for (let i = 1; i < items.length; i++) if (items[i - 1]!.ref.userId >= items[i]!.ref.userId) throw invalid();
  const nextAfter = r.nextAfter === null ? null : requestKey(r.nextAfter);
  if (r.truncated !== (nextAfter !== null) || nextAfter !== null && nextAfter === query.after) throw invalid();
  return Object.freeze({ items: Object.freeze(items), truncated: r.truncated, nextAfter });
}
function participantBindings(value: unknown, id: string): CalendarParticipantsView {
  const r = record(value, ['id', 'revision', 'participants']);
  if (Object.keys(r).length !== 3 || requestKey(r.id) !== id) throw invalid();
  const participants = values(r.participants, 100).map(participantView);
  unique(participants.map(item => item.ref.userId));
  for (let i = 1; i < participants.length; i++) if (participants[i - 1]!.ref.userId >= participants[i]!.ref.userId) throw invalid();
  return Object.freeze({ id, revision: integer(r.revision, 1), participants: Object.freeze(participants) });
}
function appointmentInput(value: unknown, create: boolean): Record<string, unknown> {
  const r = record(value, ['startAt', 'endAt', 'timeZone', 'bufferBeforeMinutes', 'bufferAfterMinutes', 'appointmentType', 'visit', ...(create ? ['resourceIds', 'title', 'participants', 'interval'] : [])]);
  const participants = Object.hasOwn(r, 'participants') ? participantReferences(r.participants) : undefined;
  const resourceIds = create ? ids(r.resourceIds) : undefined;
  if (create) identifier(r.title, 512);
  let explicit: CalendarAppointmentIntervalInput | undefined;
  if (Object.hasOwn(r, 'interval')) {
    if (['startAt', 'endAt', 'timeZone', 'bufferBeforeMinutes', 'bufferAfterMinutes'].some(key => Object.hasOwn(r, key))) throw invalid();
    explicit = appointmentIntervalIntent(r.interval);
  } else {
    instant(r.startAt); instant(r.endAt);
    const duration = Date.parse(String(r.endAt)) - Date.parse(String(r.startAt));
    if (duration <= 0 || duration > 31 * 86400_000) throw invalid(); zone(r.timeZone);
    for (const key of ['bufferBeforeMinutes', 'bufferAfterMinutes']) if (!create || r[key] !== undefined) integer(r[key], 0, 1440);
  }
  const appointmentType = Object.hasOwn(r, 'appointmentType') ? r.appointmentType === null && !create ? null : typeReference(r.appointmentType) : undefined;
  const visit = Object.hasOwn(r, 'visit') ? r.visit === null && !create ? null : visitInput(r.visit) : undefined;
  if (explicit?.kind === 'all-day-local-v1' && appointmentType) throw invalid();
  return { ...r, ...(explicit ? { interval: explicit } : {}), ...(participants === undefined ? {} : { participants }), ...(resourceIds === undefined ? {} : { resourceIds }), ...(appointmentType === undefined ? {} : { appointmentType }), ...(visit === undefined ? {} : { visit }) };
}
/** Browser-side mirror of the server's closed atomic patch, without server imports. */
function appointmentUpdateInput(value: unknown): Record<string, unknown> {
  const group = ['startAt', 'endAt', 'timeZone', 'bufferBeforeMinutes', 'bufferAfterMinutes'];
  const r = { ...record(value, ['title', 'resourceIds', ...group, 'appointmentType', 'visit', 'participants', 'interval']) };
  if (Object.keys(r).length === 0 || Object.values(r).some(field => field === undefined)) throw invalid();
  if (Object.hasOwn(r, 'title')) r.title = identifier(r.title, 512);
  if (Object.hasOwn(r, 'resourceIds')) r.resourceIds = Object.freeze(ids(r.resourceIds).sort());
  if (Object.hasOwn(r, 'interval')) {
    if (group.some(field => Object.hasOwn(r, field))) throw invalid();
    r.interval = appointmentIntervalIntent(r.interval);
  }
  if (group.some(field => Object.hasOwn(r, field))) {
    if (group.some(field => !Object.hasOwn(r, field))) throw invalid();
    interval(r.startAt, r.endAt); zone(r.timeZone);
    for (const field of ['bufferBeforeMinutes', 'bufferAfterMinutes']) integer(r[field], 0, 1440);
    // Match native overflow admission when explicit buffers reach Date limits.
    const limit = 8_640_000_000_000_000;
    const start = Date.parse(String(r.startAt)) - Number(r.bufferBeforeMinutes) * 60_000;
    const end = Date.parse(String(r.endAt)) + Number(r.bufferAfterMinutes) * 60_000;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < -limit || end > limit) throw invalid();
    r.timeZone = new Intl.DateTimeFormat('en', { timeZone: String(r.timeZone) }).resolvedOptions().timeZone;
  }
  if (Object.hasOwn(r, 'appointmentType')) r.appointmentType = r.appointmentType === null ? null : typeReference(r.appointmentType);
  if (Object.hasOwn(r, 'visit')) r.visit = r.visit === null ? null : visitInput(r.visit);
  if (Object.hasOwn(r, 'participants')) r.participants = participantReferences(r.participants);
  return Object.freeze(r);
}
function blockInput(value: unknown, create: boolean): Record<string, unknown> {
  const r = record(value, ['startAt', 'endAt', 'timeZone', ...(create ? ['resourceIds', 'title'] : [])]);
  const resourceIds = create ? ids(r.resourceIds) : undefined;
  if (create) identifier(r.title, 512);
  interval(r.startAt, r.endAt); zone(r.timeZone);
  return { ...r, ...(resourceIds === undefined ? {} : { resourceIds }) };
}
function holdInput(value: unknown): Record<string, unknown> {
  const r = record(value, ['resourceIds', 'startAt', 'endAt', 'timeZone', 'bufferBeforeMinutes', 'bufferAfterMinutes', 'ttlSeconds', 'appointmentType', 'visit', 'participants']);
  const participants = Object.hasOwn(r, 'participants') ? participantReferences(r.participants) : undefined;
  const resourceIds = ids(r.resourceIds);
  interval(r.startAt, r.endAt); zone(r.timeZone);
  for (const key of ['bufferBeforeMinutes', 'bufferAfterMinutes']) if (r[key] !== undefined) integer(r[key], 0, 1440);
  if (r.ttlSeconds !== undefined) integer(r.ttlSeconds, 1, 900);
  const appointmentType = Object.hasOwn(r, 'appointmentType') ? typeReference(r.appointmentType) : undefined;
  const visit = Object.hasOwn(r, 'visit') ? visitInput(r.visit) : undefined;
  return { ...r, resourceIds, ...(participants === undefined ? {} : { participants }), ...(appointmentType === undefined ? {} : { appointmentType }), ...(visit === undefined ? {} : { visit }) };
}
function availabilityInput(value: unknown): CalendarAvailabilityInput {
  const r = record(value, ['mode', 'windows']);
  if (Object.keys(r).length !== 2 || r.mode !== 'unrestricted' && r.mode !== 'windows') throw invalid();
  const windows = availabilityWindows(r.windows);
  if (r.mode === 'unrestricted' && windows.length !== 0) throw invalid();
  return Object.freeze({ mode: r.mode, windows });
}
function availabilityWindows(value: unknown, response = false): readonly CalendarAvailabilityWindow[] {
  const windows = values(value, 100).map(value => {
    const r = record(value, ['startAt', 'endAt']);
    if (Object.keys(r).length !== 2) throw invalid();
    instant(r.startAt); instant(r.endAt); if (Date.parse(String(r.startAt)) >= Date.parse(String(r.endAt))) throw invalid();
    return Object.freeze({ startAt: r.startAt as string, endAt: r.endAt as string });
  });
  if (response) for (let index = 1; index < windows.length; index++) {
    if (Date.parse(windows[index - 1]!.endAt) >= Date.parse(windows[index]!.startAt)) throw invalid();
  }
  return Object.freeze(windows);
}
function availabilityView(value: unknown): CalendarAvailabilityView {
  const r = record(value, ['resourceId', 'resourceRevision', 'timeZone', 'mode', 'windows']);
  if (Object.keys(r).length !== 5) throw invalid();
  requestKey(r.resourceId); integer(r.resourceRevision, 1); zone(r.timeZone);
  if (r.mode !== 'unrestricted' && r.mode !== 'windows') throw invalid();
  const windows = availabilityWindows(r.windows, true);
  if (r.mode === 'unrestricted' && windows.length) throw invalid();
  return Object.freeze({ ...r, windows }) as unknown as CalendarAvailabilityView;
}
function range(value: unknown): Record<string, unknown> {
  const r = record(value, ['resourceIds', 'startAt', 'endAt', 'limit']), resourceIds = ids(r.resourceIds, true);
  instant(r.startAt); instant(r.endAt); if (Date.parse(String(r.endAt)) <= Date.parse(String(r.startAt))) throw invalid();
  if (Date.parse(String(r.endAt)) - Date.parse(String(r.startAt)) > 31 * 86400_000) throw invalid();
  if (r.limit !== undefined) integer(r.limit, 1, 100); return { ...r, resourceIds };
}
/** ISO date parsing is UTC and round-tripped; no host calendar or timezone lookup. */
function localDateOrdinal(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid();
  const epoch = Date.parse(value + 'T00:00:00.000Z');
  if (!Number.isSafeInteger(epoch) || new Date(epoch).toISOString().slice(0, 10) !== value) throw invalid();
  return epoch / 86400_000;
}
function authoredZone(value: unknown): string {
  const token = identifier(value, 128);
  if (token.trim() !== token || /^[+-]/.test(token)) throw invalid();
  return token;
}
function appointmentIntervalIntent(value: unknown): CalendarAppointmentIntervalInput {
  const input = record(value, ['kind', 'startDate', 'endDate', 'startAt', 'endAt', 'timeZone', 'bufferBeforeMinutes', 'bufferAfterMinutes']);
  const timeZone = authoredZone(input.timeZone);
  if (input.kind === 'all-day-local-v1') {
    const r = record(input, ['kind', 'startDate', 'endDate', 'timeZone']);
    if (Object.keys(r).length !== 4) throw invalid();
    integer(localDateOrdinal(r.endDate) - localDateOrdinal(r.startDate), 1, 31);
    return Object.freeze({ kind: 'all-day-local-v1', startDate: r.startDate as string, endDate: r.endDate as string, timeZone });
  }
  const r = record(input, ['kind', 'startAt', 'endAt', 'timeZone', 'bufferBeforeMinutes', 'bufferAfterMinutes']);
  if (r.kind !== 'timed-v1' || Object.keys(r).length !== 6) throw invalid();
  interval(r.startAt, r.endAt);
  return Object.freeze({ kind: 'timed-v1', startAt: r.startAt as string, endAt: r.endAt as string, timeZone,
    bufferBeforeMinutes: integer(r.bufferBeforeMinutes, 0, 1440), bufferAfterMinutes: integer(r.bufferAfterMinutes, 0, 1440) });
}
function dateRange(value: unknown): CalendarDateRangeQuery {
  const r = record(value, ['resourceIds', 'startDate', 'endDate', 'limit']), resourceIds = ids(r.resourceIds, true).sort();
  integer(localDateOrdinal(r.endDate) - localDateOrdinal(r.startDate), 1, 31);
  return Object.freeze({ resourceIds: Object.freeze(resourceIds), startDate: r.startDate as string, endDate: r.endDate as string,
    ...(r.limit === undefined ? {} : { limit: integer(r.limit, 1, 100) }) });
}
function resourcePage(value: unknown, query: CalendarLocationPageQuery): CalendarResourcePage {
  const r = record(value, ['items', 'truncated', 'nextAfter']);
  if (typeof r.truncated !== 'boolean') throw invalid();
  if (r.nextAfter !== null) requestKey(r.nextAfter);
  const items = values(r.items, 100).map(resourceView); unique(items.map(item => item.id));
  pageBoundary(items, r.truncated, r.nextAfter, query);
  return Object.freeze({ items: Object.freeze(items), truncated: r.truncated, nextAfter: r.nextAfter as string | null });
}
function pageBoundary(items: readonly { readonly id: string }[], truncated: boolean, nextAfter: unknown, query: CalendarLocationPageQuery): void {
  if (items.length > (query.limit ?? 25) || truncated !== (nextAfter !== null)
    || nextAfter !== null && items.at(-1)?.id !== nextAfter
    || truncated && query.limit !== undefined && items.length !== query.limit) throw invalid();
  for (let index = 0; index < items.length; index++) {
    if (items[index]!.id <= (index === 0 ? query.after ?? '' : items[index - 1]!.id)) throw invalid();
  }
}
function resourceView(value: unknown): CalendarResourceView {
  const r = record(value, ['id', 'label', 'kind', 'ownerId', 'timeZone', 'revision', 'active']);
  if (Object.keys(r).length !== 7 || r.kind !== 'person' && r.kind !== 'room' && r.kind !== 'equipment' || typeof r.active !== 'boolean') throw invalid();
  requestKey(r.id); identifier(r.label, 256); if (r.ownerId !== null) requestKey(r.ownerId); zone(r.timeZone); integer(r.revision, 1);
  return Object.freeze(r) as unknown as CalendarResourceView;
}
function appointmentView(value: unknown): CalendarAppointmentView {
  const r = record(value, ['id', 'revision', 'resourceIds', 'title', 'startAt', 'endAt', 'timeZone', 'bufferBeforeMinutes', 'bufferAfterMinutes', 'status', 'createdBy', 'appointmentType', 'lifecycle', 'visit', 'interval']);
  if (Object.keys(r).length !== 11 + (Object.hasOwn(r, 'interval') ? 1 : 0) + (Object.hasOwn(r, 'appointmentType') ? 1 : 0) + (Object.hasOwn(r, 'lifecycle') ? 1 : 0) + (Object.hasOwn(r, 'visit') ? 1 : 0)
    || r.status !== 'confirmed' && r.status !== 'cancelled') throw invalid();
  requestKey(r.id); integer(r.revision, 1); const resourceIds = ids(r.resourceIds); identifier(r.title, 512); requestKey(r.createdBy);
  instant(r.startAt); instant(r.endAt); if (Date.parse(String(r.endAt)) <= Date.parse(String(r.startAt))) throw invalid();
  let allDay: CalendarAllDayAppointmentInterval | undefined;
  if (Object.hasOwn(r, 'interval')) {
    const intent = appointmentIntervalIntent(r.interval);
    if (intent.kind !== 'all-day-local-v1' || r.bufferBeforeMinutes !== 0 || r.bufferAfterMinutes !== 0
      || Object.hasOwn(r, 'appointmentType') || Date.parse(String(r.endAt)) - Date.parse(String(r.startAt)) > 33 * 86400_000) throw invalid();
    allDay = intent; authoredZone(r.timeZone);
  } else zone(r.timeZone);
  integer(r.bufferBeforeMinutes, 0, 1440); integer(r.bufferAfterMinutes, 0, 1440);
  const binding = bookingTypeSnapshot(r);
  const lifecycle = Object.hasOwn(r, 'lifecycle') ? { lifecycle: appointmentLifecycle(r.lifecycle, r) } : {};
  const visit = Object.hasOwn(r, 'visit') ? { visit: visitSnapshot(r.visit) } : {};
  return Object.freeze({ ...r, resourceIds: Object.freeze(resourceIds), ...binding, ...lifecycle, ...visit,
    ...(allDay ? { interval: allDay } : {}) }) as unknown as CalendarAppointmentView;
}
function blockView(value: unknown): CalendarBlockView {
  const r = record(value, ['id', 'revision', 'resourceIds', 'title', 'startAt', 'endAt', 'timeZone', 'status', 'createdBy']);
  if (Object.keys(r).length !== 9 || r.status !== 'active' && r.status !== 'cancelled') throw invalid();
  requestKey(r.id); integer(r.revision, 1); const resourceIds = ids(r.resourceIds); identifier(r.title, 512); requestKey(r.createdBy);
  interval(r.startAt, r.endAt); zone(r.timeZone);
  return Object.freeze({ ...r, resourceIds: Object.freeze(resourceIds) }) as unknown as CalendarBlockView;
}
function blockPage(value: unknown): CalendarBlockPage {
  const r = record(value, ['items', 'truncated']);
  if (Object.keys(r).length !== 2 || typeof r.truncated !== 'boolean') throw invalid();
  const items = values(r.items, 100).map(blockView); unique(items.map(item => item.id));
  return Object.freeze({ items: Object.freeze(items), truncated: r.truncated });
}
function holdView(value: unknown): CalendarHoldView {
  const r = record(value, ['id', 'revision', 'resourceIds', 'startAt', 'endAt', 'timeZone', 'bufferBeforeMinutes', 'bufferAfterMinutes',
    'status', 'expiresAt', 'createdBy', 'appointmentId', 'appointmentType', 'visit']);
  if (Object.keys(r).length !== 12 + (Object.hasOwn(r, 'appointmentType') ? 1 : 0) + (Object.hasOwn(r, 'visit') ? 1 : 0) || !['held', 'expired', 'released', 'confirmed'].includes(r.status as string)) throw invalid();
  requestKey(r.id); integer(r.revision, 1); const resourceIds = ids(r.resourceIds); requestKey(r.createdBy);
  interval(r.startAt, r.endAt); instant(r.expiresAt); zone(r.timeZone);
  integer(r.bufferBeforeMinutes, 0, 1440); integer(r.bufferAfterMinutes, 0, 1440);
  if (Date.parse(String(r.expiresAt)) > Date.parse(String(r.startAt))) throw invalid();
  if (r.status === 'confirmed') requestKey(r.appointmentId);
  else if (r.appointmentId !== null) throw invalid();
  const binding = bookingTypeSnapshot(r);
  const visit = Object.hasOwn(r, 'visit') ? { visit: visitSnapshot(r.visit) } : {};
  return Object.freeze({ ...r, resourceIds: Object.freeze(resourceIds), ...binding, ...visit }) as unknown as CalendarHoldView;
}
function bookingTypeSnapshot(r: Record<string, unknown>): { readonly appointmentType?: CalendarAppointmentTypeSnapshot } {
  if (!Object.hasOwn(r, 'appointmentType')) return {};
  const appointmentType = typeSnapshot(r.appointmentType);
  if (Date.parse(String(r.endAt)) - Date.parse(String(r.startAt)) !== appointmentType.durationMinutes * 60_000
    || r.bufferBeforeMinutes !== appointmentType.bufferBeforeMinutes || r.bufferAfterMinutes !== appointmentType.bufferAfterMinutes) throw invalid();
  return { appointmentType };
}
function holdPage(value: unknown): CalendarHoldPage {
  const r = record(value, ['items', 'truncated']);
  if (Object.keys(r).length !== 2 || typeof r.truncated !== 'boolean') throw invalid();
  const items = values(r.items, 100).map(holdView); unique(items.map(item => item.id));
  if (items.some(item => item.status !== 'held')) throw invalid();
  return Object.freeze({ items: Object.freeze(items), truncated: r.truncated });
}
export function parseCalendarAppointmentPage(value: unknown): CalendarAppointmentPage { return appointmentPage(value); }
function appointmentPage(value: unknown): CalendarAppointmentPage {
  const r = record(value, ['items', 'truncated']);
  if (typeof r.truncated !== 'boolean') throw invalid();
  const items = values(r.items, 100).map(appointmentView); unique(items.map(item => item.id));
  return Object.freeze({ items: Object.freeze(items), truncated: r.truncated });
}
function appointmentDatePage(value: unknown, query: CalendarDateRangeQuery): CalendarAppointmentPage {
  const page = appointmentPage(value);
  if (page.items.length > (query.limit ?? 100)) throw invalid();
  let previous: CalendarAppointmentView | undefined;
  for (const item of page.items) {
    if (item.status !== 'confirmed' || !item.interval || item.interval.startDate >= query.endDate || item.interval.endDate <= query.startDate
      || !item.resourceIds.some(id => query.resourceIds.includes(id))) throw invalid();
    if (previous && (previous.interval!.startDate > item.interval.startDate
      || previous.interval!.startDate === item.interval.startDate && previous.id >= item.id)) throw invalid();
    previous = item;
  }
  return page;
}
function busyPage(value: unknown): CalendarBusyPage {
  const r = record(value, ['items', 'truncated']);
  if (typeof r.truncated !== 'boolean') throw invalid();
  const items = values(r.items, 100).map(value => { const b = record(value, ['resourceId', 'startAt', 'endAt']);
    if (Object.keys(b).length !== 3) throw invalid(); requestKey(b.resourceId); instant(b.startAt); instant(b.endAt);
    if (Date.parse(String(b.endAt)) <= Date.parse(String(b.startAt))) throw invalid(); return Object.freeze(b); });
  return Object.freeze({ items: Object.freeze(items), truncated: r.truncated }) as unknown as CalendarBusyPage;
}
function calendarReceipt(value: unknown): CalendarCommandReceipt {
  const r = record(value, ['requestId', 'operation', 'id', 'revision', 'changed']);
  if (Object.keys(r).length !== 5 || typeof r.operation !== 'string' || !['resource.created', 'resource.grant-changed', 'resource.availability-changed', 'resource.availability-policy-changed', 'resource.locations-changed', 'resource.location-policy-changed',
    'location.created', 'location.updated',
    'type.created', 'type.updated', 'resource.types-changed',
    'block.created', 'block.rescheduled', 'block.cancelled', 'hold.acquired', 'hold.released',
    'appointment.created', 'appointment.rescheduled', 'appointment.updated', 'appointment.cancelled', 'appointment.transitioned', 'appointment.participants-changed', 'lifecycle.policy-changed'].includes(r.operation)
    || r.operation === 'lifecycle.policy-changed' && r.id !== 'policy' || typeof r.changed !== 'boolean') throw invalid();
  if (r.operation === 'appointment.transitioned' && !r.changed) throw invalid();
  requestKey(r.requestId); requestKey(r.id); integer(r.revision, 1); return Object.freeze(r) as unknown as CalendarCommandReceipt;
}
function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !fields.includes(key) || !Object.hasOwn(descriptors[key]!, 'value')) throw invalid();
    Object.defineProperty(result, key, { value: descriptors[key]!.value, enumerable: true });
  } return result;
}
function identifier(value: unknown, max = 128): string { if (typeof value !== 'string' || !value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw invalid(); return value; }
function requestKey(value: unknown): string { const key = identifier(value); if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(key)) throw invalid(); return key; }
function values(value: unknown, max: number, min = 0): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < min || value.length > max) throw invalid();
  if (Reflect.ownKeys(value).length !== value.length + 1) throw invalid();
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw invalid(); return descriptor.value;
  });
}
function ids(value: unknown, empty = false): string[] { const accepted = values(value, 16, empty ? 0 : 1).map(id => requestKey(id)); unique(accepted); return accepted; }
function unique(value: readonly unknown[]): void { if (new Set(value).size !== value.length) throw invalid(); }
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number { if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw invalid(); return Number(value); }
function instant(value: unknown): void { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw invalid(); }
function interval(startAt: unknown, endAt: unknown): void {
  instant(startAt); instant(endAt);
  const duration = Date.parse(String(endAt)) - Date.parse(String(startAt));
  if (duration <= 0 || duration > 31 * 86400_000) throw invalid();
}
function zone(value: unknown): void { const accepted = identifier(value); if (/^[+-]/.test(accepted)) throw invalid(); try { new Intl.DateTimeFormat('en', { timeZone: accepted }); } catch { throw invalid(); } }
function invalid(): Error { return new Error('Invalid calendar request or acknowledgment.'); }
function retired(): DOMException { return new DOMException('Calendar authority scope changed.', 'AbortError'); }
