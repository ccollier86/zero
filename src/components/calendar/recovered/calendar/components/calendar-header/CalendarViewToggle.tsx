'use client';

import { SegmentedControl } from '../../../../components/calendar-ui';
import type { CalendarViewMode } from '../../types/calendar-view-mode';

export interface CalendarViewToggleProps {
  value: CalendarViewMode;
  onChange: (value: CalendarViewMode) => void;
}

/**
 * Toggle between day and week view
 */
export function CalendarViewToggle({ value, onChange }: CalendarViewToggleProps) {
  return (
    <SegmentedControl
      size="xs"
      value={value}
      onChange={(v) => onChange(v as CalendarViewMode)}
      data={[
        { value: 'day', label: 'Day' },
        { value: 'week', label: 'Week' },
        { value: 'month', label: 'Month' },
        { value: 'agenda', label: 'List' },
      ]}
    />
  );
}
