/** Small-screen calendar filters, owned by the existing Zero modal/drawer manager. */
import type { ReactNode } from 'react';
import { ControlledDrawer } from '@zero/framework/drawers';
import '../styles/calendar-overlays.css';
export function CalendarSidebarDrawer({ opened, onClose, trigger, children }: { opened: boolean; onClose(): void; trigger?: HTMLElement | null; children: ReactNode }) {
  return <ControlledDrawer open={opened} onOpenChange={open => { if (!open) onClose(); }} descriptor={{
    title: 'Calendars & locations', side: 'left', mode: 'modal', mobile: 'same', width: 'var(--calendar-size-280)',
    trigger, className: 'calendar-managed-dialog calendar-sidebar-drawer',
    body: () => <div className="calendar-sidebar-drawer-body">{children}</div>,
  }} />;
}
