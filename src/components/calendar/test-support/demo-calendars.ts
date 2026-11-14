/** Synthetic preview calendars only. These are not users or persisted provider records. */
import { mockCalendarUsers } from './mock-users';
import type { CalendarResource } from '../types';
const colors = ['violet', 'blue', 'teal', 'orange', 'pink'];
export const demoCalendars: CalendarResource[] = Array.from({ length: 15 }, (_, i) => mockCalendarUsers[i] ?? {
  id: `demo-calendar-${i + 1}`,
  name: `Demo provider ${i + 1}`,
  initials: `P${i + 1}`,
  color: colors[i % colors.length]!,
});
