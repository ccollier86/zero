'use client';

import * as React from 'react';
import { Badge } from '#zero/components/ui/badge';
import { Button } from '#zero/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#zero/components/ui/card';
import { Input } from '#zero/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#zero/components/ui/select';
import { useAuthAudit } from '../../frontend/client/auth-audit-hooks';
import type {
  AuthAuditEvent,
  AuthAuditOutcome,
  AuthAuditReadScope,
} from '../../frontend/client/auth-audit-types';
import { cn } from '#zero/lib/utils';

export interface ControlPlaneAuditViewerProps {
  scope: AuthAuditReadScope;
  className?: string;
  pageSize?: number;
  title?: string;
  description?: string;
}

/** Paginated, server-authorized viewer for Zero's bounded control-plane trail. */
export function ControlPlaneAuditViewer({
  scope,
  className,
  pageSize = 50,
  title = 'Authorization audit',
  description = 'Security and access-control changes retained by this application.',
}: ControlPlaneAuditViewerProps) {
  const [draftAction, setDraftAction] = React.useState('');
  const [draftTargetType, setDraftTargetType] = React.useState('');
  const [draftOutcome, setDraftOutcome] = React.useState<AuthAuditOutcome | undefined>();
  const [filters, setFilters] = React.useState<{
    action?: string;
    targetType?: string;
    outcome?: AuthAuditOutcome;
  }>({});
  const boundedPageSize = Number.isFinite(pageSize)
    ? Math.min(100, Math.max(1, Math.trunc(pageSize)))
    : 50;
  const audit = useAuthAudit({
    scope,
    limit: boundedPageSize,
    action: filters.action,
    targetType: filters.targetType,
    outcome: filters.outcome,
  });
  const [localError, setLocalError] = React.useState<string | null>(null);

  async function exportVisibleQuery() {
    setLocalError(null);
    try {
      const result = await audit.exportEvents();
      downloadNdjson(result.ndjson, `zero-auth-audit-${scope}-${Date.now()}.ndjson`);
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : 'Audit export failed.');
    }
  }

  function applyFilters(event: React.FormEvent) {
    event.preventDefault();
    setFilters({
      action: draftAction.trim() || undefined,
      targetType: draftTargetType.trim() || undefined,
      outcome: draftOutcome,
    });
  }

  return (
    <Card
      className={cn('overflow-hidden', className)}
      aria-busy={audit.isLoading || audit.isLoadingMore || audit.isExporting}
    >
      <CardHeader className="gap-3 border-b border-border/70">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <form
          className="grid gap-2 md:grid-cols-[1fr_1fr_11rem_auto_auto]"
          onSubmit={applyFilters}
          aria-disabled={audit.isDenied || undefined}
        >
          <Input
            value={draftAction}
            onChange={(event) => setDraftAction(event.target.value)}
            aria-label="Filter audit action"
            placeholder="Action, for example tenant.member-added"
            disabled={audit.isDenied}
          />
          <Input
            value={draftTargetType}
            onChange={(event) => setDraftTargetType(event.target.value)}
            aria-label="Filter audit target type"
            placeholder="Target type"
            disabled={audit.isDenied}
          />
          <Select
            value={draftOutcome ?? 'all'}
            disabled={audit.isDenied}
            onValueChange={(value) => setDraftOutcome(
              value === 'all' ? undefined : value as AuthAuditOutcome,
            )}
          >
            <SelectTrigger aria-label="Filter audit outcome">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All outcomes</SelectItem>
              <SelectItem value="succeeded">Succeeded</SelectItem>
              <SelectItem value="denied">Denied</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Button type="submit" disabled={audit.isDenied || audit.isLoading}>
            Apply filters
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={audit.isDenied || audit.isExporting || audit.isLoading}
            onClick={() => { void exportVisibleQuery(); }}
          >
            {audit.isExporting ? 'Exporting…' : 'Export NDJSON'}
          </Button>
        </form>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        {(audit.error || localError) && (!audit.isDenied || localError) && (
          <div role="alert" className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0">{localError ?? audit.error}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={audit.isLoading || audit.isLoadingMore || audit.isExporting}
              onClick={() => {
                setLocalError(null);
                audit.reload();
              }}
            >
              Retry
            </Button>
          </div>
        )}
        {audit.isDenied ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            You do not have permission to read this audit trail.
          </p>
        ) : audit.isLoading ? (
          <p role="status" aria-live="polite" className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Loading authorization audit…
          </p>
        ) : audit.events.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No matching control-plane events.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[54rem] text-left text-sm">
              <caption className="sr-only">Authorization and control-plane audit events</caption>
              <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Time</th>
                  <th scope="col" className="px-3 py-2 font-medium">Scope</th>
                  <th scope="col" className="px-3 py-2 font-medium">Action</th>
                  <th scope="col" className="px-3 py-2 font-medium">Actor</th>
                  <th scope="col" className="px-3 py-2 font-medium">Target</th>
                  <th scope="col" className="px-3 py-2 font-medium">Request</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {audit.events.map((event) => <AuditRow key={event.eventId} event={event} />)}
              </tbody>
            </table>
          </div>
        )}
        {audit.page?.hasMore && !audit.isDenied && (
          <div className="flex justify-center">
            <Button
              type="button"
              variant="outline"
              disabled={audit.isLoadingMore}
              onClick={() => { void audit.loadMore(); }}
            >
              {audit.isLoadingMore ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** @internal Exported from this module only so column semantics stay regression-tested. */
export function AuditRow({ event }: { event: AuthAuditEvent }) {
  return (
    <tr className="align-top">
      <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
        <time dateTime={new Date(event.occurredAt).toISOString()}>
          {new Date(event.occurredAt).toLocaleString()}
        </time>
      </td>
      <td className="px-3 py-3">
        {event.scopeKind === 'tenant' ? (
          <AuditIdentifier value={event.tenantId} prefix="tenant" />
        ) : (
          <span className="text-xs text-muted-foreground">{formatAuthAuditScope(event)}</span>
        )}
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <code className="text-xs">{event.action}</code>
          <Badge variant={event.outcome === 'succeeded' ? 'secondary' : 'outline'}>
            {event.outcome}
          </Badge>
        </div>
        {event.reason && <p className="mt-1 text-xs text-muted-foreground">{event.reason}</p>}
        {Object.keys(event.metadata).length > 0 && (
          <details className="mt-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer">Metadata</summary>
            <code className="mt-1 block break-all">{JSON.stringify(event.metadata)}</code>
          </details>
        )}
      </td>
      <td className="px-3 py-3">
        <AuditIdentifier value={event.actorUserId} fallback={event.actorProvenance} />
        {event.actorMembershipId && (
          <AuditIdentifier value={event.actorMembershipId} prefix="membership" />
        )}
      </td>
      <td className="px-3 py-3">
        <AuditIdentifier value={event.targetId} fallback="—" prefix={event.targetType ?? undefined} />
      </td>
      <td className="px-3 py-3">
        <AuditIdentifier value={event.requestId} fallback="—" />
        {event.correlationId && (
          <AuditIdentifier value={event.correlationId} prefix="correlation" />
        )}
      </td>
    </tr>
  );
}

function AuditIdentifier({
  value,
  fallback,
  prefix,
}: {
  value: string | null;
  fallback?: string;
  prefix?: string;
}) {
  return (
    <div className="max-w-64 break-all text-xs">
      {prefix && <span className="mr-1 text-muted-foreground">{prefix}:</span>}
      {value ? <code>{value}</code> : <span className="text-muted-foreground">{fallback}</span>}
    </div>
  );
}

export function formatAuthAuditScope(
  event: Pick<AuthAuditEvent, 'scopeKind' | 'tenantId'>,
): string {
  return event.scopeKind === 'tenant' ? `tenant:${event.tenantId ?? 'unknown'}` : 'application';
}

function downloadNdjson(contents: string, filename: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    throw new Error('Audit export downloads require a browser.');
  }
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/x-ndjson' }));
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
