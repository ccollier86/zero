'use client';

import * as React from 'react';

import { PlatformApiKeyManagement } from '@zero/framework/components/auth';
import { Button } from '@zero/framework/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@zero/framework/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@zero/framework/components/ui/select';
import { usePlatformTenants } from '@zero/framework/react/hooks';

/** Cross-tenant target picker for Guardian's packaged platform key control. */
export function PlatformMemberApiKeys() {
  const [tenantId, setTenantId] = React.useState('');
  const [membershipId, setMembershipId] = React.useState('');
  const directory = usePlatformTenants({
    limit: 100,
    status: 'active',
    selectedTenantId: tenantId || null,
    memberLimit: 100,
    memberStatus: 'active',
  });
  const capabilities = directory.config?.capabilities;
  const eligibleTenants = directory.tenants;
  const tenantIds = eligibleTenants.map((tenant) => tenant.tenantId).join('|');
  const memberIds = directory.selectedTenantMembers
    .map((member) => member.membershipId)
    .join('|');

  React.useEffect(() => {
    if (!directory.isLoading
      && tenantId
      && !eligibleTenants.some((tenant) => tenant.tenantId === tenantId)) {
      setTenantId('');
      setMembershipId('');
    }
  }, [directory.isLoading, tenantId, tenantIds]);

  React.useEffect(() => {
    if (!directory.isLoadingMembers
      && membershipId
      && !directory.selectedTenantMembers.some(
        (member) => member.membershipId === membershipId,
      )) setMembershipId('');
  }, [directory.isLoadingMembers, memberIds, membershipId]);

  return (
    <div className="grid gap-4">
      <Card aria-busy={directory.isLoading || directory.isLoadingMembers}>
        <CardHeader>
          <CardTitle asChild><h2>Issue a customer member credential</h2></CardTitle>
          <CardDescription>
            Select a customer workspace and active membership. Guardian still projects the
            exact platform-key capabilities allowed by your Administration Organization role.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {directory.error ? (
            <div className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between" role="alert">
              <span>{directory.error}</span>
              <Button type="button" size="sm" variant="outline" onClick={directory.reload}>Retry</Button>
            </div>
          ) : null}
          {!directory.isLoading && capabilities?.canReadTenants === false ? (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              Your Administration Organization role cannot view customer workspaces.
            </p>
          ) : null}
          {!directory.isLoading
          && capabilities?.canReadTenants === true
          && eligibleTenants.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                No active customer workspaces are available for credential issuance.
              </p>
            ) : null}
          {tenantId && capabilities?.canReadTenantMembers === false ? (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              Your Administration Organization role cannot view customer workspace members.
            </p>
          ) : null}
          <div className="grid gap-3 lg:grid-cols-2">
            <Select
              value={tenantId}
              disabled={directory.isLoading || capabilities?.canReadTenants !== true}
              onValueChange={(value) => {
                setTenantId(value);
                setMembershipId('');
              }}
            >
              <SelectTrigger aria-label="Customer workspace">
                <SelectValue placeholder={directory.isLoading ? 'Loading workspaces…' : 'Choose a workspace'} />
              </SelectTrigger>
              <SelectContent>
                {eligibleTenants.map((tenant) => (
                  <SelectItem key={tenant.tenantId} value={tenant.tenantId}>
                    {tenant.name} — {tenant.slug}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={membershipId}
              onValueChange={setMembershipId}
              disabled={!tenantId
                || directory.isLoadingMembers
                || capabilities?.canReadTenantMembers !== true}
            >
              <SelectTrigger aria-label="Customer workspace member">
                <SelectValue placeholder={directory.isLoadingMembers
                  ? 'Loading members…'
                  : capabilities?.canReadTenantMembers === false
                    ? 'Member directory unavailable'
                    : 'Choose an active member'} />
              </SelectTrigger>
              <SelectContent>
                {directory.selectedTenantMembers.map((member) => (
                  <SelectItem key={member.membershipId} value={member.membershipId}>
                    {memberLabel(member.identity)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {directory.page?.hasMore || directory.selectedTenantMemberPage?.hasMore ? (
            <div className="flex flex-wrap gap-2">
              {directory.page?.hasMore ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={directory.isLoadingMore}
                  onClick={() => { void directory.loadMore(); }}
                >
                  {directory.isLoadingMore ? 'Loading…' : 'Load more workspaces'}
                </Button>
              ) : null}
              {directory.selectedTenantMemberPage?.hasMore ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={directory.isLoadingMoreMembers}
                  onClick={() => { void directory.loadMoreMembers(); }}
                >
                  {directory.isLoadingMoreMembers ? 'Loading…' : 'Load more members'}
                </Button>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {tenantId && membershipId ? (
        <PlatformApiKeyManagement
          key={`${tenantId}:${membershipId}`}
          tenantId={tenantId}
          membershipId={membershipId}
          title="Selected customer member API keys"
          description="Issue, rotate, or revoke finite credentials through protected platform authority."
          pageSize={20}
        />
      ) : null}
    </div>
  );
}

function memberLabel(identity: {
  firstName: string | null;
  lastName: string | null;
  username: string;
  email: string;
}): string {
  const name = [identity.firstName, identity.lastName].filter(Boolean).join(' ');
  return name ? `${name} — ${identity.email}` : `${identity.username} — ${identity.email}`;
}
