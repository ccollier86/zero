'use client';

/** Root/trigger composition over Radix; keyboard opening shares the actual contextmenu path. */
import * as React from 'react';
import { ContextMenu as Primitive } from 'radix-ui';
import type { ContextMenuProps, ContextMenuTriggerProps, ContextMenuPortalProps } from './context-menu.props';

/** Context menu at the pointer, with Radix-managed focus, dismissal, long press, and direction. */
export function ContextMenu(props: ContextMenuProps) {
  return <Primitive.Root {...props} />;
}

/** Open on context click, long press, Shift+F10, or the ContextMenu key; respect prevented events. */
export function ContextMenuTrigger({
  disabled = false,
  tabIndex = disabled ? undefined : 0,
  onKeyDown,
  ...props
}: ContextMenuTriggerProps) {
  return <Primitive.Trigger data-slot="context-menu-trigger" disabled={disabled} tabIndex={tabIndex}
    {...props} onKeyDown={(event) => {
      onKeyDown?.(event);
      if (event.defaultPrevented || disabled || event.repeat) return;
      if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      const target = event.target instanceof HTMLElement ? event.target : event.currentTarget;
      const bounds = target.getBoundingClientRect();
      const WindowMouseEvent = target.ownerDocument.defaultView?.MouseEvent;
      if (!WindowMouseEvent) return;
      target.dispatchEvent(new WindowMouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: bounds.left + Math.min(12, bounds.width / 2),
        clientY: bounds.top + Math.min(12, bounds.height / 2),
        button: 2,
      }));
    }} />;
}

/** Explicit Radix portal; disable the nested content's automatic portal when composing this. */
export function ContextMenuPortal(props: ContextMenuPortalProps) {
  return <Primitive.Portal {...props} />;
}
