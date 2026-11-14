/** One keyboard-accessible, pointer-anchored menu for calendar slots and events. */
import { useEffect, useRef, useState } from 'react';
import { Badge, Group, Text } from './calendar-ui';
import { CalendarMenu as Menu } from './calendar-menu-surfaces';
import { IconArrowsMove, IconCalendarPlus, IconCircleCheck, IconCopy, IconEdit, IconEye, IconLock, IconRotateClockwise, IconX } from './calendar-icons';
import { formatDay, formatMinute } from '../models/calendar-model';
import type { CalendarResource, ContextTarget, EditorIntent, EventDraft, ScheduleEvent, SlotTarget } from '../types';
interface Props {
  context: ContextTarget;
  event?: ScheduleEvent;
  resources: readonly CalendarResource[];
  onDismiss(restore?: boolean): void;
  onCreate(slot: SlotTarget, kind: EventDraft['kind']): void;
  onInspect(event: ScheduleEvent): void;
  onEdit(event: ScheduleEvent, intent: Exclude<EditorIntent, 'create'>): void;
  onCancel(event: ScheduleEvent): void;
  onRestore(event: ScheduleEvent): void;
}
export function CalendarContextMenu({ context, event, resources, onDismiss, onCreate, onInspect, onEdit, onCancel, onRestore }: Props) {
  const dropdown = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState(true);
  const pending = useRef<(() => void) | null>(null), alive = useRef(true);
  const latest = useRef(onDismiss); latest.current = onDismiss;
  function close(action?: () => void, restore = false) { if (!pending.current) pending.current = action ?? (() => latest.current(restore)); setOpened(false); }
  function finish() { const action = pending.current; pending.current = null; if (alive.current) action?.(); }
  const slot = context.target.kind === 'slot' ? context.target.slot : undefined;
  const resource = resources.find(item => item.id === (event?.resourceId ?? slot?.resourceId));
  useEffect(() => {
    // The virtual positioning anchor is not the real trigger. Treat the actual
    // slot/card as inside, including keyboard-generated context-click events.
    const outside = (e: PointerEvent) => {
      const path = e.composedPath();
      if (!path.includes(context.trigger) && (!dropdown.current || !path.includes(dropdown.current))) close();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); e.stopPropagation(); close(undefined, true);
    };
    const focus = requestAnimationFrame(() => dropdown.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true }));
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    return () => { cancelAnimationFrame(focus); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true); };
  }, [context.key, context.trigger]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; pending.current = null; }; }, []);
  if (!slot && !event) return null;
  return <Menu opened={opened} onChange={open => { if (!open) close(); }} onExitComplete={finish} closeOnClickOutside={false} closeOnEscape={false} position="bottom-start" floatingStrategy="fixed" offset={6} width="var(--calendar-size-276)" shadow="lg" radius="lg" withinPortal trapFocus returnFocus={false} loop withInitialFocusPlaceholder={false}>
    <Menu.Target><span aria-hidden="true" style={{ position: 'fixed', left: Math.max(4, Math.min(context.x, window.innerWidth - 8)), top: Math.max(4, Math.min(context.y, window.innerHeight - 8)), width: 'var(--calendar-size-1)', height: 'var(--calendar-size-1)', pointerEvents: 'none' }} /></Menu.Target>
    <Menu.Dropdown ref={dropdown} className="calendar-menu" aria-label={slot ? 'Time slot actions' : 'Appointment actions'}>
      <div className="calendar-menu-heading">
        <Text size="sm" fw="var(--calendar-weight-heading)" lineClamp={2}>{event?.title ?? 'Schedule something'}</Text>
        <Text size="xs" c="dimmed">{formatDay(event?.date ?? slot!.date, true)} · {formatMinute(event?.start ?? slot!.minute)}{event ? ` – ${formatMinute(event.end)}` : ''}</Text>
        <Group gap="var(--calendar-size-6)" mt="var(--calendar-size-6)"><span className="calendar-resource-dot" style={{ background: `var(--calendar-color-${resource?.color ?? 'blue'}-6)` }} /><Text size="xs" c="dimmed" truncate>{resource?.name}</Text>{event && <Badge size="xs" variant="light" color={event.status === 'cancelled' ? 'gray' : event.status === 'tentative' ? 'orange' : 'blue'}>{event.status}</Badge>}</Group>
      </div>
      <Menu.Divider />
      {slot ? <>
        <Menu.Item className="calendar-menu-item" data-autofocus leftSection={<IconCalendarPlus size="var(--calendar-size-16)" />} onClick={() => close(() => onCreate(slot, 'appointment'))}>New appointment</Menu.Item>
        <Menu.Item className="calendar-menu-item" leftSection={<IconLock size="var(--calendar-size-16)" />} onClick={() => close(() => onCreate(slot, 'block'))}>Block time</Menu.Item>
      </> : event ? <>
        <Menu.Item className="calendar-menu-item" data-autofocus leftSection={<IconEye size="var(--calendar-size-16)" />} onClick={() => close(() => onInspect(event))}>View details</Menu.Item>
        <Menu.Item className="calendar-menu-item" leftSection={<IconEdit size="var(--calendar-size-16)" />} onClick={() => close(() => onEdit(event, 'edit'))}>{event.kind === 'block' ? 'Edit time block' : 'Edit appointment'}</Menu.Item>
        <Menu.Item className="calendar-menu-item" leftSection={<IconArrowsMove size="var(--calendar-size-16)" />} onClick={() => close(() => onEdit(event, 'reschedule'))}>Reschedule</Menu.Item>
        <Menu.Item className="calendar-menu-item" leftSection={<IconCopy size="var(--calendar-size-16)" />} onClick={() => close(() => onEdit(event, 'duplicate'))}>Duplicate…</Menu.Item>
        {event.kind === 'appointment' && event.status !== 'cancelled' && <Menu.Item className="calendar-menu-item" leftSection={<IconCircleCheck size="var(--calendar-size-16)" />} onClick={() => close(() => onEdit(event, 'status'))}>Change status…</Menu.Item>}
        <Menu.Divider />
        {event.status === 'cancelled'
          ? <Menu.Item className="calendar-menu-item" leftSection={<IconRotateClockwise size="var(--calendar-size-16)" />} onClick={() => close(() => onRestore(event))}>Restore {event.kind === 'block' ? 'time block' : 'appointment'}</Menu.Item>
          : <Menu.Item className="calendar-menu-item calendar-menu-danger" color="red" leftSection={<IconX size="var(--calendar-size-16)" />} onClick={() => close(() => onCancel(event))}>{event.kind === 'block' ? 'Remove time block…' : 'Cancel appointment…'}</Menu.Item>}
      </> : <Menu.Item disabled>Event is no longer available</Menu.Item>}
    </Menu.Dropdown>
  </Menu>;
}
