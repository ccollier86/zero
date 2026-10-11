'use client';

/** Stationary native command tray; owns local roving focus/paint, consumes existing Tooltip and overlay scope, never persistence. */
import * as React from 'react';
import { motion } from 'motion/react';
import { Button } from '../../ui/button';
import { TooltipGroup, Tooltip, TooltipTrigger, TooltipContent } from '../../tooltip';
import { composeOverlayRefs, useOverlayScope } from '../../overlays/overlay-scope';
import { cn } from '../../../lib/utils';
import { enabledActionIds, recoverTabStop, resolveActiveActionId, resolveRovingTarget, validateFloatingButtonGroupItems } from './floating-button-group-model';
import { FloatingButtonGroupLabel } from './floating-button-group-label';
import { useFloatingButtonGroupHighlight } from './use-floating-button-group-highlight';
import type { FloatingButtonGroupAction, FloatingButtonGroupProps } from './floating-button-group.types';
import './floating-button-group.css';

const isAction = (item: FloatingButtonGroupProps['items'][number]): item is FloatingButtonGroupAction => item.type !== 'separator';

/** Additive action toolbar; disabled commands remain describable, but cannot receive roving focus, press paint or activation. */
export function FloatingButtonGroup({ items, label, variant = 'muted', size = 'md', orientation = 'horizontal',
  iconOnly = false, tooltipSide, onAction, dir, className, ref, inert, onKeyDown, onFocus, onBlur, ...native }: FloatingButtonGroupProps) {
  validateFloatingButtonGroupItems(items);
  if (!label.trim()) throw new TypeError('FloatingButtonGroup requires a nonempty accessible label.');
  const owner = useOverlayScope(), admitted = !inert && (!owner || owner.active);
  const [root, setRoot] = React.useState<HTMLDivElement | null>(null);
  const rootRef = React.useMemo(() => composeOverlayRefs<HTMLDivElement>(setRoot, ref), [ref]);
  const nodes = React.useRef(new Map<string, HTMLButtonElement>());
  const [nodeVersion, updateNodes] = React.useReducer((version: number) => version + 1, 0);
  const register = React.useCallback((id: string, node: HTMLButtonElement | null) => {
    if (nodes.current.get(id) === node) return;
    if (node) nodes.current.set(id, node); else nodes.current.delete(id);
    updateNodes();
  }, []);
  const [hoveredId, setHovered] = React.useState<string | null>(null), [focusedId, setFocused] = React.useState<string | null>(null);
  const [interaction, setInteraction] = React.useState<'pointer' | 'keyboard'>('pointer');
  const [pressing, setPressing] = React.useState(false), [tabStop, setTabStop] = React.useState<string | null>(null);
  const previousItems = React.useRef(items), focusNode = React.useRef<HTMLButtonElement | null>(null);
  const ownsFocus = React.useRef(false), pointer = React.useRef<{ id: number; type: string } | null>(null);
  const nextStop = recoverTabStop(previousItems.current, items, tabStop);
  const activeId = admitted ? resolveActiveActionId(items, { hoveredId, focusedId, interaction }) : null;
  const paint = useFloatingButtonGroupHighlight(root, nodes.current, nodeVersion, activeId, pressing && admitted);
  const side = tooltipSide ?? (orientation === 'vertical' ? 'right' : 'top');
  const endPress = React.useCallback(() => {
    if (pointer.current && pointer.current.type !== 'mouse') setHovered(null);
    pointer.current = null; setPressing(false);
  }, []);

  React.useLayoutEffect(() => {
    if (tabStop !== nextStop) setTabStop(nextStop);
    const priorFocus = focusNode.current;
    if (root && admitted && ownsFocus.current && ((priorFocus && (!priorFocus.isConnected || priorFocus.getAttribute('aria-disabled') === 'true'))
      || (!priorFocus && tabStop === null && nextStop !== null))) {
      const next = nextStop ? nodes.current.get(nextStop) : root;
      next?.focus({ preventScroll: true }); focusNode.current = next?.tagName === 'BUTTON' ? next as HTMLButtonElement : null;
      setFocused(nextStop); setInteraction('keyboard');
    }
    previousItems.current = items;
    if (!admitted) { setHovered(null); setFocused(null); endPress(); }
  }, [items, admitted, nextStop, tabStop, root, endPress]);

  React.useEffect(() => {
    const view = root?.ownerDocument.defaultView;
    if (!root || !view) return;
    const leave = () => { setHovered(null); endPress(); };
    const visibility = () => { if (root.ownerDocument.hidden) leave(); };
    root.addEventListener('pointerleave', leave);
    root.ownerDocument.addEventListener('pointerup', endPress, true);
    root.ownerDocument.addEventListener('pointercancel', endPress, true);
    view.addEventListener('blur', leave); root.ownerDocument.addEventListener('visibilitychange', visibility);
    return () => { root.removeEventListener('pointerleave', leave); root.ownerDocument.removeEventListener('pointerup', endPress, true);
      root.ownerDocument.removeEventListener('pointercancel', endPress, true); view.removeEventListener('blur', leave);
      root.ownerDocument.removeEventListener('visibilitychange', visibility); pointer.current = null; };
  }, [root, endPress]);

  const state = { admitted, activeId, nextStop, iconOnly, side, register, onAction, paint: paint.feedback,
    setHovered, setFocused, setInteraction, setPressing, setTabStop, focusNode, ownsFocus, pointer, endPress };
  return <TooltipGroup><div {...native} ref={rootRef} className={cn('zero-floating-button-group', className)}
    data-slot="floating-button-group" data-variant={variant} data-size={size} data-orientation={orientation}
    role="toolbar" aria-label={label} aria-orientation={orientation} dir={dir} inert={!admitted || undefined}
    tabIndex={nextStop ? -1 : admitted ? 0 : -1}
    onFocus={event => { onFocus?.(event); if (event.target === event.currentTarget) { ownsFocus.current = true; focusNode.current = null; } }}
    onBlur={event => { onBlur?.(event); if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      ownsFocus.current = false; focusNode.current = null; setFocused(null); endPress();
    } }}
    onKeyDown={event => {
      onKeyDown?.(event); if (event.defaultPrevented || !admitted) return;
      const currentId = [...nodes.current].find(([, node]) => node === event.currentTarget.ownerDocument.activeElement)?.[0];
      const direction = dir ?? event.currentTarget.ownerDocument.defaultView!.getComputedStyle(event.currentTarget).direction as 'ltr' | 'rtl';
      const next = resolveRovingTarget(enabledActionIds(items), currentId ?? null, event.key, orientation, direction);
      if (next) { event.preventDefault(); setHovered(null); setInteraction('keyboard'); nodes.current.get(next)?.focus({ preventScroll: true }); }
    }}>
    <motion.span aria-hidden="true" data-slot="floating-button-group-highlight" className="zero-floating-button-group-highlight"
      data-pressing={pressing && admitted ? '' : undefined} style={paint.style} />
    {items.map((item, index) => isAction(item) ? <FloatingAction key={`action:${item.id}`} item={item} state={state} />
      : <span key={`separator:${item.id ?? index}`} className="zero-floating-button-group-separator" role="separator"
        aria-orientation={orientation === 'horizontal' ? 'vertical' : 'horizontal'} />)}
  </div></TooltipGroup>;
}

