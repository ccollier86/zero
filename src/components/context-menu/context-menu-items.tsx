'use client';

/** Tokenized menu rows and semantic choices; Radix owns selection, typeahead, and keyboard behavior. */
import { ContextMenu as Primitive } from 'radix-ui';
import { Circle, Minus } from 'lucide-react';
import { Check } from '../animate-ui/icons/check';
import { cn } from '../../lib/utils';
import { contextMenuItemClass } from './context-menu-styles';
import { contextMenuItemChildren } from './context-menu-item-layout';
import type {
  ContextMenuItemProps, ContextMenuCheckboxItemProps, ContextMenuRadioItemProps,
  ContextMenuRadioGroupProps, ContextMenuItemIndicatorProps, ContextMenuGroupProps,
  ContextMenuLabelProps, ContextMenuSeparatorProps, ContextMenuShortcutProps,
} from './context-menu.props';

/** Action with optional leading icon, trailing count/shortcut, and token-based destructive appearance. */
export function ContextMenuItem({
  className, inset, variant = 'default', icon, endAdornment, asChild, children, ...props
}: ContextMenuItemProps) {
  return <Primitive.Item data-slot="context-menu-item" data-inset={inset} data-variant={variant} asChild={asChild}
    className={cn(contextMenuItemClass,
      variant === 'destructive' && 'text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive [&_svg]:!text-destructive',
      className)} {...props}>
    {contextMenuItemChildren({ asChild, children, icon, endAdornment })}
  </Primitive.Item>;
}

/** Checkbox choice; the optional right indicator leaves the leading icon and label together. */
export function ContextMenuCheckboxItem({
  className, children, icon, endAdornment, asChild, checked, inset,
  indicatorPosition = 'left', ...props
}: ContextMenuCheckboxItemProps) {
  return <Primitive.CheckboxItem data-slot="context-menu-checkbox-item" data-indicator-position={indicatorPosition}
    data-inset={inset} checked={checked} asChild={asChild}
    className={cn(contextMenuItemClass, indicatorPosition === 'left' ? 'ps-8' : 'pe-8', className)} {...props}>
    {contextMenuItemChildren({ asChild, children, icon, endAdornment, suffix: <span key="indicator" aria-hidden="true" className={cn('pointer-events-none absolute flex size-4 items-center justify-center',
      indicatorPosition === 'left' ? 'start-2' : 'end-2')}>
      <Primitive.ItemIndicator data-slot="context-menu-item-indicator">
        {checked === 'indeterminate' ? <Minus className="size-4 text-current" /> : <Check className="size-4 text-current" />}
      </Primitive.ItemIndicator>
    </span> })}
  </Primitive.CheckboxItem>;
}

/** Exclusive choice group; its value and change handler remain owned by the application. */
export function ContextMenuRadioGroup(props: ContextMenuRadioGroupProps) {
  return <Primitive.RadioGroup data-slot="context-menu-radio-group" {...props} />;
}

/** Exclusive choice with a leading or trailing active-state indicator. */
export function ContextMenuRadioItem({
  className, children, icon, endAdornment, asChild, inset,
  indicatorPosition = 'left', ...props
}: ContextMenuRadioItemProps) {
  return <Primitive.RadioItem data-slot="context-menu-radio-item" data-indicator-position={indicatorPosition}
    data-inset={inset} asChild={asChild}
    className={cn(contextMenuItemClass, indicatorPosition === 'left' ? 'ps-8' : 'pe-8', className)} {...props}>
    {contextMenuItemChildren({ asChild, children, icon, endAdornment, suffix: <span key="indicator" aria-hidden="true" className={cn('pointer-events-none absolute flex size-4 items-center justify-center',
      indicatorPosition === 'left' ? 'start-2' : 'end-2')}>
      <Primitive.ItemIndicator data-slot="context-menu-item-indicator"><Circle className="size-2 fill-current text-current" /></Primitive.ItemIndicator>
    </span> })}
  </Primitive.RadioItem>;
}

/** Custom indicator for consumers composing their own checkable row content. */
export function ContextMenuItemIndicator(props: ContextMenuItemIndicatorProps) {
  return <Primitive.ItemIndicator data-slot="context-menu-item-indicator" {...props} />;
}

/** Semantic grouping for related menu actions. */
export function ContextMenuGroup(props: ContextMenuGroupProps) {
  return <Primitive.Group data-slot="context-menu-group" {...props} />;
}

/** Noninteractive section title; inset aligns it with an icon or checkbox gutter. */
export function ContextMenuLabel({ className, inset, ...props }: ContextMenuLabelProps) {
  return <Primitive.Label data-slot="context-menu-label" data-inset={inset}
    className={cn('px-2 py-1.5 text-xs font-semibold text-muted-foreground data-[inset=true]:ps-8', className)} {...props} />;
}

/** Subtle token-colored divider between action groups. */
export function ContextMenuSeparator({ className, ...props }: ContextMenuSeparatorProps) {
  return <Primitive.Separator data-slot="context-menu-separator" className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}

/** Right-aligned shortcut/metadata presentation; callers register any real command themselves. */
export function ContextMenuShortcut({ className, ...props }: ContextMenuShortcutProps) {
  return <span data-slot="context-menu-shortcut" className={cn('ms-auto shrink-0 text-xs tracking-wide text-muted-foreground', className)} {...props} />;
}
