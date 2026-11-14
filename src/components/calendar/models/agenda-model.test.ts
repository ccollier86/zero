import { describe, expect, test } from 'bun:test';
import { agendaEntries } from './agenda-model';
import { newDraft, sameDraft } from './calendar-model';
import { appointmentStatusRequest } from './appointment-status-change';
import { freshVisit } from './appointment-presentation';
import { seedEvents } from '../test-support/seed-events';
import type { CalendarResource, ScheduleEvent } from '../types';
const resources: CalendarResource[] = [{ id: 'a', name: 'Calendar A', initials: 'A', color: 'blue' }, { id: 'b', name: 'Calendar B', initials: 'B', color: 'teal' }];
const event = (id: string, start: number, resourceId = 'a'): ScheduleEvent => ({ ...newDraft({ resourceId, date: '2026-11-16', minute: start }, 'appointment'), id, title: id });
describe('shared scoped day agenda', () => {
  test('sorts all selected calendars chronologically without mutating source data', () => {
    const source = [event('late', 660), event('early', 480, 'b'), event('middle', 540)];
    expect(agendaEntries(source, resources, '2026-11-16').map(item => item.event.id)).toEqual(['early', 'middle', 'late']);
    expect(source.map(item => item.id)).toEqual(['late', 'early', 'middle']);
  });
  test('does not broaden empty resource scope or include another day/calendar', () => {
    const source = [event('allowed', 540), event('other-resource', 540, 'b'), { ...event('other-day', 540), date: '2026-11-17' }];
    expect(agendaEntries(source, [], '2026-11-16')).toEqual([]);
    expect(agendaEntries(source, resources.slice(0, 1), '2026-11-16').map(item => item.event.id)).toEqual(['allowed']);
  });
  test('carries busy-only presentation without making scope a permission claim', () => {
    expect(agendaEntries([event('busy', 540)], resources, '2026-11-16', () => ({ busyOnly: true }))[0]?.presentation.busyOnly).toBe(true);
  });
});
describe('status change intents and two-tone fixtures', () => {
  test('unchanged status emits no intent; a real change does not mutate the event', () => {
    const source = event('visit', 540);
    expect(appointmentStatusRequest(source, source.status)).toBeNull();
    const request = appointmentStatusRequest(source, 'cancelled');
    expect(request).toMatchObject({ previous: 'confirmed', next: 'cancelled', change: { status: 'cancelled' } });
    expect(source.status).toBe('confirmed');
  });
  test('terminal transition clears an occupied lobby, without changing confirmation through progress alone', () => {
    const source = { ...event('visit', 540), visit: { stage: 'waiting' as const, waitingRoom: 'virtual' as const, arrivedAt: 123 } };
    expect(appointmentStatusRequest(source, 'cancelled')?.change.visit).toMatchObject({ stage: 'scheduled', waitingRoom: 'none' });
  });
  test('cancellation reason participates in dirty state, but is retired on restoration/duplication', () => {
    const source = { ...event('visit', 540), status: 'cancelled' as const, cancellationReason: 'A synthetic reason' };
    expect(sameDraft(source, { ...source, cancellationReason: 'Different reason' })).toBe(false);
    expect(freshVisit(source).cancellationReason).toBeUndefined();
    expect(appointmentStatusRequest(source, 'confirmed')?.change).toHaveProperty('cancellationReason', undefined);
  });
  test('future fixture pair uses the exact same hue and scheduled visit, with explicit attention only', () => {
    const pair = seedEvents(resources, new Date(2026, 10, 14, 12)).filter(item => item.id.startsWith('demo-tone-0-'));
    expect(pair).toHaveLength(2); expect(pair.every(item => item.date > '2026-11-14')).toBe(true);
    expect(pair.map(item => item.appearance?.color)).toEqual(['blue', 'blue']);
    expect(pair.map(item => item.appearance?.attention)).toEqual(['none', 'missing-details']);
    expect(pair.every(item => !item.visit || item.visit.stage === 'scheduled')).toBe(true);
  });
});
