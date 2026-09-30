'use client';

import * as React from 'react';
import type {
  AuthApiKeyIssueInput,
  AuthApiKeySummary,
} from '../../frontend/client/auth-api-key-types';
import {
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#zero/components/animate-ui/components/radix/alert-dialog';
import { Badge } from '#zero/components/ui/badge';
import { Button } from '#zero/components/ui/button';
import { Input } from '#zero/components/ui/input';
import { Label } from '#zero/components/ui/label';

export type ApiKeyConfirmationAction = 'rotate' | 'revoke';

export interface PendingApiKeyConfirmation {
  action: ApiKeyConfirmationAction;
  apiKey: AuthApiKeySummary;
}

export function ApiKeyIssueForm({
  busy,
  disabled,
  defaultTTL,
  maxTTL,
  onIssue,
}: {
  busy: boolean;
  disabled: boolean;
  defaultTTL: string;
  maxTTL: string;
  onIssue(input: AuthApiKeyIssueInput): Promise<boolean>;
}) {
  const [label, setLabel] = React.useState('');
  const [ttl, setTtl] = React.useState('');
  const labelId = React.useId();
  const ttlId = React.useId();
  const ttlDescriptionId = React.useId();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!label.trim() || busy || disabled) return;
    const completed = await onIssue({
      label: label.trim(),
      ...(ttl.trim() ? { ttl: ttl.trim() } : {}),
    });
    if (completed) {
      setLabel('');
      setTtl('');
    }
  }

  return (
    <form className="rounded-md border border-border/80 bg-muted/15 p-4" onSubmit={submit}>
      <h3 className="text-sm font-semibold">Issue a new API key</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        The new secret appears once after this request succeeds.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor={labelId}>Key label</Label>
          <Input
            id={labelId}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Deployment automation"
            maxLength={100}
            disabled={busy || disabled}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={ttlId}>Lifetime</Label>
          <Input
            id={ttlId}
            value={ttl}
            onChange={(event) => setTtl(event.target.value)}
            placeholder="Default"
            maxLength={32}
            aria-describedby={ttlDescriptionId}
            disabled={busy || disabled}
          />
          <span id={ttlDescriptionId} className="block text-xs text-muted-foreground">
            Optional. Defaults to {defaultTTL}; maximum {maxTTL}.
          </span>
        </div>
        <Button type="submit" disabled={busy || disabled || !label.trim()}>
          {busy ? 'Issuing…' : 'Issue key'}
        </Button>
      </div>
    </form>
  );
}

export function ApiKeyList({
  apiKeys,
  busy,
  canRotate,
  canRevoke,
  actionsDisabled,
  tenantSingular = 'organization',
  onConfirm,
}: {
  apiKeys: readonly AuthApiKeySummary[];
  busy: boolean;
  canRotate: boolean;
  canRevoke: boolean;
  actionsDisabled: boolean;
  tenantSingular?: string;
  onConfirm(
    action: ApiKeyConfirmationAction,
    apiKey: AuthApiKeySummary,
    trigger: HTMLButtonElement,
  ): void;
}) {
  return (
    <div className="divide-y divide-border/70 rounded-md border border-border/80">
      {apiKeys.map((apiKey) => {
        // Expired, invalidated, and temporarily unavailable rows remain
        // intentionally manageable so operators can close their lifecycle
        // explicitly. Only an already-revoked row has no revoke action.
        const revocable = apiKey.status !== 'revoked';
        return (
          <article key={apiKey.keyId} className="space-y-3 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="break-words text-sm font-semibold">{apiKey.label}</h3>
                  <ApiKeyStatusBadge status={apiKey.status} />
                  <Badge variant="outline">
                    {apiKey.createdVia === 'self' ? 'self-issued' : 'administrator-issued'}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Secret ending in <code>{apiKey.hint}</code>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canRotate && apiKey.status === 'active' && (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={busy || actionsDisabled}
                    aria-haspopup="dialog"
                    aria-label={`Rotate API key ${apiKey.label} ending in ${apiKey.hint}`}
                    onClick={(event) => onConfirm('rotate', apiKey, event.currentTarget)}
                  >
                    Rotate
                  </Button>
                )}
                {canRevoke && revocable && (
                  <Button
                    type="button"
                    size="xs"
                    variant="destructive"
                    disabled={busy || actionsDisabled}
                    aria-haspopup="dialog"
                    aria-label={`Revoke API key ${apiKey.label} ending in ${apiKey.hint}`}
                    onClick={(event) => onConfirm('revoke', apiKey, event.currentTarget)}
                  >
                    Revoke
                  </Button>
                )}
              </div>
            </div>
            <dl className="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <ApiKeyDetail label="Created" value={formatApiKeyTimestamp(apiKey.createdAt)} />
              <ApiKeyDetail label="Expires" value={formatApiKeyTimestamp(apiKey.expiresAt)} />
              <ApiKeyDetail
                label="Last used"
                value={apiKey.lastUsedAt === null
                  ? 'Never'
                  : formatApiKeyTimestamp(apiKey.lastUsedAt)}
              />
              <ApiKeyDetail label="User" value={apiKey.userId} code />
              {apiKey.tenantId && (
                <ApiKeyDetail
                  label={capitalize(tenantSingular)}
                  value={apiKey.tenantId}
                  code
                />
              )}
              {apiKey.membershipId && (
                <ApiKeyDetail label="Membership" value={apiKey.membershipId} code />
              )}
              {apiKey.revokedAt !== null && (
                <ApiKeyDetail
                  label="Revoked"
                  value={formatApiKeyTimestamp(apiKey.revokedAt)}
                />
              )}
            </dl>
          </article>
        );
      })}
    </div>
  );
}

