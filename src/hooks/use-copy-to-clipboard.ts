/**
 * use-copy-to-clipboard.ts
 *
 * Provides a browser clipboard helper for reusable frontend components. This
 * file owns clipboard interaction state only; it does not render copy buttons
 * or emit platform transport requests.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseCopyToClipboardOptions {
  /** Number of milliseconds before the copied state resets. Set 0 to persist. */
  timeoutMs?: number;
}

export interface UseCopyToClipboardReturn {
  /** True after the last successful copy until reset or timeout. */
  copied: boolean;
  /** Last value successfully copied. */
  value: string | null;
  /** Last clipboard failure, if any. */
  error: Error | null;
  /** Copy text to the clipboard and return whether it succeeded. */
  copy: (value: string) => Promise<boolean>;
  /** Clear copied value and error state. */
  reset: () => void;
}

function normalizeClipboardError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function writeClipboardText(value: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  if (typeof document === 'undefined') {
    throw new Error('Clipboard is not available in this environment.');
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';

  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, value.length);

  try {
    const copied = document.execCommand('copy');
    if (!copied) throw new Error('Clipboard copy command was rejected.');
  } finally {
    textarea.remove();
  }
}

/**
 * Manage clipboard copy lifecycle for buttons, menus, and code blocks.
 *
 * The hook prefers `navigator.clipboard` and falls back to a hidden textarea
 * copy path for older browsers. It returns false instead of throwing so UI code
 * can keep copy flows simple.
 */
export function useCopyToClipboard(
  options: UseCopyToClipboardOptions = {},
): UseCopyToClipboardReturn {
  const timeoutMs = options.timeoutMs ?? 2000;
  const timeoutRef = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const clearTimer = useCallback(() => {
    if (timeoutRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearTimer();
    setCopied(false);
    setValue(null);
    setError(null);
  }, [clearTimer]);

  const copy = useCallback(
    async (nextValue: string) => {
      clearTimer();

      try {
        await writeClipboardText(nextValue);
        setCopied(true);
        setValue(nextValue);
        setError(null);

        if (timeoutMs > 0 && typeof window !== 'undefined') {
          timeoutRef.current = window.setTimeout(() => {
            setCopied(false);
            timeoutRef.current = null;
          }, timeoutMs);
        }

        return true;
      } catch (clipboardError) {
        setCopied(false);
        setValue(null);
        setError(normalizeClipboardError(clipboardError));
        return false;
      }
    },
    [clearTimer, timeoutMs],
  );

  useEffect(() => clearTimer, [clearTimer]);

  return { copied, value, error, copy, reset };
}
