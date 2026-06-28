/**
 * use-disclosure.ts
 *
 * Provides controlled/uncontrolled boolean state for dialogs, drawers,
 * popovers, and expandable regions. This file owns UI state only.
 */

import { useCallback, useMemo, useState } from 'react';

export interface UseDisclosureOptions {
  /** Controlled open state. */
  open?: boolean;
  /** Initial open state for uncontrolled usage. */
  defaultOpen?: boolean;
  /** Called whenever `setOpen`, `open`, `close`, or `toggle` requests a change. */
  onOpenChange?: (open: boolean) => void;
}

export interface UseDisclosureReturn {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

/**
 * Manage open/closed UI state with either controlled or uncontrolled props.
 *
 * Returns stable action helpers suitable for wiring directly into buttons,
 * modal callbacks, and menu events.
 */
export function useDisclosure(options: UseDisclosureOptions = {}): UseDisclosureReturn {
  const { open, defaultOpen = false, onOpenChange } = options;
  const isControlled = open !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isOpen = isControlled ? open : uncontrolledOpen;

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) setUncontrolledOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [isControlled, onOpenChange],
  );

  const openDisclosure = useCallback(() => setOpen(true), [setOpen]);
  const close = useCallback(() => setOpen(false), [setOpen]);
  const toggle = useCallback(() => setOpen(!isOpen), [isOpen, setOpen]);

  return useMemo(
    () => ({
      isOpen,
      setOpen,
      open: openDisclosure,
      close,
      toggle,
    }),
    [isOpen, setOpen, openDisclosure, close, toggle],
  );
}
