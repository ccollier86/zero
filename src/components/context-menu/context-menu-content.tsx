'use client';

/** Bounded, collision-aware context-menu surfaces using Radix's native portal/focus lifecycle. */
import { ContextMenu as Primitive } from 'radix-ui';
import { cn } from '../../lib/utils';
import { contextMenuSurfaceClass } from './context-menu-styles';
import { ContextMenuSurface } from './context-menu-surface';
import type { ContextMenuContentProps, ContextMenuSubContentProps, ContextMenuArrowProps } from './context-menu.props';

/** Automatically portaled pointer-anchored surface; onCloseAutoFocus permits deliberate dialog handoff. */
export function ContextMenuContent({
  className,
  portal = true,
  container,
  forceMount,
  asChild,
  children,
  collisionPadding = 8,
  ...props
}: ContextMenuContentProps) {
  const content = <Primitive.Content data-slot="context-menu-content" asChild
    collisionPadding={collisionPadding} forceMount={forceMount}
    className={cn(contextMenuSurfaceClass, className)} {...props}>
    {/* Animate the mounted DOM child, not the outer Presence-controlled Radix component. */}
    <ContextMenuSurface asChild={asChild}>{children}</ContextMenuSurface>
  </Primitive.Content>;
  return portal ? <Primitive.Portal container={container} forceMount={forceMount}>{content}</Primitive.Portal> : content;
}

/** Nested surface follows Radix's direction-aware submenu anchor and genuine placement props. */
export function ContextMenuSubContent({
  className,
  portal = true,
  container,
  forceMount,
  asChild,
  children,
  collisionPadding = 8,
  sideOffset = 4,
  ...props
}: ContextMenuSubContentProps) {
  const content = <Primitive.SubContent data-slot="context-menu-sub-content" forceMount={forceMount} asChild
    collisionPadding={collisionPadding} sideOffset={sideOffset}
    className={cn(contextMenuSurfaceClass, className)} {...props}>
    <ContextMenuSurface asChild={asChild}>{children}</ContextMenuSurface>
  </Primitive.SubContent>;
  return portal ? <Primitive.Portal container={container} forceMount={forceMount}>{content}</Primitive.Portal> : content;
}

/** Optional visual connection from menu to anchor, using the popover fill token. */
export function ContextMenuArrow({ className, ...props }: ContextMenuArrowProps) {
  return <Primitive.Arrow data-slot="context-menu-arrow" className={cn('fill-popover', className)} {...props} />;
}
