'use client';

import * as React from 'react';
import type {
  AuthPlatformMutableTenantStatus,
  AuthPlatformTenant,
  AuthPlatformTenantStatus,
} from '../../frontend/client/auth-platform-administration-types';
import type { AuthTenantMembershipStatus } from '../../frontend/client/auth-types';
import { useAuth, useAuthConfig } from '../../frontend/client/auth-hooks';
import { usePlatformTenants } from '../../frontend/client/platform-administration-hooks';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#zero/components/animate-ui/components/radix/alert-dialog';
import { Badge } from '#zero/components/ui/badge';
import { Button } from '#zero/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#zero/components/ui/card';
import { Input } from '#zero/components/ui/input';
import { Label } from '#zero/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#zero/components/ui/select';
import { cn } from '#zero/lib/utils';
import { AuthConfigLoadState } from './auth-config-load-state';

export interface PlatformTenantManagementProps {
  className?: string;
  pageSize?: number;
  title?: string;
  description?: string;
}

/** Customer-organization directory and lifecycle controls for platform operators. */
export function PlatformTenantManagement(props: PlatformTenantManagementProps) {
  const auth = useAuth();
  const authConfig = useAuthConfig();
  const config = authConfig.config;
  const terminology = resolveTenantTerminology(config?.tenancy?.terminology);
  const boundary = JSON.stringify([
    auth.user?.userId ?? null,
    auth.activeTenant?.tenantId ?? null,
    auth.activeTenant?.kind ?? null,
  ]);
  return (
    <PlatformTenantManagementScope
      key={boundary}
      {...props}
      terminology={terminology}
      configState={authConfig}
    />
  );
}

