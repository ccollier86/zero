/** Dropdown, context, Popover and Collapsible facades. Curated client-safe re-exports only; implementation/context ownership stays with the existing modules. */

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '../../../components/dropdown-menu';

export {
  ContextMenu, ContextMenuTrigger, ContextMenuPortal, ContextMenuContent,
  ContextMenuGroup, ContextMenuItem, ContextMenuCheckboxItem,
  ContextMenuRadioGroup, ContextMenuRadioItem, ContextMenuItemIndicator,
  ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut,
  ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent, ContextMenuArrow,
} from '../../../components/context-menu';
export type {
  ContextMenuProps, ContextMenuTriggerProps, ContextMenuPortalProps,
  ContextMenuContentProps, ContextMenuGroupProps, ContextMenuItemProps,
  ContextMenuCheckboxItemProps, ContextMenuRadioGroupProps, ContextMenuRadioItemProps,
  ContextMenuItemIndicatorProps, ContextMenuLabelProps, ContextMenuSeparatorProps,
  ContextMenuShortcutProps, ContextMenuSubProps, ContextMenuSubTriggerProps,
  ContextMenuSubContentProps, ContextMenuArrowProps, ContextMenuItemAdornments,
} from '../../../components/context-menu';
export {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  useCollapsible,
} from '../../../components/collapsible';
export type {
  DropdownMenuProps,
  DropdownMenuTriggerProps,
  DropdownMenuContentProps,
  DropdownMenuGroupProps,
  DropdownMenuItemProps,
  DropdownMenuCheckboxItemProps,
  DropdownMenuRadioGroupProps,
  DropdownMenuRadioItemProps,
  DropdownMenuLabelProps,
  DropdownMenuSeparatorProps,
  DropdownMenuShortcutProps,
  DropdownMenuSubProps,
  DropdownMenuSubTriggerProps,
  DropdownMenuSubContentProps,
} from '../../../components/dropdown-menu';
export {
  Popover,
  PopoverAnchor,
  PopoverClose,
  PopoverContent,
  PopoverViewport,
  PopoverTrigger,
} from '../../../components/popover';
export type {
  PopoverCloseProps,
  PopoverContentProps,
  PopoverViewportProps,
  PopoverProps,
  PopoverAnchorProps,
  PopoverTriggerProps,
} from '../../../components/popover';
export type {
  CollapsibleProps,
  CollapsibleTriggerProps,
  CollapsibleContentProps,
  CollapsibleContextType,
} from '../../../components/collapsible';
export { CommandPalette, CommandPaletteTrigger, filterCommandPaletteItems, CommandPaletteProvider, useCommandPalette } from '../../../components/command-palette';
export type { CommandPaletteProviderProps, CommandPaletteController } from '../../../components/command-palette';
export type { CommandPaletteProps, CommandPaletteItem, CommandPaletteGroup } from '../../../components/command-palette';
