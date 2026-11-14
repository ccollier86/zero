'use client';

import { ActionIcon, Group } from '../../../../components/calendar-ui';
import { IconChevronLeft, IconChevronRight } from '../../../../components/calendar-icons';

export interface CalendarNavigationProps {
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
}

/**
 * Navigation buttons for calendar
 */
export function CalendarNavigation({
  onPrevious,
  onNext,
  onToday,
}: CalendarNavigationProps) {
  return (
    <Group gap="var(--calendar-size-4)">
      <ActionIcon variant="subtle" onClick={onPrevious}>
        <IconChevronLeft size="var(--calendar-size-18)" />
      </ActionIcon>
      <ActionIcon variant="subtle" onClick={onToday}>
        Today
      </ActionIcon>
      <ActionIcon variant="subtle" onClick={onNext}>
        <IconChevronRight size="var(--calendar-size-18)" />
      </ActionIcon>
    </Group>
  );
}
