/** Fixed local discovery over current admitted authority; no owner/file/actor allocation or client-selected policy. */
import type { ResolvedCalendarConfig } from './config';
import type { CalendarActor, CalendarCapabilities } from './contracts';
import type { CalendarServiceBroker } from './service';
import type { ServiceDataScope } from '../auth/service-data-scope';
import { CalendarError } from './error';
import { calendarRecord } from './validation';

export function calendarCapabilitiesBroker(broker: CalendarServiceBroker, config: ResolvedCalendarConfig,
  participantDirectoryReady: boolean): CalendarServiceBroker {
  const project = (input: unknown, guard: () => void): CalendarCapabilities => {
    guard();
    const value = calendarRecord(input, ['actor']), actor = value.actor as CalendarActor;
    if (!config.timezone || config.readiness !== 'configured' || config.participants && !participantDirectoryReady) throw new CalendarError('CALENDAR_NOT_READY');
    const result = Object.freeze({ timeZone: config.timezone, createOwn: actor.createOwn, manage: actor.manageAll,
      participants: !!config.participants && actor.manageAll, allDayAppointments: true, locationPolicies: true,
      appointmentOverrides: !!config.overrides && actor.overrides?.use === true,
      overrideGrants: !!config.overrides && actor.overrides?.manageGrants === true,
      limits: Object.freeze({ maxRangeDays: config.maxRangeDays, maxPageSize: config.maxPageSize,
        maxResources: config.maxResources, maxParticipants: config.maxParticipants }) });
    guard(); return result;
  };
  return {
    read: async <T>(scope: ServiceDataScope, name: string, input: unknown, guard: () => void, signal?: AbortSignal) => {
      if (name !== 'calendar.capabilities') return broker.read<T>(scope, name, input, guard, signal);
      signal?.throwIfAborted(); return project(input, guard) as T;
    },
    write: (scope, name, input, key, guard, signal, finalCommitGuard) => broker.write(scope, name, input, key, guard, signal, finalCommitGuard),
    subscribe: (scope, listener, name) => broker.subscribe?.(scope, listener, name) ?? (() => {}),
    publish: <T>(scope: ServiceDataScope, name: string, input: unknown, value: T, guard: () => void) => name === 'calendar.capabilities' ? project(input, guard) as T
      : broker.publish?.(scope, name, input, value, guard) ?? value,
  };
}
