/**
 * secret-field.tsx
 *
 * Renders a display-only API key, token, or other browser-held secret with
 * masked presentation, reveal policy, and full-value clipboard copy. This
 * component owns presentation and interaction only; callers own authorization,
 * secret delivery, persistence, rotation, and revocation.
 *
 * Adapted from Mischief UI's Secret Field component:
 * https://github.com/Tinkerers-Labs/mischief-ui/blob/7e9f81c61a73d0b84c5d58d906f039b61e5d953a/registry/default/secret-field/secret-field.tsx
 *
 * MIT License
 *
 * Copyright (c) 2026 Tinkerers Labs
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

'use client';

import * as React from 'react';

import { CheckIcon } from '#zero/components/animate-ui/icons/check';
import { CopyIcon } from '#zero/components/animate-ui/icons/copy';
import { EyeIcon } from '#zero/components/animate-ui/icons/eye';
import { EyeOffIcon } from '#zero/components/animate-ui/icons/eye-off';
import { Button } from '#zero/components/ui/button';
import { cn } from '#zero/lib/utils';
import { emitFrontendCode } from '../../frontend/client/observability';
import { OBS_CODES } from '../../observability/codes';

import { ClipboardUnavailableError, copyTextToClipboard } from './clipboard';

export type SecretFieldProps = Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'children' | 'onCopy'
> & {
  /** The browser-held secret. Copy always uses this complete value. */
  value: string;
  /** Readable characters at the start while masked. Default: `0`. */
  visiblePrefix?: number;
  /** Readable characters at the end while masked. Default: `4`. */
  visibleSuffix?: number;
  /** Controlled masked state. Ignored as `false` when reveal is disabled. */
  masked?: boolean;
  /** Initial state for uncontrolled use. Default: `true`. */
  defaultMasked?: boolean;
  /** Called when a user requests a different masked state. */
  onMaskedChange?: (masked: boolean) => void;
  /** Whether the full value may be shown. Default: `true`. */
  revealable?: boolean;
  /** Whether to render the full-value copy action. Default: `true`. */
  copyable?: boolean;
  /** Called after the complete value was copied. No secret is exposed. */
  onCopied?: () => void;
  /** Called with a stable, secret-free error when clipboard copy fails. */
  onCopyError?: (error: Error) => void;
  /** Accessible name used by the state and controls. Default: `Secret`. */
  label?: string;
};

type CopyState = 'idle' | 'copied' | 'error';

const COPY_STATE_RESET_MS = 1600;
const MAX_MASK_GLYPHS = 24;
const CLIPBOARD_WRITE_FAILED_MESSAGE = 'Clipboard write failed.';

function normalizedCount(value: number, maximum: number): number {
  if (Number.isNaN(value) || value <= 0 || maximum <= 0) return 0;
  if (value === Number.POSITIVE_INFINITY) return maximum;
  return Math.min(Math.floor(value), maximum);
}

function maskedValue(
  value: string,
  visiblePrefix: number,
  visibleSuffix: number,
): string {
  const characters = Array.from(value);

  // A non-empty masked value always retains at least one masked character.
  // Prefix takes precedence, then suffix is clamped to the remaining space so
  // short values never duplicate or overlap their visible segments.
  const readableMaximum = Math.max(0, characters.length - 1);
  const prefixLength = normalizedCount(visiblePrefix, readableMaximum);
  const suffixLength = normalizedCount(
    visibleSuffix,
    readableMaximum - prefixLength,
  );
  const hiddenLength = characters.length - prefixLength - suffixLength;
  const prefix = characters.slice(0, prefixLength).join('');
  const suffix = suffixLength
    ? characters.slice(characters.length - suffixLength).join('')
    : '';

  return `${prefix}${'•'.repeat(Math.min(hiddenLength, MAX_MASK_GLYPHS))}${suffix}`;
}

function safeClipboardError(error: unknown): Error {
  if (error instanceof ClipboardUnavailableError) {
    return new ClipboardUnavailableError();
  }

  const safeError = new Error(CLIPBOARD_WRITE_FAILED_MESSAGE);
  safeError.name = 'ClipboardWriteError';
  return safeError;
}

