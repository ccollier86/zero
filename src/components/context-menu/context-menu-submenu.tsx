'use client';

/** Nested context-menu disclosure; Radix owns hover intent, directional keys, and open state. */
import { ContextMenu as Primitive } from 'radix-ui';
import { ChevronRight } from '../animate-ui/icons/chevron-right';
import { cn } from '../../lib/utils';
import { contextMenuItemClass } from './context-menu-styles';
import { contextMenuItemChildren } from './context-menu-item-layout';
import type { ContextMenuSubProps, ContextMenuSubTriggerProps } from './context-menu.props';

/** Related actions in a submenu, optionally using controlled open state. */
export function ContextMenuSub(props: ContextMenuSubProps) {
  return <Primitive.Sub {...props} />;
}

/** Nested disclosure with leading icon, trailing metadata, and a direction-aware chevron. */
export function ContextMenuSubTrigger({
  className, inset, children, asChild, icon, endAdornment, ...props
}: ContextMenuSubTriggerProps) {
  return <Primitive.SubTrigger data-slot="context-menu-sub-trigger" data-inset={inset} asChild={asChild}
    className={cn(contextMenuItemClass, 'data-[state=open]:bg-accent data-[state=open]:text-accent-foreground', className)} {...props}>
    {contextMenuItemChildren({ asChild, children, icon, endAdornment, suffix:
      <ChevronRight key="chevron" data-slot="context-menu-sub-chevron" aria-hidden="true" className="ms-auto size-4 shrink-0 rtl:rotate-180" /> })}
  </Primitive.SubTrigger>;
}
