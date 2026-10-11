'use client';

/**
 * Additive scroll presentation for the preserved ContextMenu engine. Radix and
 * the original mounted surface retain portal, focus, dismissal and 120ms motion;
 * this adapter supplies a standard viewport without rewriting opaque asChild hosts.
 */
import { cn } from '../../lib/utils';
import {
  ContextMenuContent as NativeContextMenuContent,
  ContextMenuSubContent as NativeContextMenuSubContent,
} from './context-menu-content';
import { ContextMenuViewport } from './context-menu-viewport';
import { protectContextMenuOwnedChild, useContextMenuFloatingSurface } from './context-menu-floating-surface';
import type { ContextMenuContentProps, ContextMenuSubContentProps } from './context-menu.props';
import './context-menu-scroll.css';

/** Arc scrolling in one inner viewport; refs and native lifecycle handlers still address the outer menu. */
export function ContextMenuContent({ scrollTreatment = 'arc', viewportRef, viewportClassName, viewportStyle,
  orientation = 'both', fadeEdges = true, scrollbars = 'hover', asChild, className, children,
  ref, container, style, inert,
  ...props }: ContextMenuContentProps) {
  const floating = useContextMenuFloatingSurface(scrollTreatment !== 'native', ref, style, inert);
  if (scrollTreatment === 'native') {
    return <NativeContextMenuContent {...props} ref={ref} container={container} style={style} inert={inert}
      asChild={asChild} className={className}>{children}</NativeContextMenuContent>;
  }
  const contentProps = { ...props, ...floating.contentProps, ref: floating.ref,
    container: container === undefined ? floating.container : container };
  if (asChild) {
    return <NativeContextMenuContent {...contentProps} asChild className={className}>
      {protectContextMenuOwnedChild(children, floating.owner)}
    </NativeContextMenuContent>;
  }
  return <NativeContextMenuContent {...contentProps} className={cn('zero-context-menu-scroll-surface p-0', className)}>
    <ContextMenuViewport ref={viewportRef} className={cn('p-1', viewportClassName)} style={viewportStyle}
      orientation={orientation} fadeEdges={fadeEdges} scrollbars={scrollbars}>{children}</ContextMenuViewport>
  </NativeContextMenuContent>;
}

/** A submenu owns its own viewport and remains under Radix's original submenu/Presence lifecycle. */
export function ContextMenuSubContent({ scrollTreatment = 'arc', viewportRef, viewportClassName, viewportStyle,
  orientation = 'both', fadeEdges = true, scrollbars = 'hover', asChild, className, children,
  ref, container, style, inert,
  ...props }: ContextMenuSubContentProps) {
  const floating = useContextMenuFloatingSurface(scrollTreatment !== 'native', ref, style, inert);
  if (scrollTreatment === 'native') {
    return <NativeContextMenuSubContent {...props} ref={ref} container={container} style={style} inert={inert}
      asChild={asChild} className={className}>{children}</NativeContextMenuSubContent>;
  }
  const contentProps = { ...props, ...floating.contentProps, ref: floating.ref,
    container: container === undefined ? floating.container : container };
  if (asChild) {
    return <NativeContextMenuSubContent {...contentProps} asChild className={className}>
      {protectContextMenuOwnedChild(children, floating.owner)}
    </NativeContextMenuSubContent>;
  }
  return <NativeContextMenuSubContent {...contentProps} className={cn('zero-context-menu-scroll-surface p-0', className)}>
    <ContextMenuViewport ref={viewportRef} className={cn('p-1', viewportClassName)} style={viewportStyle}
      orientation={orientation} fadeEdges={fadeEdges} scrollbars={scrollbars}>{children}</ContextMenuViewport>
  </NativeContextMenuSubContent>;
}
