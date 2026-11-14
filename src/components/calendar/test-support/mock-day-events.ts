import type { CalendarEvent } from '../recovered/calendar/types/calendar-event';

/**
 * Mock events for day view
 */
export const mockDayEvents: CalendarEvent[] = [
  {
    id: 'day-1',
    title: 'John Smith - Follow-up',
    meta: 'Telehealth',
    start: 9,
    end: 10,
    color: 'var(--calendar-color-blue-6)',
    background: 'var(--calendar-color-blue-1)',
  },
  {
    id: 'day-2',
    title: 'Emily Johnson - Initial Assessment',
    meta: 'In-person',
    start: 10.5,
    end: 12,
    color: 'var(--calendar-color-green-6)',
    background: 'var(--calendar-color-green-1)',
  },
  {
    id: 'day-3',
    title: 'Michael Brown - Consultation',
    meta: 'Phone',
    start: 13,
    end: 13.5,
    color: 'var(--calendar-color-orange-6)',
    background: 'var(--calendar-color-orange-1)',
  },
  {
    id: 'day-4',
    title: 'Sarah Davis - Therapy Session',
    meta: 'Telehealth',
    start: 14,
    end: 15,
    color: 'var(--calendar-color-blue-6)',
    background: 'var(--calendar-color-blue-1)',
  },
  {
    id: 'day-5',
    title: 'Robert Wilson - Progress Review',
    meta: 'Telehealth',
    start: 15.5,
    end: 16.5,
    color: 'var(--calendar-color-blue-6)',
    background: 'var(--calendar-color-blue-1)',
  },
];
