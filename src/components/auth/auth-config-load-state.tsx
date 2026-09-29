'use client';

import * as React from 'react';
import type { AuthConfigState } from '../../frontend/client/auth-hooks';
import { Button } from '#zero/components/ui/button';
import { cn } from '#zero/lib/utils';

export interface AuthConfigLoadStateProps {
  state: Pick<
    AuthConfigState,
    'status' | 'config' | 'isLoading' | 'error' | 'reload'
  >;
  loadingMessage: string;
  unavailableMessage: string;
  /** Render a deterministic loading state during SSR's unknown snapshot. */
  showUnknown?: boolean;
  className?: string;
}

/** Shared fail-closed state for UI whose capability depends on `/auth/config`. */
export function AuthConfigLoadState({
  state,
  loadingMessage,
  unavailableMessage,
  showUnknown = false,
  className,
}: AuthConfigLoadStateProps) {
  if (state.config !== null) return null;

  if (state.error !== null) {
    return (
      <div
        role="alert"
        className={cn(
          'flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between',
          className,
        )}
      >
        <span>{unavailableMessage}</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={state.isLoading}
          onClick={() => { void state.reload(); }}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (state.isLoading || (showUnknown && state.status === 'unknown')) {
    return (
      <p
        role="status"
        aria-live="polite"
        className={cn('text-sm text-muted-foreground', className)}
      >
        {loadingMessage}
      </p>
    );
  }

  return null;
}
