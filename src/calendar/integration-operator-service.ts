/** Private read-only Guardian boundary. Never exposes native retirement/reactivation or a source capability. */
import { admitCalendarRequest, type CalendarAuthority } from './authority';
import type { ResolvedCalendarConfig } from './config';
import { CalendarError } from './error';
import type { CalendarIntegrationNativeOperations } from './integration-operator';
import { calendarRecord } from './validation';

export interface CalendarIntegrationInspectionReadOptions { readonly signal?: AbortSignal }
export interface CalendarIntegrationInspectionForAuthority {
  get(options?: CalendarIntegrationInspectionReadOptions): ReturnType<CalendarIntegrationNativeOperations['inspect']>;
}

export function calendarIntegrationInspectionForAuthority(
  native: Pick<CalendarIntegrationNativeOperations, 'inspect'>,
  request: CalendarAuthority,
  config: Pick<ResolvedCalendarConfig, 'createOwn' | 'manage'>,
  closing: AbortSignal,
): CalendarIntegrationInspectionForAuthority {
  return Object.freeze({
    async get(options?: CalendarIntegrationInspectionReadOptions) {
      const record = calendarRecord(options === undefined ? {} : options, ['signal']);
      if (record.signal !== undefined && !(record.signal instanceof AbortSignal)) throw new CalendarError('CALENDAR_INPUT_INVALID');
      const context = await admitCalendarRequest(request, config, closing, record.signal as AbortSignal | undefined);
      if (!context.actor.manageAll) throw new CalendarError('CALENDAR_FORBIDDEN');
      context.guard();
      const result = await native.inspect(context.scope, { signal: context.signal, assertCurrent: context.guard, confirmCurrent: context.confirm });
      await context.confirm(); context.guard();
      return result;
    },
  });
}
