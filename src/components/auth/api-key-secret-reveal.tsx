'use client';

import * as React from 'react';
import type { IssuedAuthApiKey } from '../../frontend/client/auth-api-key-types';
import { SecretField } from '#zero/components/secret-field';
import { Button } from '#zero/components/ui/button';

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
  const [copyError, setCopyError] = React.useState<string | null>(null);
  const [masked, setMasked] = React.useState(true);
  const [manualCopyRequest, requestManualCopy] = React.useReducer(
    (request: number) => request + 1,
    0,
  );
  const headingId = React.useId();
  const descriptionId = React.useId();
  const secretFieldRef = React.useRef<HTMLDivElement | null>(null);
  const manualCopySecretRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    manualCopySecretRef.current = null;
    setCopyError(null);
    setMasked(true);
    const focusCopyButton = () => {
      secretFieldRef.current
        ?.querySelector<HTMLButtonElement>('[data-slot="secret-field-copy"]')
        ?.focus();
    };
    if (
      typeof window === 'undefined' ||
      typeof window.requestAnimationFrame !== 'function'
    ) {
      focusCopyButton();
      return;
    }
    const frame = window.requestAnimationFrame(focusCopyButton);
    return () => window.cancelAnimationFrame(frame);
  }, [issued.secret]);

  React.useEffect(() => {
    if (
      manualCopyRequest === 0 ||
      manualCopySecretRef.current !== issued.secret
    ) {
      return;
    }

    const focusValue = () => {
      secretFieldRef.current
        ?.querySelector<HTMLElement>('[data-slot="secret-field-value"]')
        ?.focus();
    };
    if (
      typeof window === 'undefined' ||
      typeof window.requestAnimationFrame !== 'function'
    ) {
      focusValue();
      return;
    }
    const frame = window.requestAnimationFrame(focusValue);
    return () => window.cancelAnimationFrame(frame);
  }, [issued.secret, manualCopyRequest]);

  function handleCopied() {
    setCopyError(null);
  }

  function handleCopyError() {
    manualCopySecretRef.current = issued.secret;
    setCopyError('The API key could not be copied automatically.');
    setMasked(false);
    requestManualCopy();
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
      <SecretField
        ref={secretFieldRef}
        className="mt-3"
        label="One-time API key secret"
        value={issued.secret}
        visiblePrefix={11}
        visibleSuffix={4}
        masked={masked}
        onMaskedChange={setMasked}
        onCopied={handleCopied}
        onCopyError={handleCopyError}
      />
      <p className="mt-2 text-xs">
        Key: {issued.apiKey.label} · ending in {issued.apiKey.hint}
      </p>
      {copyError && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {copyError} Its full value is revealed, focused, and selected for
          manual copying.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onDismiss}>
          Dismiss and clear from page
        </Button>
      </div>
    </section>
  );
}
