/**
 * use-hotkey.ts
 *
 * Provides browser keyboard shortcut registration for React UI. This file owns
 * keyboard event subscription only; commands are supplied by callers.
 */

import { useEffect, useRef } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────

export type HotkeyHandler = (e: KeyboardEvent) => void;

export interface HotkeyOptions {
  /** Only fire when this element (or its children) has focus. Default: global. */
  scope?: React.RefObject<HTMLElement | null>;
  /** Prevent default browser behavior. Default: true. */
  preventDefault?: boolean;
  /** Whether the hotkey is active. Default: true. */
  enabled?: boolean;
}

// ─── Key parsing ────────────────────────────────────────────────────────────

interface ParsedHotkey {
  mod: boolean;   // Cmd on Mac, Ctrl otherwise
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;    // lowercase
}

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

function parseHotkey(combo: string): ParsedHotkey {
  const parts = combo.toLowerCase().split('+').map((p) => p.trim());
  return {
    mod: parts.includes('mod'),
    ctrl: parts.includes('ctrl'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt') || parts.includes('option'),
    key: parts.filter((p) => !['mod', 'ctrl', 'shift', 'alt', 'option'].includes(p))[0] ?? '',
  };
}

function matchesHotkey(e: KeyboardEvent, parsed: ParsedHotkey): boolean {
  const modKey = isMac ? e.metaKey : e.ctrlKey;

  if (parsed.mod && !modKey) return false;
  if (parsed.ctrl && !e.ctrlKey) return false;
  if (parsed.shift && !e.shiftKey) return false;
  if (parsed.alt && !e.altKey) return false;

  return e.key.toLowerCase() === parsed.key;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Register a keyboard shortcut. Automatically handles Mac/Windows mod key.
 *
 * ```ts
 * useHotkey('mod+k', () => openCommandPalette());
 * useHotkey('mod+n', () => createRecord(), { scope: containerRef });
 * useHotkey('escape', () => clearSelection());
 * ```
 *
 * Key format: `mod+k`, `ctrl+shift+s`, `alt+n`, `escape`
 * - `mod` = Cmd on Mac, Ctrl on Windows/Linux
 */
export function useHotkey(
  combo: string,
  handler: HotkeyHandler,
  options: HotkeyOptions = {},
): void {
  const { scope, preventDefault = true, enabled = true } = options;
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const parsedRef = useRef<ParsedHotkey>(parseHotkey(combo));
  // Re-parse only if combo string changes
  useEffect(() => {
    parsedRef.current = parseHotkey(combo);
  }, [combo]);

  useEffect(() => {
    if (!enabled) return;

    const listener = (e: KeyboardEvent) => {
      // Skip if focused in an input/textarea (unless explicitly scoped)
      if (!scope) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
          // Still allow escape and mod-combos in inputs
          if (e.key !== 'Escape' && !parsedRef.current.mod) return;
        }
      }

      if (matchesHotkey(e, parsedRef.current)) {
        if (preventDefault) e.preventDefault();
        handlerRef.current(e);
      }
    };

    const target = scope?.current ?? document;
    target.addEventListener('keydown', listener as EventListener);
    return () => target.removeEventListener('keydown', listener as EventListener);
  }, [scope, preventDefault, enabled]);
}
