'use client';

import * as React from 'react';
import { AnimateIcon } from '#zero/components/animate-ui/icons/icon';
import { Loader } from '#zero/components/animate-ui/icons/loader';
import { Button } from '#zero/components/ui/button';
import { cn } from '#zero/lib/utils';
import {
  useDataRealmReadiness,
  type DataRealmReadinessControl,
  type UseDataRealmReadinessOptions,
  type UseDataRealmReadinessResult,
} from '../../frontend/client/data-realm-readiness-hooks';

export interface DataRealmReadyGateProps
  extends UseDataRealmReadinessOptions {
  children: React.ReactNode;
  /** Optional host-owned state; supplying it suppresses the gate's own query. */
  readiness?: UseDataRealmReadinessResult;
  /** Fully replace the non-ready presentation without changing gate behavior. */
  renderFallback?: (readiness: UseDataRealmReadinessResult) => React.ReactNode;
  className?: string;
}

/**
 * Keep app data hooks and UI unmounted until the active realm is usable.
 * This is a presentation/readiness boundary; server policy remains authority.
 */
export function DataRealmReadyGate({
  children,
  readiness: controlledReadiness,
  renderFallback,
  enabled,
  pollIntervalMs,
  className,
}: DataRealmReadyGateProps) {
  const queriedReadiness = useDataRealmReadiness({
    enabled: controlledReadiness ? false : enabled,
    pollIntervalMs,
  });
  const readiness = controlledReadiness ?? queriedReadiness;
  if (readiness.isReady) return <>{children}</>;
  if (readiness.status === 'disabled') return null;
  if (renderFallback) return <>{renderFallback(readiness)}</>;
  return <DataRealmReadinessNotice readiness={readiness} className={className} />;
}

export interface DataRealmReadinessNoticeProps {
  readiness: DataRealmReadinessControl;
  provisioningTitle?: string;
  provisioningDescription?: string;
  errorTitle?: string;
  errorDescription?: string;
  retryLabel?: string;
  className?: string;
}

/** Default token-driven provisioning/error/retry surface for any placement. */
export function DataRealmReadinessNotice({
  readiness,
  provisioningTitle = 'Preparing application data',
  provisioningDescription = 'Zero is finishing secure data setup. This page will continue automatically.',
  errorTitle = 'Application data is not ready',
  errorDescription,
  retryLabel = 'Retry setup',
  className,
}: DataRealmReadinessNoticeProps) {
  if (readiness.isReady || readiness.status === 'disabled') return null;
  if (readiness.isPending) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className={cn(
          'flex items-start gap-3 rounded-md border border-border bg-muted/35 px-4 py-3 text-sm',
          className,
        )}
      >
        <AnimateIcon animate loop className="mt-0.5 shrink-0 text-muted-foreground">
          <Loader size={16} />
        </AnimateIcon>
        <div className="min-w-0 space-y-0.5">
          <p className="font-medium text-foreground">{provisioningTitle}</p>
          <p className="text-muted-foreground">{provisioningDescription}</p>
        </div>
      </div>
    );
  }

  const description = errorDescription ?? (readiness.canRetry
    ? 'Setup did not finish. Retry the same safe provisioning operation.'
    : 'Setup needs administrator attention before application data can be opened.');
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium text-destructive">{errorTitle}</p>
        <p className="text-destructive/90">{description}</p>
      </div>
      {readiness.canRetry && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={() => { void readiness.retry(); }}
        >
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
