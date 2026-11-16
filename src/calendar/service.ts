/** Internal scoped service; intentionally not mounted or exported until lifecycle qualification. */
import type { ServiceDataScope } from '../auth/service-data-scope';
import type { CalendarCommandReceipt } from './contracts';
import { CalendarError } from './error';
import { calendarHash, calendarKey, calendarRecord, calendarValue } from './validation';
import { admitCalendarRequest, type CalendarAuthority } from './authority';
import type { ResolvedCalendarConfig } from './config';

export interface CalendarServiceBroker {
  read<T>(scope: ServiceDataScope, name: string, input: unknown, guard: () => void): Promise<T>;
  write<T>(scope: ServiceDataScope, name: string, input: unknown, requestId: string, guard: () => void): Promise<T>;
}

/** No caller may choose an actor, scope or operation through this object. */
export class CalendarService {
  constructor(private readonly broker: CalendarServiceBroker, private readonly config: ResolvedCalendarConfig,
    private readonly closing: AbortSignal) {}

  forAuthority(request: CalendarAuthority) {
    return Object.freeze({
      createResource: (input: unknown, requestId: string) => this.write(request, 'resource.create', input, requestId),
      createAppointment: (input: unknown, requestId: string) => this.write(request, 'appointment.create', input, requestId),
    });
  }

  private async write(request: CalendarAuthority, operation: string, input: unknown, requestId: string): Promise<CalendarCommandReceipt> {
    if (this.config.readiness !== 'configured') throw new CalendarError('CALENDAR_NOT_READY');
    // Detach before the first await; author mutation cannot alter an admitted command.
    const fields = operation === 'resource.create' ? ['label', 'kind', 'ownerId', 'timeZone']
      : ['resourceIds', 'title', 'startAt', 'endAt', 'timeZone', 'bufferBeforeMinutes', 'bufferAfterMinutes'];
    const body = calendarValue(calendarRecord(input, fields));
    const key = calendarKey(requestId);
    const authority = await admitCalendarRequest(request, this.config, this.closing);
    const result = await this.broker.write<CalendarCommandReceipt>(authority.scope, 'calendar.' + operation,
      { ...(body as object), actor: authority.actor, requestId: key,
        id: calendarHash([authority.actor.scopeId, authority.actor.principal, key]) }, key, authority.guard);
    try { await authority.confirm(); }
    catch { throw new CalendarError('CALENDAR_OUTCOME_UNKNOWN'); }
    return result;
  }
}