export function ApiKeyConfirmationDialog({
  confirmation,
  busy,
  error,
  tenantSingular = 'organization',
  onConfirm,
  onCloseAutoFocus,
}: {
  confirmation: PendingApiKeyConfirmation;
  busy: boolean;
  error: string | null;
  tenantSingular?: string;
  onConfirm(): void;
  onCloseAutoFocus: React.ComponentProps<typeof AlertDialogContent>['onCloseAutoFocus'];
}) {
  const rotating = confirmation.action === 'rotate';
  const keyDescription = apiKeyConfirmationTarget(
    confirmation.apiKey,
    tenantSingular,
  );
  return (
    <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {rotating
            ? `Rotate API key ${confirmation.apiKey.label} ending in ${confirmation.apiKey.hint}?`
            : `Revoke API key ${confirmation.apiKey.label} ending in ${confirmation.apiKey.hint}?`}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {rotating
            ? `${keyDescription} will stop working immediately. The replacement secret will be shown once and use the configured default lifetime.`
            : `${keyDescription} will stop working immediately. This cannot be undone.`}
        </AlertDialogDescription>
      </AlertDialogHeader>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel asChild>
          <Button type="button" variant="outline" disabled={busy}>Cancel</Button>
        </AlertDialogCancel>
        <Button
          type="button"
          variant={rotating ? 'default' : 'destructive'}
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? (rotating ? 'Rotating…' : 'Revoking…') : (rotating ? 'Rotate key' : 'Revoke key')}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}

/**
 * Identifies the exact non-secret credential target in destructive dialogs.
 * Labels are intentionally not assumed to be unique in global directories.
 */
export function apiKeyConfirmationTarget(
  apiKey: AuthApiKeySummary,
  tenantSingular = 'organization',
): string {
  const scope = apiKey.tenantId
    ? `${tenantSingular} ${apiKey.tenantId}${
      apiKey.membershipId ? `, membership ${apiKey.membershipId}` : ''
    }`
    : 'the application scope';
  return `API key ${apiKey.label}, ending in ${apiKey.hint}, for user ${apiKey.userId} in ${scope}`;
}

function ApiKeyStatusBadge({ status }: Pick<AuthApiKeySummary, 'status'>) {
  const label = status === 'invalidated' ? 'security invalidated' : status;
  const variant = status === 'active'
    ? 'secondary'
    : status === 'revoked' || status === 'invalidated'
      ? 'destructive'
      : 'warning';
  return <Badge variant={variant}>{label}</Badge>;
}

function ApiKeyDetail({
  label,
  value,
  code = false,
}: {
  label: string;
  value: string;
  code?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-all">{code ? <code>{value}</code> : value}</dd>
    </div>
  );
}

export function formatApiKeyTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(timestamp)) + ' UTC';
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
