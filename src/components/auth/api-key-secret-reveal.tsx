'use client';

import * as React from 'react';
import type { IssuedAuthApiKey } from '../../frontend/client/auth-api-key-types';
import { Button } from '#zero/components/ui/button';
import { Input } from '#zero/components/ui/input';
import { writeAuthClipboardText } from './auth-clipboard';

export type ApiKeySecretAction =
  | { type: 'show'; issued: IssuedAuthApiKey }
  | { type: 'dismiss' };

/** @internal The dismiss transition removes the only retained raw secret. */
export function apiKeySecretReducer(
  _current: IssuedAuthApiKey | null,
  action: ApiKeySecretAction,
): IssuedAuthApiKey | null {
  return action.type === 'show' ? action.issued : null;
}

export function ApiKeySecretReveal({
  issued,
  onDismiss,
}: {
  issued: IssuedAuthApiKey;
  onDismiss(): void;
}) {
  const [copyState, setCopyState] = React.useState<'idle' | 'copied'>('idle');
  const [copyError, setCopyError] = React.useState<string | null>(null);
  const headingId = React.useId();
  const descriptionId = React.useId();
  const secretInputRef = React.useRef<HTMLInputElement | null>(null);
  const copyButtonRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    setCopyState('idle');
    setCopyError(null);
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      copyButtonRef.current?.focus();
      return;
    }
    const frame = window.requestAnimationFrame(() => copyButtonRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [issued.secret]);

  async function copySecret() {
    setCopyError(null);
    try {
      await writeAuthClipboardText(issued.secret);
      setCopyState('copied');
    } catch (cause) {
      setCopyState('idle');
      setCopyError(cause instanceof Error ? cause.message : 'Failed to copy API key');
      secretInputRef.current?.focus();
      secretInputRef.current?.select();
    }
  }

  return (
    <section
      className="rounded-md border border-warning/40 bg-warning/10 p-4 text-warning-foreground dark:border-warning/50 dark:bg-warning/15 dark:text-warning"
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
    >
      <h3 id={headingId} className="text-sm font-semibold">
        Copy this API key now
      </h3>
      <p id={descriptionId} className="mt-1 text-sm">
        This secret is shown once and cannot be recovered. Store it securely before
        dismissing this notice.
      </p>
      <Input
        ref={secretInputRef}
        className="mt-3 font-mono text-xs"
        aria-label="One-time API key secret"
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect="off"
        readOnly
        spellCheck={false}
        value={issued.secret}
        onFocus={(event) => event.currentTarget.select()}
      />
      <p className="mt-2 text-xs">
        Key: {issued.apiKey.label} · ending in {issued.apiKey.hint}
      </p>
      {copyError && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {copyError} Use the one-time secret field above to copy it manually.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          ref={copyButtonRef}
          type="button"
          size="sm"
          onClick={() => void copySecret()}
        >
          {copyState === 'copied' ? 'Copied' : 'Copy now'}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onDismiss}>
          Dismiss and clear from page
        </Button>
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {copyState === 'copied'
          ? 'API key copied to the clipboard.'
          : 'A new one-time API key secret is ready to copy.'}
      </p>
    </section>
  );
}
