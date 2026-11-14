import { describe, expect, test } from 'bun:test';
import { appearanceOf, attentionLabel, changeVisit, eventColor, freshVisit, presentationError, progressLabel, visitOf } from './appointment-presentation';
import { eventDraft, newDraft, sameDraft, validateDraft } from './calendar-model';
import { updateAppointmentDraft } from './appointment-draft';
import { demoCalendars } from '../test-support/demo-calendars';
const base = () => newDraft({ date: '2026-11-16', resourceId: 'user-1', minute: 540 }, 'appointment');
describe('independent appointment presentation', () => {
  test('legacy defaults remain equal to their normalized draft', () => {
    const event = { ...base(), id: 'synthetic' }, copy = eventDraft(event);
    expect(sameDraft(base(), copy)).toBe(true);
    expect(visitOf(copy)).toEqual({ stage: 'scheduled', waitingRoom: 'none', arrivedAt: null });
    expect(attentionLabel(copy)).toBeNull();
  });
  test('unconfirmed does not mean attention; waiting does not mean confirmed', () => {
    const event = { ...base(), status: 'tentative' as const, visit: changeVisit(base(), 'waiting', 'virtual', 1000) };
    expect(progressLabel(event)).toBe('Virtual lobby');
    expect(event.status).toBe('tentative');
    expect(progressLabel(event, false)).toBe('Unconfirmed');
    expect(attentionLabel(event)).toBeNull();
  });
  test('attention preserves hue and is dirty independently of workflow', () => {
    const original = base(), changed = { ...original, appearance: { color: 'violet' as const, attention: 'running-late' as const } };
    expect(sameDraft(original, changed)).toBe(false);
    expect(attentionLabel(changed)).toBe('Running late');
    expect(eventColor(changed, demoCalendars[0], 'type')).toBe('violet');
    expect(appearanceOf(changed).attention).toBe('running-late');
  });
  test('automatic colors follow the selected policy; explicit colors take priority', () => {
    const event = { ...base(), visitType: 'therapy' };
    expect(eventColor(event, demoCalendars[0], 'type')).toBe('orange');
    expect(eventColor(event, { ...demoCalendars[0]!, color: 'teal' }, 'calendar')).toBe('teal');
  });
  test('departure clears lobby without changing original check-in time', () => {
    const event = { ...base(), visit: changeVisit(base(), 'waiting', 'virtual', 1000) };
    expect(changeVisit(event, 'in-session', undefined, 5000)).toEqual({ stage: 'in-session', waitingRoom: 'none', arrivedAt: 1000 });
    expect(changeVisit(event, 'scheduled')).toEqual({ stage: 'scheduled', waitingRoom: 'none', arrivedAt: null });
  });
  test('terminal outcomes clear occupied lobbies; reschedule/duplicate retire old visit data', () => {
    const event = { ...base(), visit: changeVisit(base(), 'waiting', 'virtual', 1000), appearance: { color: 'teal' as const, attention: 'running-late' as const } };
    const ended = updateAppointmentDraft(event, { status: 'completed' });
    expect(progressLabel(ended)).toBe('Completed');
    expect(visitOf(ended).waitingRoom).toBe('none');
    expect(freshVisit(event).visit).toEqual(visitOf({}));
    expect(freshVisit(event).appearance).toEqual({ color: 'teal', attention: 'none' });
  });
  test('changing visit mode retires an incompatible lobby; invalid cross-mode rooms reject', () => {
    const event = { ...base(), visit: changeVisit(base(), 'waiting', 'virtual', 1000) };
    expect(presentationError({ ...event, location: 'In-person' })).toContain('match the visit mode');
    const changed = updateAppointmentDraft(event, { location: 'In-person' });
    expect(visitOf(changed).waitingRoom).toBe('none');
    expect(presentationError(changed)).toBeNull();
  });
  test('moving time or calendar does not move an already-waiting person into the new visit', () => {
    const event = { ...base(), visit: changeVisit(base(), 'waiting', 'virtual', 1000), appearance: { color: 'pink' as const, attention: 'running-late' as const } };
    const changed = updateAppointmentDraft(event, { date: '2026-11-17' });
    expect(visitOf(changed)).toEqual(visitOf({})); expect(attentionLabel(changed)).toBeNull();
    expect(visitOf(updateAppointmentDraft(event, { notes: 'Synthetic note' })).stage).toBe('waiting');
  });
  test('new outcomes validate, and cloned nested settings never alias the original', () => {
    const original = { ...base(), id: 'synthetic', appearance: { color: 'blue' as const, attention: 'needs-review' as const }, visit: changeVisit(base(), 'checked-in', undefined, 1000) };
    const copy = eventDraft(original); copy.appearance!.attention = 'none'; copy.visit!.arrivedAt = 2000;
    expect(original.appearance.attention).toBe('needs-review'); expect(original.visit.arrivedAt).toBe(1000);
    expect(validateDraft({ ...base(), status: 'no-show' }, demoCalendars)).toBeNull();
  });
});
