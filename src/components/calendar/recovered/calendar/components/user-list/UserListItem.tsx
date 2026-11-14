'use client';

import { Group, Text, UnstyledButton } from '../../../../components/calendar-ui';
import { IconCheck } from '../../../../components/calendar-icons';
import { UserAvatar } from './UserAvatar';
import type { CalendarUser } from '../../types/index';

export interface UserListItemProps {
  user: CalendarUser;
  isSelected: boolean;
  onToggle: (userId: string) => void;
  description?: string;
  selectionMode?: 'multiple' | 'single';
  tabStop?: boolean;
}

/**
 * One accessible calendar toggle, without nesting another interactive input.
 */
export function UserListItem({ user, isSelected, onToggle, description, selectionMode = 'multiple', tabStop }: UserListItemProps) {
  return (
    <UnstyledButton
      onClick={() => onToggle(user.id)}
      role={selectionMode === 'single' ? 'radio' : 'checkbox'}
      tabIndex={selectionMode === 'single' ? (tabStop ?? isSelected) ? 0 : -1 : 0}
      aria-checked={isSelected}
      aria-label={user.name}
      className="calendar-sidebar-row"
      data-list-item
      py="var(--calendar-size-6)"
      px="var(--calendar-size-8)"
      w="100%"
    >
      <Group gap="sm" wrap="nowrap">
        <UserAvatar user={user} isSelected={isSelected} size="sm" />
        <div style={{ flex: 1, minWidth: 0 }}><Text size="sm" fw={isSelected ? 500 : 400} truncate title={user.name}>
          {user.name}
        </Text>
        {description && <Text size="var(--calendar-size-10)" c="dimmed" truncate title={description}>{description}</Text>}</div>
        <span className={`calendar-sidebar-check ${selectionMode === 'single' ? 'is-radio' : ''}`} aria-hidden="true" style={isSelected ? { background: `var(--calendar-color-${user.color}-6)`, borderColor: `var(--calendar-color-${user.color}-6)` } : undefined}>
          {isSelected && <IconCheck size="var(--calendar-size-11)" stroke={3} />}
        </span>
      </Group>
    </UnstyledButton>
  );
}
