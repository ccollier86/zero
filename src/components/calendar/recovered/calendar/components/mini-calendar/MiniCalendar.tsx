'use client';

import { useEffect, useState } from 'react';
import { ActionIcon, Group, SimpleGrid, Stack, Text, UnstyledButton } from '../../../../components/calendar-ui';
import { IconChevronLeft, IconChevronRight } from '../../../../components/calendar-icons';

export interface MiniCalendarProps {
  selectedDate: Date;
  onDateSelect: (date: Date) => void;
  isDateDisabled?: (date: Date) => boolean;
}

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type ViewMode = 'days' | 'months' | 'years';

/**
 * Mini calendar for month navigation
 * Click month/year to pick faster
 */
export function MiniCalendar({ selectedDate, onDateSelect, isDateDisabled }: MiniCalendarProps) {
  const [viewDate, setViewDate] = useState(new Date(selectedDate));
  const [viewMode, setViewMode] = useState<ViewMode>('days');
  useEffect(() => { setViewDate(new Date(selectedDate)); }, [selectedDate]);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  // Get first day of month and total days
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  // For year view - show decade
  const decadeStart = Math.floor(year / 10) * 10;

  // Navigate
  const goToPrev = () => {
    if (viewMode === 'days') {
      setViewDate(new Date(year, month - 1, 1));
    } else if (viewMode === 'months') {
      setViewDate(new Date(year - 1, month, 1));
    } else {
      setViewDate(new Date(decadeStart - 10, month, 1));
    }
  };

  const goToNext = () => {
    if (viewMode === 'days') {
      setViewDate(new Date(year, month + 1, 1));
    } else if (viewMode === 'months') {
      setViewDate(new Date(year + 1, month, 1));
    } else {
      setViewDate(new Date(decadeStart + 10, month, 1));
    }
  };

  // Check if date matches selected
  const isSelected = (day: number) => {
    return (
      selectedDate.getDate() === day &&
      selectedDate.getMonth() === month &&
      selectedDate.getFullYear() === year
    );
  };

  // Check if today
  const isToday = (day: number) => {
    const today = new Date();
    return (
      today.getDate() === day &&
      today.getMonth() === month &&
      today.getFullYear() === year
    );
  };

  // Build calendar grid
  const calendarDays: { day: number; isCurrentMonth: boolean }[] = [];

  // Previous month days
  for (let i = firstDay - 1; i >= 0; i--) {
    calendarDays.push({ day: daysInPrevMonth - i, isCurrentMonth: false });
  }

  // Current month days
  for (let i = 1; i <= daysInMonth; i++) {
    calendarDays.push({ day: i, isCurrentMonth: true });
  }

  // Next month days to fill grid (6 rows)
  const remaining = 42 - calendarDays.length;
  for (let i = 1; i <= remaining; i++) {
    calendarDays.push({ day: i, isCurrentMonth: false });
  }

  const handleDateClick = (day: number, isCurrentMonth: boolean) => {
    if (isCurrentMonth && !isDateDisabled?.(new Date(year, month, day))) {
      onDateSelect(new Date(year, month, day));
    }
  };

  const handleMonthClick = (monthIndex: number) => {
    setViewDate(new Date(year, monthIndex, 1));
    setViewMode('days');
  };

  const handleYearClick = (selectedYear: number) => {
    setViewDate(new Date(selectedYear, month, 1));
    setViewMode('months');
  };

  const handleHeaderClick = () => {
    if (viewMode === 'days') {
      setViewMode('months');
    } else if (viewMode === 'months') {
      setViewMode('years');
    }
  };

  // Header text based on view mode
  const getHeaderText = () => {
    if (viewMode === 'days') {
      return `${MONTHS[month]} ${year}`;
    } else if (viewMode === 'months') {
      return `${year}`;
    } else {
      return `${decadeStart} - ${decadeStart + 9}`;
    }
  };

  return (
    <Stack gap="var(--calendar-size-4)">
      {/* Header */}
      <Group justify="space-between" mb="var(--calendar-size-4)">
        <ActionIcon variant="subtle" size="xs" onClick={goToPrev} aria-label="Previous calendar period">
          <IconChevronLeft size="var(--calendar-size-14)" />
        </ActionIcon>
        <UnstyledButton onClick={handleHeaderClick}>
          <Text
            size="xs"
            fw="var(--calendar-weight-heading)"
            style={{
              cursor: viewMode !== 'years' ? 'pointer' : 'default',
              transition: 'color 0.1s',
            }}
            c={viewMode !== 'years' ? 'blue' : undefined}
          >
            {getHeaderText()}
          </Text>
        </UnstyledButton>
        <ActionIcon variant="subtle" size="xs" onClick={goToNext} aria-label="Next calendar period">
          <IconChevronRight size="var(--calendar-size-14)" />
        </ActionIcon>
      </Group>

      {/* Days View */}
      {viewMode === 'days' && (
        <>
          {/* Day headers */}
          <SimpleGrid cols={7} spacing={0}>
            {DAYS.map((day, i) => (
              <Text
                key={i}
                size="xs"
                c="dimmed"
                ta="center"
                fw="var(--calendar-weight-medium)"
                py="var(--calendar-size-2)"
              >
                {day}
              </Text>
            ))}
          </SimpleGrid>

          {/* Calendar grid */}
          <SimpleGrid cols={7} spacing={0}>
            {calendarDays.map((item, i) => {
              const selected = item.isCurrentMonth && isSelected(item.day);
              const today = item.isCurrentMonth && isToday(item.day);

              return (
                <Text
                  component="button"
                  type="button"
                  disabled={!item.isCurrentMonth || !!isDateDisabled?.(new Date(year, month, item.day))}
                  aria-label={new Intl.DateTimeFormat('en-US', { dateStyle: 'full' }).format(new Date(year, month, 1 - firstDay + i))}
                  aria-pressed={selected}
                  aria-current={today ? 'date' : undefined}
                  className={`calendar-mini-day ${selected ? 'is-selected' : ''}`}
                  key={i}
                  size="xs"
                  ta="center"
                  py="var(--calendar-size-4)"
                  c={!item.isCurrentMonth ? 'gray.4' : selected ? 'white' : today ? 'blue' : 'dark'}
                  fw={today || selected ? 600 : 400}
                  style={{
                    border: 0,
                    borderRadius: selected ? 'var(--calendar-radius-sm)' : 0,
                    cursor: item.isCurrentMonth ? 'pointer' : 'default',
                    transition: 'background-color var(--calendar-duration-100)',
                  }}
                  onClick={() => handleDateClick(item.day, item.isCurrentMonth)}
                >
                  {item.day}
                </Text>
              );
            })}
          </SimpleGrid>
        </>
      )}

      {/* Months View */}
      {viewMode === 'months' && (
        <SimpleGrid cols={3} spacing={4}>
          {MONTHS_SHORT.map((monthName, i) => {
            const isCurrentMonth = selectedDate.getMonth() === i && selectedDate.getFullYear() === year;
            const isTodayMonth = new Date().getMonth() === i && new Date().getFullYear() === year;

            return (
              <UnstyledButton
                key={i}
                onClick={() => handleMonthClick(i)}
                py="var(--calendar-size-8)"
                px="var(--calendar-size-4)"
                style={{
                  borderRadius: 'var(--calendar-radius-sm)',
                  backgroundColor: isCurrentMonth ? 'var(--calendar-color-blue-6)' : 'transparent',
                  transition: 'background-color var(--calendar-duration-100)',
                }}
                onMouseEnter={(e) => {
                  if (!isCurrentMonth) {
                    e.currentTarget.style.backgroundColor = 'var(--calendar-color-gray-1)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isCurrentMonth) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }
                }}
              >
                <Text
                  size="xs"
                  ta="center"
                  fw={isCurrentMonth || isTodayMonth ? 600 : 400}
                  c={isCurrentMonth ? 'white' : isTodayMonth ? 'blue' : 'dark'}
                >
                  {monthName}
                </Text>
              </UnstyledButton>
            );
          })}
        </SimpleGrid>
      )}

      {/* Years View */}
      {viewMode === 'years' && (
        <SimpleGrid cols={3} spacing={4}>
          {Array.from({ length: 12 }, (_, i) => {
            const yearValue = decadeStart - 1 + i;
            const isCurrentYear = selectedDate.getFullYear() === yearValue;
            const isTodayYear = new Date().getFullYear() === yearValue;
            const isOutOfRange = i === 0 || i === 11;

            return (
              <UnstyledButton
                key={i}
                onClick={() => handleYearClick(yearValue)}
                py="var(--calendar-size-8)"
                px="var(--calendar-size-4)"
                style={{
                  borderRadius: 'var(--calendar-radius-sm)',
                  backgroundColor: isCurrentYear ? 'var(--calendar-color-blue-6)' : 'transparent',
                  transition: 'background-color var(--calendar-duration-100)',
                }}
                onMouseEnter={(e) => {
                  if (!isCurrentYear) {
                    e.currentTarget.style.backgroundColor = 'var(--calendar-color-gray-1)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isCurrentYear) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }
                }}
              >
                <Text
                  size="xs"
                  ta="center"
                  fw={isCurrentYear || isTodayYear ? 600 : 400}
                  c={isCurrentYear ? 'white' : isOutOfRange ? 'gray.4' : isTodayYear ? 'blue' : 'dark'}
                >
                  {yearValue}
                </Text>
              </UnstyledButton>
            );
          })}
        </SimpleGrid>
      )}
    </Stack>
  );
}
