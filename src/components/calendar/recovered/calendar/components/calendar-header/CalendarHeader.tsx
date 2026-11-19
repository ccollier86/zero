'use client';

import { Button, Group } from '../../../../components/calendar-ui';
import type { ReactNode } from 'react';
import { IconChevronLeft, IconChevronRight } from '../../../../components/calendar-icons';
import type { CalendarViewMode } from '../../types/calendar-view-mode';
import { CalendarTitle } from './CalendarTitle';
import { CalendarViewToggle } from './CalendarViewToggle';

export interface CalendarHeaderProps {
  date: Date;
  viewMode: CalendarViewMode;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  onViewChange: (view: CalendarViewMode) => void;
  providerSwitcher?: ReactNode;
  /** Managed civil-date consumers supply a zone-independent title; local previews retain CalendarTitle. */
  title?: ReactNode;
}

/**
 * Calendar header with navigation and view toggle
 */
export function CalendarHeader({
  date,
  viewMode,
  onPrevious,
  onNext,
  onToday,
  onViewChange,
  providerSwitcher,
  title,
}: CalendarHeaderProps) {
  return (
    <Group justify="space-between" mb="md" className="calendar-toolbar">
      <Group gap="sm">
        <Button.Group>
          <Button variant="default" size="xs" onClick={onPrevious} aria-label={`Previous ${viewMode}`}>
            <IconChevronLeft size="var(--calendar-size-16)" />
          </Button>
          <Button variant="default" size="xs" onClick={onToday}>
            Today
          </Button>
          <Button variant="default" size="xs" onClick={onNext} aria-label={`Next ${viewMode}`}>
            <IconChevronRight size="var(--calendar-size-16)" />
          </Button>
        </Button.Group>
        {title ?? <CalendarTitle date={date} viewMode={viewMode} />}
      </Group>
      <Group gap="xs">{providerSwitcher}<CalendarViewToggle value={viewMode} onChange={onViewChange} /></Group>
    </Group>
  );
}
