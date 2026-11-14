import type { WeekCalendarEvent } from '../recovered/calendar/types/index';

/**
 * Mock events for week view
 */
export const mockWeekEvents: WeekCalendarEvent[] = [
  // Monday (dayIndex: 0)
  {
    id: 'week-1',
    title: 'Team Standup',
    meta: 'Telehealth',
    start: 9,
    end: 9.5,
    color: 'var(--calendar-color-blue-6)',
    background: 'var(--calendar-color-blue-1)',
    dayIndex: 0,
  },
  {
    id: 'week-2',
    title: 'John Smith - Follow-up',
    meta: 'Telehealth',
    start: 10,
    end: 11,
    color: 'var(--calendar-color-blue-6)',
    background: 'var(--calendar-color-blue-1)',
    dayIndex: 0,
  },
  {
    id: 'week-3',
    title: 'Sarah Davis - Therapy',
    meta: 'In-person',
    start: 14,
    end: 15,
    color: 'var(--calendar-color-green-6)',
    background: 'var(--calendar-color-green-1)',
    dayIndex: 0,
  },

  // Tuesday (dayIndex: 1)
  {
    id: 'week-4',
    title: 'Emily Johnson - Assessment',
    meta: 'In-person',
    start: 9,
    end: 10.5,
    color: 'var(--calendar-color-green-6)',
    background: 'var(--calendar-color-green-1)',
    dayIndex: 1,
  },
  {
    id: 'week-5',
    title: 'Michael Brown - Consultation',
    meta: 'Phone',
    start: 11,
    end: 11.5,
    color: 'var(--calendar-color-orange-6)',
    background: 'var(--calendar-color-orange-1)',
    dayIndex: 1,
  },
  {
    id: 'week-6',
    title: 'Robert Wilson - Review',
    meta: 'Telehealth',
    start: 15,
    end: 16,
    color: 'var(--calendar-color-blue-6)',
    background: 'var(--calendar-color-blue-1)',
    dayIndex: 1,
  },

  // Wednesday (dayIndex: 2)
  {
    id: 'week-7',
    title: 'Group Therapy Session',
    meta: 'In-person',
    start: 10,
    end: 12,
    color: 'var(--calendar-color-violet-6)',
    background: 'var(--calendar-color-violet-1)',
    dayIndex: 2,
  },
  {
    id: 'week-8',
    title: 'Lisa Anderson - Follow-up',
    meta: 'Telehealth',
    start: 14,
    end: 15,
    color: 'var(--calendar-color-blue-6)',
    background: 'var(--calendar-color-blue-1)',
    dayIndex: 2,
  },

  // Thursday (dayIndex: 3)
  {
    id: 'week-9',
    title: 'James Taylor - Initial',
    meta: 'In-person',
    start: 9,
    end: 10.5,
    color: 'var(--calendar-color-green-6)',
    background: 'var(--calendar-color-green-1)',
    dayIndex: 3,
  },
  {
    id: 'week-10',
    title: 'Admin Time',
    meta: 'Office',
    start: 11,
    end: 12,
    color: 'var(--calendar-color-gray-6)',
    background: 'var(--calendar-color-gray-1)',
    dayIndex: 3,
  },
  {
    id: 'week-11',
    title: 'Patricia Moore - Therapy',
    meta: 'Telehealth',
    start: 13,
    end: 14,
    color: 'var(--calendar-color-blue-6)',
    background: 'var(--calendar-color-blue-1)',
    dayIndex: 3,
  },
  {
    id: 'week-12',
    title: 'David Garcia - Review',
    meta: 'Phone',
    start: 15,
    end: 15.5,
    color: 'var(--calendar-color-orange-6)',
    background: 'var(--calendar-color-orange-1)',
    dayIndex: 3,
  },

  // Friday (dayIndex: 4)
  {
    id: 'week-13',
    title: 'Jennifer Martinez - Assessment',
    meta: 'In-person',
    start: 9,
    end: 10.5,
    color: 'var(--calendar-color-green-6)',
    background: 'var(--calendar-color-green-1)',
    dayIndex: 4,
  },
  {
    id: 'week-14',
    title: 'Team Meeting',
    meta: 'Office',
    start: 11,
    end: 12,
    color: 'var(--calendar-color-cyan-6)',
    background: 'var(--calendar-color-cyan-1)',
    dayIndex: 4,
  },
  {
    id: 'week-15',
    title: 'Case Review',
    meta: 'Office',
    start: 14,
    end: 15,
    color: 'var(--calendar-color-gray-6)',
    background: 'var(--calendar-color-gray-1)',
    dayIndex: 4,
  },

  // Saturday (dayIndex: 5) - light schedule
  {
    id: 'week-16',
    title: 'William Lee - Emergency',
    meta: 'Telehealth',
    start: 10,
    end: 11,
    color: 'var(--calendar-color-red-6)',
    background: 'var(--calendar-color-red-1)',
    dayIndex: 5,
  },

  // Sunday (dayIndex: 6) - no appointments
];