function selectElementContents(element: HTMLElement): void {
  const document = element.ownerDocument;
  const selection = document.defaultView?.getSelection();
  if (!selection) return;

  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Render a display-only secret that is masked by default and copied in full.
 *
 * Masking is visual privacy, not an authorization boundary: the caller must
 * only provide values the current user is entitled to receive.
 */
export const SecretField = React.forwardRef<HTMLDivElement, SecretFieldProps>(
  function SecretField(
    {
      value,
      visiblePrefix = 0,
      visibleSuffix = 4,
      masked: controlledMasked,
      defaultMasked = true,
      onMaskedChange,
      revealable = true,
      copyable = true,
      onCopied,
      onCopyError,
      label = 'Secret',
      className,
      ...rootProps
    },
    ref,
  ) {
    const [uncontrolledState, setUncontrolledState] = React.useState(() => ({
      value,
      masked: defaultMasked,
    }));
    const [copyState, setCopyState] = React.useState<CopyState>('idle');
    const resetTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );
    const copyGenerationRef = React.useRef(0);
    const latestValueRef = React.useRef(value);

    latestValueRef.current = value;

    if (uncontrolledState.value !== value) {
      // Reset before React commits the replacement value. An effect would
      // allow one visible frame when the previous value had been revealed.
      setUncontrolledState({ value, masked: defaultMasked });
    }

    React.useEffect(
      () => () => {
        copyGenerationRef.current += 1;
        if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      },
      [],
    );

    React.useEffect(() => {
      // Copy completion belongs to the value that started it. Replacing the
      // value retires any in-flight attempt and any status-reset timer so a
      // result for key A cannot announce success or failure for key B.
      copyGenerationRef.current += 1;
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
      setCopyState('idle');
    }, [value]);

    const uncontrolledMasked =
      uncontrolledState.value === value
        ? uncontrolledState.masked
        : defaultMasked;
    const requestedMasked = controlledMasked ?? uncontrolledMasked;
    const isMasked = revealable === false ? true : requestedMasked;
    const hiddenValue = React.useMemo(
      () => maskedValue(value, visiblePrefix, visibleSuffix),
      [value, visiblePrefix, visibleSuffix],
    );

    function scheduleCopyStateReset() {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => {
        resetTimerRef.current = null;
        setCopyState('idle');
      }, COPY_STATE_RESET_MS);
    }

    function toggleMasked() {
      const next = !isMasked;
      if (controlledMasked === undefined) {
        setUncontrolledState({ value, masked: next });
      }
      onMaskedChange?.(next);
    }

    async function copyValue() {
      const generation = ++copyGenerationRef.current;
      const copiedValue = value;

      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
      setCopyState('idle');

      try {
        await copyTextToClipboard(copiedValue);
      } catch (error) {
        if (
          generation !== copyGenerationRef.current ||
          copiedValue !== latestValueRef.current
        ) {
          return;
        }

        const safeError = safeClipboardError(error);
        setCopyState('error');
        scheduleCopyStateReset();
        emitFrontendCode(OBS_CODES.FRONTEND_COPY_FAILED, {
          error: safeError,
          metadata: {
            component: 'SecretField',
            clipboardUnavailable:
              safeError instanceof ClipboardUnavailableError,
          },
        });
        onCopyError?.(safeError);
        return;
      }

      if (
        generation !== copyGenerationRef.current ||
        copiedValue !== latestValueRef.current
      ) {
        return;
      }

      setCopyState('copied');
      scheduleCopyStateReset();
      onCopied?.();
    }

    const copyLabel =
      copyState === 'copied'
        ? `${label} copied`
        : copyState === 'error'
          ? `Copy ${label} failed`
          : `Copy ${label}`;

    return (
      <div
        {...rootProps}
        ref={ref}
        data-slot="secret-field"
        data-masked={isMasked}
        data-copy-state={copyState}
        className={cn(
          'flex min-w-0 items-center gap-1 rounded-lg border border-border/80 bg-card px-2 py-1.5 text-card-foreground shadow-xs',
          className,
        )}
      >
        <code
          aria-hidden={isMasked || undefined}
          aria-label={isMasked ? undefined : `${label} value`}
          data-slot="secret-field-value"
          tabIndex={isMasked ? undefined : 0}
          className="min-w-0 flex-1 truncate rounded-sm px-1 font-mono text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          onFocus={(event) => selectElementContents(event.currentTarget)}
          onClick={(event) => selectElementContents(event.currentTarget)}
        >
          {isMasked ? hiddenValue : value}
        </code>
        <span data-slot="secret-field-visibility" className="sr-only">
          {label} {isMasked ? 'hidden' : 'showing'}.
        </span>

        {revealable ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-slot="secret-field-reveal"
            aria-label={isMasked ? `Show ${label}` : `Hide ${label}`}
            aria-pressed={!isMasked}
            className="shrink-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={toggleMasked}
          >
            {isMasked ? (
              <EyeIcon aria-hidden="true" className="size-4" />
            ) : (
              <EyeOffIcon aria-hidden="true" className="size-4" />
            )}
          </Button>
        ) : null}

        {copyable ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-slot="secret-field-copy"
            aria-label={copyLabel}
            className={cn(
              'shrink-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              copyState === 'copied' && 'text-success hover:text-success',
              copyState === 'error' && 'text-destructive hover:text-destructive',
            )}
            onClick={() => void copyValue()}
          >
            {copyState === 'copied' ? (
              <CheckIcon aria-hidden="true" animate className="size-4" />
            ) : (
              <CopyIcon aria-hidden="true" className="size-4" />
            )}
          </Button>
        ) : null}

        <span
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-slot="secret-field-copy-status"
          className="sr-only"
        >
          {copyState === 'copied'
            ? `${label} copied to clipboard.`
            : copyState === 'error'
              ? `${label} could not be copied.`
              : ''}
        </span>
      </div>
    );
  },
);

SecretField.displayName = 'SecretField';
