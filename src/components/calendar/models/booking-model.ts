/** Synthetic local availability for the booking UI. No durable holds, recurrence expansion,
 * timezone/DST rules, invitations or backend permission enforcement are implemented here. */
import { dateKey, isDay, parseDay } from './calendar-date';
import type { CalendarResource, ScheduleEvent } from '../types';
export type BookingVisitor = 'guest' | 'member' | 'invited';
export interface BookingSettings {
  enabled: boolean;
  audience: 'public' | 'members' | 'invitation';
  approval: 'instant' | 'request';
  types: string[];
  modes: ScheduleEvent['location'][];
  noticeHours: number;
  horizonDays: number;
  buffer: number;
  weekends: boolean;
}
export const defaultBookingSettings: BookingSettings = { enabled: true, audience: 'members', approval: 'request', types: ['intake', 'follow-up', 'med-mgmt', 'therapy'], modes: ['Telehealth', 'In-person'], noticeHours: 2, horizonDays: 30, buffer: 10, weekends: false };
export function bookingDuration(type: string) { return type === 'intake' || type === 'therapy' ? 60 : type === 'med-mgmt' ? 20 : 30; }
export function bookingAccess(settings: BookingSettings, visitor: BookingVisitor): string | null {
  if (!settings.enabled) return 'Self-scheduling is turned off. Please contact the scheduling team.';
  if (settings.audience === 'invitation' && visitor !== 'invited') return 'An invitation is required to use this booking page.';
  if (settings.audience === 'members' && visitor === 'guest') return 'Sign in to see available appointments.';
  return null;
}
export function bookingDayAllowed(day: string, settings: BookingSettings, now: Date): boolean {
  if (!isDay(day)) return false;
  const end = new Date(now); end.setDate(end.getDate() + settings.horizonDays);
  const date = parseDay(day), weekday = date.getDay();
  return day >= dateKey(now) && day <= dateKey(end) && (settings.weekends || (weekday !== 0 && weekday !== 6));
}
export interface BookingSlot { resourceId: string; minute: number; end: number }
export interface AvailabilityInput {
  settings: BookingSettings; visitor: BookingVisitor; day: string; type: string;
  mode: ScheduleEvent['location']; siteId: string; providerId: string;
  locationsForResource(resourceId: string): readonly string[];
  resources: readonly CalendarResource[]; events: readonly ScheduleEvent[]; now: Date;
}
export function availableBookingSlots(input: AvailabilityInput): BookingSlot[] {
  const { settings, visitor, day, type, mode, siteId, providerId, resources, events, now, locationsForResource } = input;
  if (bookingAccess(settings, visitor) || !bookingDayAllowed(day, settings, now) || !settings.types.includes(type) || !settings.modes.includes(mode)) return [];
  const eligible = resources.filter(resource => (providerId === 'any' || resource.id === providerId) && locationsForResource(resource.id).includes(siteId));
  const duration = bookingDuration(type), earliest = now.getTime() + settings.noticeHours * 3600000;
  const slots: BookingSlot[] = [];
  for (let minute = 9 * 60; minute + duration <= 17 * 60; minute += 30) {
    const starts = parseDay(day); starts.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
    if (starts.getTime() < earliest) continue;
    // "Any provider" returns one concrete eligible resource per start time, deterministically.
    const resource = eligible.find(candidate => !events.some(event => event.resourceId === candidate.id && event.date === day && event.status !== 'cancelled' && event.status !== 'no-show' && minute < event.end + settings.buffer && event.start - settings.buffer < minute + duration));
    if (resource) slots.push({ resourceId: resource.id, minute, end: minute + duration });
  }
  return slots;
}