function PlatformTenantManagementScope({
  className,
  pageSize = 25,
  title,
  description,
  terminology,
  configState,
}: PlatformTenantManagementProps & {
  terminology: TenantTerminology;
  configState: ReturnType<typeof useAuthConfig>;
}) {
  const auth = useAuth();
  const { singular, plural } = terminology;
  const resolvedTitle = title ?? `Customer ${plural}`;
  const resolvedDescription = description
    ?? `Create, browse, suspend, and inspect customer ${plural}.`;
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState<AuthPlatformTenantStatus | 'all'>('all');
  const [selectedTenantId, setSelectedTenantId] = React.useState<string | null>(null);
  const [memberSearchInput, setMemberSearchInput] = React.useState('');
  const [memberSearch, setMemberSearch] = React.useState('');
  const [memberStatus, setMemberStatus] = React.useState<AuthTenantMembershipStatus | 'all'>('all');
  const directory = usePlatformTenants({
    limit: bounded(pageSize, 25),
    search,
    status: status === 'all' ? undefined : status,
    selectedTenantId,
    memberLimit: bounded(pageSize, 25),
    memberSearch,
    memberStatus: memberStatus === 'all' ? undefined : memberStatus,
  });
  const [name, setName] = React.useState('');
  const [slug, setSlug] = React.useState('');
  const [ownerEmail, setOwnerEmail] = React.useState('');
  const [confirmation, setConfirmation] = React.useState<{
    tenant: AuthPlatformTenant;
    nextStatus: AuthPlatformMutableTenantStatus;
  } | null>(null);
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [announcement, setAnnouncement] = React.useState('');
  const confirmationTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const directoryHeadingRef = React.useRef<HTMLHeadingElement | null>(null);
  const detailHeadingRef = React.useRef<HTMLHeadingElement | null>(null);
  const id = React.useId();
  const createHeadingId = `${id}-create`;
  const nameId = `${id}-name`;
  const slugId = `${id}-slug`;
  const ownerEmailId = `${id}-owner-email`;
  const ownerEmailDescriptionId = `${id}-owner-email-description`;
  const directoryHeadingId = `${id}-directory`;
  const tenantDetailId = (tenantId: string) => `${id}-tenant-detail-${tenantId}`;
  const tenantDetailHeadingId = (tenantId: string) => (
    `${id}-tenant-detail-heading-${tenantId}`
  );

  React.useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(timeout);
  }, [searchInput]);
  React.useEffect(() => {
    const timeout = setTimeout(() => setMemberSearch(memberSearchInput.trim()), 250);
    return () => clearTimeout(timeout);
  }, [memberSearchInput]);
  React.useEffect(() => {
    setSelectedTenantId(null);
  }, [search, status]);

  async function createTenant(event: React.FormEvent) {
    event.preventDefault();
    const tenantName = name.trim();
    const email = ownerEmail.trim();
    if (!tenantName || !email) return;
    setLocalError(null);
    setAnnouncement('');
    try {
      const result = await directory.createTenant({
        name: tenantName,
        ownerEmail: email,
        ...(slug.trim() ? { slug: slug.trim() } : {}),
      });
      setName('');
      setSlug('');
      setOwnerEmail('');
      setSelectedTenantId(result.tenant.tenantId);
      setAnnouncement(`Created ${result.tenant.name} with ${email} as owner`);
    } catch (cause) {
      setLocalError(message(cause, singular));
    }
  }

  async function confirmStatus() {
    if (!confirmation) return;
    const pending = confirmation;
    setLocalError(null);
    setAnnouncement('');
    try {
      const result = await directory.setTenantStatus(pending.tenant, pending.nextStatus);
      setConfirmation(null);
      setAnnouncement(`${pending.nextStatus === 'active' ? 'Reactivated' : 'Suspended'} ${result.tenant.name}`);
      requestFrame(() => directoryHeadingRef.current?.focus());
    } catch (cause) {
      setLocalError(message(cause, singular));
    }
  }

  function toggleTenantDetail(tenantId: string) {
    const opening = selectedTenantId !== tenantId;
    setSelectedTenantId(opening ? tenantId : null);
    if (opening) requestFrame(() => detailHeadingRef.current?.focus());
  }

  if (!directory.isAvailable) {
    return <PlatformTenantUnavailable
      className={className}
      title={resolvedTitle}
      description={resolvedDescription}
      plural={plural}
    />;
  }

  const capabilities = directory.config?.capabilities;
  const error = localError ?? directory.error;
  return (
    <Card className={cn('overflow-hidden', className)} aria-busy={
      directory.isLoading || directory.isMutating
    }>
      <CardHeader className="gap-3 border-b border-border/70">
        <div><CardTitle>{resolvedTitle}</CardTitle><CardDescription>{resolvedDescription}</CardDescription></div>
        <Badge className="w-fit" variant="secondary">Administration scope</Badge>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        <AuthConfigLoadState
          state={configState}
          loadingMessage="Loading customer organization terminology…"
          unavailableMessage="Customer organization terminology could not be loaded. Tenant controls remain available with default labels."
        />
        {error && (
          <div role="alert" className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>
            <Button type="button" size="sm" variant="outline" disabled={directory.isLoading || directory.isMutating} onClick={() => {
              setLocalError(null);
              directory.reload();
            }}>Retry</Button>
          </div>
        )}

        {capabilities?.canCreateTenants && (
          <form onSubmit={createTenant} className="space-y-3 rounded-md border border-border/70 p-4" aria-labelledby={createHeadingId}>
            <h3 id={createHeadingId} className="text-sm font-semibold">Create customer {singular}</h3>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor={nameId}>{capitalize(singular)} name</Label>
                <Input id={nameId} value={name} onChange={(event) => setName(event.target.value)} disabled={directory.isMutating} autoComplete="organization" required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={slugId}>Slug (optional)</Label>
                <Input id={slugId} value={slug} onChange={(event) => setSlug(event.target.value)} disabled={directory.isMutating} placeholder="acme-health" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={ownerEmailId}>Initial owner email</Label>
                <Input id={ownerEmailId} type="email" value={ownerEmail} onChange={(event) => setOwnerEmail(event.target.value)} disabled={directory.isMutating} autoComplete="email" aria-describedby={ownerEmailDescriptionId} required />
                <p id={ownerEmailDescriptionId} className="text-xs text-muted-foreground">
                  The owner must already have an active Zero identity. Create it in
                  global user management first if needed.
                </p>
              </div>
            </div>
            <Button type="submit" disabled={directory.isMutating || !name.trim() || !ownerEmail.trim()}>
              {directory.isMutating ? 'Creating…' : `Create ${singular}`}
            </Button>
          </form>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} aria-label={`Search customer ${plural}`} placeholder={`Search ${plural}`} disabled={directory.isLoading} />
          <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
            <SelectTrigger className="sm:w-44" aria-label={`Customer ${singular} status`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <AlertDialog open={confirmation !== null} onOpenChange={(open) => {
          if (!open && !directory.isMutating) {
            setConfirmation(null);
            setLocalError(null);
          }
        }}>
          {confirmation && (
            <AlertDialogContent onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (confirmationTriggerRef.current?.isConnected) confirmationTriggerRef.current.focus();
              else directoryHeadingRef.current?.focus();
            }}>
              <AlertDialogHeader>
                <AlertDialogTitle>{confirmation.nextStatus === 'active' ? `Reactivate ${singular}?` : `Suspend ${singular}?`}</AlertDialogTitle>
                <AlertDialogDescription>
                  {confirmation.nextStatus === 'active'
                    ? `${confirmation.tenant.name} can resume customer access after this change.`
                    : `${confirmation.tenant.name} will lose customer data-plane access until reactivated.`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {localError && (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                >
                  {localError}
                </div>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel asChild><Button type="button" variant="outline" disabled={directory.isMutating}>Cancel</Button></AlertDialogCancel>
                <Button type="button" variant={confirmation.nextStatus === 'active' ? 'default' : 'destructive'} disabled={directory.isMutating} onClick={() => void confirmStatus()}>
                  {directory.isMutating ? 'Updating…' : confirmation.nextStatus === 'active' ? `Reactivate ${singular}` : `Suspend ${singular}`}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          )}
        </AlertDialog>

        {directory.isLoading ? (
          <p role="status" aria-live="polite" className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">Loading customer {plural}…</p>
        ) : !capabilities?.canReadTenants ? (
          <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">Your administration role cannot view customer {plural}.</p>
        ) : (
          <section aria-labelledby={directoryHeadingId}>
            <h3 ref={directoryHeadingRef} tabIndex={-1} id={directoryHeadingId} className="text-sm font-semibold">{capitalize(singular)} directory</h3>
            <div className="mt-3 divide-y divide-border/70 rounded-md border border-border/80">
              {directory.tenants.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">No customer {plural} match this view.</p>
              ) : directory.tenants.map((tenant) => (
                <div key={tenant.tenantId} className={cn('p-4', selectedTenantId === tenant.tenantId && 'bg-accent/35')}>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <button type="button" className="min-w-0 text-left" aria-expanded={selectedTenantId === tenant.tenantId} aria-controls={tenantDetailId(tenant.tenantId)} onClick={() => toggleTenantDetail(tenant.tenantId)}>
                      <span className="block truncate text-sm font-semibold">{tenant.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{tenant.slug} · {tenant.memberCount} members · {tenant.activeMemberCount} active</span>
                    </button>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={tenant.status === 'active' ? 'secondary' : tenant.status === 'suspended' ? 'warning' : 'outline'}>{tenant.status}</Badge>
                      <Button type="button" size="xs" variant="outline" aria-expanded={selectedTenantId === tenant.tenantId} aria-controls={tenantDetailId(tenant.tenantId)} onClick={() => toggleTenantDetail(tenant.tenantId)}>
                        {selectedTenantId === tenant.tenantId ? 'Hide members' : 'View members'}
                      </Button>
                      {capabilities.canManageTenants && tenant.status !== 'archived' && (
                        <Button type="button" size="xs" variant={tenant.status === 'active' ? 'destructive' : 'outline'} aria-haspopup="dialog" disabled={directory.isMutating} onClick={(event) => {
                          confirmationTriggerRef.current = event.currentTarget;
                          setLocalError(null);
                          setConfirmation({ tenant, nextStatus: tenant.status === 'active' ? 'suspended' : 'active' });
                        }}>{tenant.status === 'active' ? 'Suspend' : 'Reactivate'}</Button>
                      )}
                    </div>
                  </div>
                  {selectedTenantId === tenant.tenantId && (
                    <section id={tenantDetailId(tenant.tenantId)} className="mt-4 rounded-md border bg-background p-4" aria-labelledby={tenantDetailHeadingId(tenant.tenantId)}>
                      <h4 ref={detailHeadingRef} tabIndex={-1} id={tenantDetailHeadingId(tenant.tenantId)} className="text-sm font-semibold">Members of {tenant.name}</h4>
                      <p className="mt-1 text-xs text-muted-foreground">Read-only cross-tenant visibility. Switch into this {singular} for customer-scoped work.</p>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <Input type="search" value={memberSearchInput} onChange={(event) => setMemberSearchInput(event.target.value)} aria-label={`Search members of ${tenant.name}`} placeholder="Search members" />
                        <Select value={memberStatus} onValueChange={(value) => setMemberStatus(value as typeof memberStatus)}>
                          <SelectTrigger className="sm:w-44" aria-label={`Membership status for ${tenant.name}`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All statuses</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="suspended">Suspended</SelectItem><SelectItem value="removed">Removed</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {!capabilities.canReadTenantMembers ? (
                        <p className="mt-3 text-sm text-muted-foreground">Your administration role cannot view customer {singular} members.</p>
                      ) : directory.isLoadingMembers ? (
                        <p role="status" aria-live="polite" className="mt-3 text-sm text-muted-foreground">Loading {singular} members…</p>
                      ) : directory.selectedTenantMembers.length === 0 ? (
                        <p className="mt-3 text-sm text-muted-foreground">No members match this view.</p>
                      ) : (
                        <div className="mt-3 divide-y rounded-md border">
                          {directory.selectedTenantMembers.map((member) => (
                            <div key={member.membershipId} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0"><p className="truncate text-sm font-medium">{memberName(member)}</p><p className="truncate text-xs text-muted-foreground">{member.identity.email}</p></div>
                              <div className="flex flex-wrap gap-2"><Badge variant="outline">{member.status}</Badge>{member.roles.map((role) => <Badge key={role} variant="outline">{role}</Badge>)}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      {directory.selectedTenantMemberPage?.hasMore && (
                        <Button type="button" className="mt-3" size="sm" variant="outline" disabled={directory.isLoadingMoreMembers} onClick={() => void directory.loadMoreMembers()}>{directory.isLoadingMoreMembers ? 'Loading…' : 'Load more members'}</Button>
                      )}
                    </section>
                  )}
                </div>
              ))}
            </div>
            {directory.page?.hasMore && <Button type="button" className="mt-3" variant="outline" disabled={directory.isLoadingMore} onClick={() => void directory.loadMore()}>{directory.isLoadingMore ? 'Loading…' : `Load more ${plural}`}</Button>}
          </section>
        )}
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
        <span className="sr-only">Active scope: {auth.activeTenant?.name ?? 'Platform administration'}</span>
      </CardContent>
    </Card>
  );
}

function memberName(member: { identity: { firstName: string | null; lastName: string | null; username: string } }): string {
  return [member.identity.firstName, member.identity.lastName].filter(Boolean).join(' ')
    || member.identity.username;
}

interface TenantTerminology {
  singular: string;
  plural: string;
}

export function PlatformTenantUnavailable({
  className,
  title,
  description,
  plural,
}: {
  className?: string;
  title: string;
  description: string;
  plural: string;
}) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader>
      <CardContent>
        <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
          Switch to Platform administration to browse customer {plural}.
        </p>
      </CardContent>
    </Card>
  );
}

function resolveTenantTerminology(
  terminology: { singular: string; plural: string } | undefined,
): TenantTerminology {
  return {
    singular: terminology?.singular.trim() || 'organization',
    plural: terminology?.plural.trim() || 'organizations',
  };
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

function requestFrame(callback: () => void): void {
  if (typeof window === 'undefined') return;
  window.requestAnimationFrame(callback);
}

function bounded(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(1, Math.trunc(value))) : fallback;
}

function message(cause: unknown, singular: string): string {
  return cause instanceof Error ? cause.message : `Customer ${singular} request failed`;
}
