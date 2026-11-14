/** Fictional practice geography for UI review. No identities, authority or live locations. */
import type { ScheduleEvent } from '../types';
import type { CalendarLocation, CalendarGeography } from '../models/calendar-geography';

export type PracticeLocation = CalendarLocation;
export const practiceStates = [
  { id: 'KY', name: 'Kentucky' }, { id: 'GA', name: 'Georgia' },
  { id: 'TX', name: 'Texas' }, { id: 'IN', name: 'Indiana' },
];
export const practiceLocations: PracticeLocation[] = [
  { id: 'ky-owensboro', name: 'Owensboro', state: 'KY' },
  { id: 'ga-alpharetta', name: 'Alpharetta', state: 'GA' },
  { id: 'tx-austin', name: 'Austin', state: 'TX' },
  { id: 'in-indianapolis', name: 'Indianapolis', state: 'IN' },
  { id: 'in-greenwood', name: 'Greenwood', state: 'IN' },
  { id: 'in-evansville', name: 'Evansville', state: 'IN' },
  { id: 'in-fort-wayne', name: 'Fort Wayne', state: 'IN' },
];
const all = practiceLocations.map(location => location.id);
const indiana = practiceLocations.filter(location => location.state === 'IN').map(location => location.id);
const coverage: Record<string, readonly string[]> = {
  'user-1': all,
  'user-2': ['ky-owensboro', 'in-evansville'],
  'user-3': ['ga-alpharetta'],
  'user-4': indiana,
  'user-5': ['tx-austin'],
  'demo-calendar-6': ['in-indianapolis', 'in-greenwood'],
  'demo-calendar-7': ['in-fort-wayne'],
  'demo-calendar-8': ['ky-owensboro', 'ga-alpharetta'],
  'demo-calendar-9': ['tx-austin', 'in-evansville'],
  'demo-calendar-10': ['in-indianapolis'],
  'demo-calendar-11': ['ga-alpharetta', 'ky-owensboro', 'tx-austin'],
  'demo-calendar-12': ['in-evansville'],
  'demo-calendar-13': ['in-greenwood', 'in-fort-wayne'],
  'demo-calendar-14': ['ga-alpharetta'],
  'demo-calendar-15': all,
};
export function providerLocations(resourceId: string): readonly string[] { return coverage[resourceId] ?? []; }
export const practiceGeography: CalendarGeography = { locations: practiceLocations, states: practiceStates, locationsForResource: providerLocations };
export function eventLocation(event: ScheduleEvent): string | null {
  return event.kind === 'block' ? null : event.siteId ?? providerLocations(event.resourceId)[0] ?? null;
}
export function locationLabel(id: string): string {
  const location = practiceLocations.find(location => location.id === id);
  return location ? `${location.name}, ${location.state}` : 'Unassigned location';
}
/** These only demonstrate UI variations. They are not security policies. */
export const practicePreviewScopes = [
  { id: 'practice', name: 'All practice locations', locations: all },
  { id: 'indiana', name: 'Indiana locations', locations: indiana },
  { id: 'greenwood', name: 'Greenwood office only', locations: ['in-greenwood'] },
];
