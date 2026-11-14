'use client';

import { Title } from '../../../../components/calendar-ui';

export interface CalendarTitleProps {
  date: Date;
  viewMode: 'day' | 'week' | 'month' | 'agenda';
}

/**
 * Calendar title with date
 */
export function CalendarTitle({ date, viewMode }: CalendarTitleProps) {
  if (viewMode === 'week') {
    const start = new Date(date); start.setHours(12, 0, 0, 0); start.setDate(start.getDate() - (start.getDay() + 6) % 7);
    const end = new Date(start); end.setDate(end.getDate() + 6);
    return <Title order={4}>{new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).formatRange(start, end)}</Title>;
  }
  const options: Intl.DateTimeFormatOptions =
    viewMode === 'month'
      ? { month: 'long', year: 'numeric' }
      : { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };

  return <Title order={4}>{date.toLocaleDateString('en-US', options)}</Title>;
}
