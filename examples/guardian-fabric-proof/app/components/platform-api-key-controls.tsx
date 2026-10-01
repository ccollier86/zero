'use client';

import * as React from 'react';

import { PlatformApiKeyManagement } from '@zero/framework/components/auth';
import { Button } from '@zero/framework/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@zero/framework/components/ui/select';
import { usePlatformTenants } from '@zero/framework/react/hooks';

import { ControlPlaneTabs } from './control-plane-tabs';

/** Administration-scope credentials separated into targeted and directory modes. */
export function PlatformApiKeyControls() {
  return (
    <ControlPlaneTabs
      defaultValue="member"
      tabs={[
        {
          id: 'member',
          label: 'Customer member',
          description: 'Target one active customer membership with your projected platform authority.',
          content: <PlatformMemberApiKeys />,
        },
        {
          id: 'directory',
          label: 'Credential directory',
          description: 'Review and revoke customer credentials visible to the Administration Organization.',
          content: (
            <PlatformApiKeyManagement
              title="Customer API key directory"
              description="Review and revoke customer-workspace credentials within your projected platform capabilities."
              pageSize={20}
            />
          ),
        },
      ]}
    />
  );
}

function PlatformMemberApiKeys() {
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
  const tenantIds = directory.tenants.map((tenant) => tenant.tenantId).join('|');
  const memberIds = directory.selectedTenantMembers.map((member) => member.membershipId).join('|');

  React.useEffect(() => {
    if (!directory.isLoading && tenantId
      && !directory.tenants.some((tenant) => tenant.tenantId === tenantId)) {
      setTenantId('');
      setMembershipId('');
    }
  }, [directory.isLoading, tenantId, tenantIds]);

  React.useEffect(() => {
    if (!directory.isLoadingMembers && membershipId
      && !directory.selectedTenantMembers.some((member) => member.membershipId === membershipId)) {
      setMembershipId('');
    }
  }, [directory.isLoadingMembers, memberIds, membershipId]);

  return (
    <div className="space-y-3">
      <section
        className="rounded-lg border bg-background p-3"
        aria-busy={directory.isLoading || directory.isLoadingMembers}
        aria-labelledby="platform-credential-target"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 id="platform-credential-target" className="text-sm font-semibold">Customer credential target</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose a customer workspace and active membership; the picker itself grants no authority.
            </p>
          </div>
          {directory.error ? (
            <Button type="button" size="sm" variant="outline" onClick={directory.reload}>Retry</Button>
          ) : null}
        </div>

        <div className="mt-3 grid gap-2 lg:grid-cols-2">
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
              {directory.tenants.map((tenant) => (
                <SelectItem key={tenant.tenantId} value={tenant.tenantId}>
                  {tenant.name} — {tenant.slug}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={membershipId}
            onValueChange={setMembershipId}
            disabled={!tenantId || directory.isLoadingMembers
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

        {(directory.page?.hasMore || directory.selectedTenantMemberPage?.hasMore) ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {directory.page?.hasMore ? (
              <Button type="button" size="sm" variant="outline" disabled={directory.isLoadingMore}
                onClick={() => { void directory.loadMore(); }}>
                {directory.isLoadingMore ? 'Loading…' : 'Load more workspaces'}
              </Button>
            ) : null}
            {directory.selectedTenantMemberPage?.hasMore ? (
              <Button type="button" size="sm" variant="outline" disabled={directory.isLoadingMoreMembers}
                onClick={() => { void directory.loadMoreMembers(); }}>
                {directory.isLoadingMoreMembers ? 'Loading…' : 'Load more members'}
              </Button>
            ) : null}
          </div>
        ) : null}
        {directory.error ? <p className="mt-2 text-sm text-destructive" role="alert">{directory.error}</p> : null}
      </section>

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
