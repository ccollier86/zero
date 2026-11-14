import { describe, expect, test } from 'bun:test';
import { availableBookingSlots, bookingAccess, bookingDayAllowed, defaultBookingSettings, type AvailabilityInput } from './booking-model';
import { newDraft } from './calendar-model';
import { demoCalendars } from '../test-support/demo-calendars';
import { providerLocations } from '../test-support/practice-data';
const input = (): AvailabilityInput => ({ locationsForResource: providerLocations, settings: { ...defaultBookingSettings, audience: 'public', noticeHours: 0, buffer: 10 }, visitor: 'guest', day: '2026-11-16', type: 'follow-up', mode: 'Telehealth', siteId: 'ky-owensboro', providerId: 'user-1', resources: demoCalendars, events: [], now: new Date(2026, 10, 16, 8) });
describe('synthetic self-scheduling availability', () => {
  test('disabled, member and invitation modes never broaden access', () => {
    expect(bookingAccess({ ...defaultBookingSettings, enabled: false }, 'invited')).not.toBeNull();
    expect(bookingAccess(defaultBookingSettings, 'guest')).toContain('Sign in');
    expect(bookingAccess({ ...defaultBookingSettings, audience: 'invitation' }, 'member')).toContain('invitation');
    expect(bookingAccess({ ...defaultBookingSettings, audience: 'invitation' }, 'invited')).toBeNull();
    const data = input(); data.settings.enabled = false;
    expect(availableBookingSlots(data)).toEqual([]);
  });
  test('working hours and appointment duration bound the last possible start', () => {
    expect(availableBookingSlots(input()).map(slot => slot.minute)).toEqual(Array.from({ length: 16 }, (_, i) => 540 + i * 30));
    expect(availableBookingSlots({ ...input(), type: 'intake' }).at(-1)?.minute).toBe(960);
  });
  test('past days, weekends, horizon and lead time are explicit', () => {
    const { settings, now } = input();
    expect(bookingDayAllowed('2026-11-15', settings, now)).toBe(false);
    expect(bookingDayAllowed('2026-11-21', settings, now)).toBe(false);
    expect(bookingDayAllowed('2026-11-21', { ...settings, weekends: true }, now)).toBe(true);
    expect(bookingDayAllowed('2027-01-01', settings, now)).toBe(false);
    const slots = availableBookingSlots({ ...input(), settings: { ...settings, noticeHours: 2 }, now: new Date(2026, 10, 16, 9, 1) });
    expect(slots[0]?.minute).toBe(690);
  });
  test('provider location coverage and admitted option lists restrict candidates', () => {
    expect(availableBookingSlots({ ...input(), providerId: 'user-3' })).toEqual([]);
    expect(availableBookingSlots({ ...input(), siteId: 'unknown-site' })).toEqual([]);
    expect(availableBookingSlots({ ...input(), type: 'unknown-type' })).toEqual([]);
    expect(availableBookingSlots({ ...input(), mode: 'Phone' })).toEqual([]);
    expect(availableBookingSlots({ ...input(), resources: [] })).toEqual([]);
  });
  test('appointments, blocks and review requests exclude conflicts including the buffer', () => {
    const event = { ...newDraft({ date: '2026-11-16', resourceId: 'user-1', minute: 600 }, 'block'), id: 'synthetic', end: 660 };
    const minutes = availableBookingSlots({ ...input(), events: [event] }).map(slot => slot.minute);
    expect(minutes).not.toContain(570); expect(minutes).not.toContain(600); expect(minutes).not.toContain(660); expect(minutes).toContain(690);
    expect(availableBookingSlots({ ...input(), events: [{ ...event, status: 'cancelled' }] })).toHaveLength(16);
    expect(availableBookingSlots({ ...input(), events: [{ ...event, status: 'tentative' }] })).toHaveLength(minutes.length);
  });
  test('any provider selects a concrete eligible alternate, not a fictional unowned slot', () => {
    const event = { ...newDraft({ date: '2026-11-16', resourceId: 'user-1', minute: 540 }, 'block'), id: 'synthetic', end: 600 };
    const slots = availableBookingSlots({ ...input(), providerId: 'any', events: [event] });
    expect(slots[0]?.resourceId).toBe('user-2');
    expect(slots[0]?.minute).toBe(540);
  });
});