type ActionState = {
  admitted: boolean; activeId: string | null; nextStop: string | null; iconOnly: boolean; side: 'top' | 'bottom' | 'left' | 'right';
  register: (id: string, node: HTMLButtonElement | null) => void; onAction?: (id: string) => void;
  paint: ReturnType<typeof useFloatingButtonGroupHighlight>['feedback'];
  setHovered: React.Dispatch<React.SetStateAction<string | null>>; setFocused: React.Dispatch<React.SetStateAction<string | null>>;
  setInteraction: React.Dispatch<React.SetStateAction<'pointer' | 'keyboard'>>; setPressing: React.Dispatch<React.SetStateAction<boolean>>;
  setTabStop: React.Dispatch<React.SetStateAction<string | null>>; focusNode: React.RefObject<HTMLButtonElement | null>;
  ownsFocus: React.RefObject<boolean>; pointer: React.RefObject<{ id: number; type: string } | null>; endPress: () => void;
};
function FloatingAction({ item, state }: { item: FloatingButtonGroupAction; state: ActionState }) {
  const ref = React.useMemo(() => composeOverlayRefs<HTMLButtonElement>(node => state.register(item.id, node), item.ref),
    [item.id, item.ref, state.register]);
  const hasIcon = React.Children.toArray(item.icon).some(node => node !== '');
  const iconOnly = hasIcon && (item.iconOnly ?? state.iconOnly);
  const disabled = !!item.disabled || !state.admitted;
  const button = <Button ref={ref} type="button" variant="ghost" size="sm" animateIcon={false}
    className="zero-floating-button-group-action" data-slot="floating-button-group-action" data-zero-floating-action={item.id}
    data-active={state.activeId === item.id || undefined} data-icon-only={iconOnly || undefined}
    data-has-icon={hasIcon || undefined} aria-label={item.label} aria-pressed={item.pressed}
    aria-disabled={disabled || undefined} tabIndex={!disabled && state.nextStop === item.id ? 0 : -1}
    onPointerMove={event => { if (!disabled && (event.pointerType === 'mouse' || event.pointerType === 'pen')) {
      state.setHovered(item.id); state.setInteraction('pointer');
    } }}
    onPointerDown={event => { if (disabled || event.button !== 0) return;
      state.pointer.current = { id: event.pointerId, type: event.pointerType }; state.setHovered(item.id);
      state.setInteraction('pointer'); state.setPressing(true);
    }}
    onPointerUp={state.endPress} onPointerCancel={state.endPress} onLostPointerCapture={state.endPress}
    onKeyDown={event => { if (!disabled && (event.key === 'Enter' || event.key === ' ') && !event.repeat) state.setPressing(true); }}
    onKeyUp={event => { if (event.key === 'Enter' || event.key === ' ') state.endPress(); }}
    onFocus={event => {
      state.ownsFocus.current = true; state.focusNode.current = event.currentTarget;
      if (disabled) return;
      state.setTabStop(item.id);
      if (event.currentTarget.matches(':focus-visible')) { state.setFocused(item.id); state.setInteraction('keyboard'); state.setHovered(null); }
      else state.setFocused(null);
    }}
    onClick={() => { if (disabled) return; item.onSelect?.(); state.onAction?.(item.id); }}>
    <FloatingButtonGroupLabel label={item.label} icon={hasIcon ? item.icon : undefined} iconOnly={iconOnly} reserveLabels={item.reserveLabels} feedback={state.paint} />
  </Button>;
  return iconOnly || item.shortcut ? <Tooltip><TooltipTrigger asChild>{button}</TooltipTrigger>
    <TooltipContent side={state.side} title={item.label} shortcut={item.shortcut} /></Tooltip> : button;
}
