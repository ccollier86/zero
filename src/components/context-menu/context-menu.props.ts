/** Public composition contracts for Zero's tokenized Radix context-menu family. */
import type * as React from 'react';
import type { ContextMenu as Primitive } from 'radix-ui';

/** Pointer-triggered root; observe open changes without inventing controlled-root state. */
export type ContextMenuProps = React.ComponentProps<typeof Primitive.Root>;
/** Focusable context-menu target with Radix's asChild, disabled, and pointer handlers. */
export type ContextMenuTriggerProps = React.ComponentProps<typeof Primitive.Trigger>;
/** Explicit portal for composition; Content/SubContent use portal={false} inside it. */
export type ContextMenuPortalProps = React.ComponentProps<typeof Primitive.Portal>;
/** Automatically portal content, or opt out to own its portal; forceMount reaches both layers. */
export type ContextMenuContentProps = React.ComponentProps<typeof Primitive.Content> & {
  portal?: boolean;
  container?: ContextMenuPortalProps['container'];
};
/** Semantic group of related actions. */
export type ContextMenuGroupProps = React.ComponentProps<typeof Primitive.Group>;
/** Noninteractive section heading; inset aligns with items reserving an icon gutter. */
export type ContextMenuLabelProps = React.ComponentProps<typeof Primitive.Label> & { inset?: boolean };
/** Horizontal separator; className can use any Zero semantic color token. */
export type ContextMenuSeparatorProps = React.ComponentProps<typeof Primitive.Separator>;
/** Trailing display-only shortcut or metadata; it does not register a keyboard command. */
export type ContextMenuShortcutProps = React.ComponentProps<'span'>;
/** Optional primitive indicator for fully custom checkable-item composition. */
export type ContextMenuItemIndicatorProps = React.ComponentProps<typeof Primitive.ItemIndicator>;
/** Optional arrow, styled with the same popover surface token. */
export type ContextMenuArrowProps = React.ComponentProps<typeof Primitive.Arrow>;

/** Compact leading/trailing slots; children can also directly compose icons and metadata. */
export interface ContextMenuItemAdornments {
  icon?: React.ReactNode;
  endAdornment?: React.ReactNode;
  inset?: boolean;
}
/** Action item; destructive is a visual warning, not a confirmation or authorization policy. */
export type ContextMenuItemProps = React.ComponentProps<typeof Primitive.Item> & ContextMenuItemAdornments & {
  variant?: 'default' | 'destructive';
};
/** Checkable menu item with accessible indeterminate support and optional trailing check. */
export type ContextMenuCheckboxItemProps = React.ComponentProps<typeof Primitive.CheckboxItem> & ContextMenuItemAdornments & {
  indicatorPosition?: 'left' | 'right';
};
/** Controlled or uncontrolled exclusive-choice group owned by the application. */
export type ContextMenuRadioGroupProps = React.ComponentProps<typeof Primitive.RadioGroup>;
/** Exclusive-choice item with the same leading/trailing layout as ordinary actions. */
export type ContextMenuRadioItemProps = React.ComponentProps<typeof Primitive.RadioItem> & ContextMenuItemAdornments & {
  indicatorPosition?: 'left' | 'right';
};
/** Submenus support their genuine Radix open/defaultOpen/onOpenChange contract. */
export type ContextMenuSubProps = React.ComponentProps<typeof Primitive.Sub>;
/** Nested disclosure item with a direction-aware trailing chevron. */
export type ContextMenuSubTriggerProps = React.ComponentProps<typeof Primitive.SubTrigger> & ContextMenuItemAdornments;
/** Submenu content exposes the positioning/collision props supported by the installed primitive. */
export type ContextMenuSubContentProps = React.ComponentProps<typeof Primitive.SubContent> & {
  portal?: boolean;
  container?: ContextMenuPortalProps['container'];
};
