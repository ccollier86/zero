/** Item adornment composition; asChild keeps the consumer's link/button as one semantic item. */
import * as React from 'react';
import type { ContextMenuItemAdornments } from './context-menu.props';

export function contextMenuItemChildren({
  asChild, children, icon, endAdornment, suffix,
}: ContextMenuItemAdornments & { asChild?: boolean; children?: React.ReactNode; suffix?: React.ReactNode }): React.ReactNode {
  const target = asChild ? React.Children.only(children) as React.ReactElement<{ children?: React.ReactNode }> : null;
  const contents = [
    icon === undefined || icon === null ? null : <span key="icon" data-slot="context-menu-icon" aria-hidden="true"
      className="flex size-4 shrink-0 items-center justify-center">{icon}</span>,
    target ? target.props.children : (typeof children === 'string' || typeof children === 'number')
      ? <span key="label" data-slot="context-menu-item-label" className="min-w-0 flex-1 truncate">{children}</span>
      : children,
    endAdornment === undefined || endAdornment === null ? null : <span key="end" data-slot="context-menu-end-adornment"
      className="ms-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground">{endAdornment}</span>,
    suffix,
  ];
  // Do not rely on Slottable's module-local symbol across Bun's ESM/CJS entrypoints.
  return target ? React.cloneElement(target, undefined, ...contents) : contents;
}
