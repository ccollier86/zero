'use client';

import * as React from 'react';

import {
  SelfApiKeyManagement,
  TenantMemberApiKeyManagement,
} from '@zero/framework/components/auth';
import { Button } from '@zero/framework/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@zero/framework/components/ui/select';
import { useTenantMembers } from '@zero/framework/react/hooks';

import { ApiKeyUsageGuide } from './api-key-usage-guide';
import { ControlPlaneTabs } from './control-plane-tabs';

/** Customer-scope credentials grouped by self-service, member, and usage modes. */
export function WorkspaceApiKeyControls() {
  return (
    <ControlPlaneTabs
      defaultValue="mine"
      tabs={[
        {
          id: 'mine',
          label: 'My credentials',
          description: 'Issue, rotate, and revoke credentials bound to your current membership.',
          content: (
            <SelfApiKeyManagement
              title="Workspace automation credentials"
              description="Issue finite API keys for your current customer workspace. The raw secret is shown once."
              pageSize={20}
            />
          ),
        },
        {
          id: 'members',
          label: 'Member credentials',
          description: 'Manage another active member only when your live workspace role permits it.',
          content: <WorkspaceMemberApiKeys />,
        },
        {
          id: 'usage',
          label: 'Use a key',
          description: 'Exercise the protected task API without exposing a key in source or process arguments.',
          content: <ApiKeyUsageGuide />,
        },
      ]}
    />
  );
}

function WorkspaceMemberApiKeys() {
  const directory = useTenantMembers({ status: 'active', limit: 100 });
  const [membershipId, setMembershipId] = React.useState('');
  const memberIds = directory.members.map((member) => member.membershipId).join('|');

  React.useEffect(() => {
    if (!directory.isLoading && membershipId
      && !directory.members.some((member) => member.membershipId === membershipId)) {
      setMembershipId('');
    }
  }, [directory.isLoading, memberIds, membershipId]);

  const canReadMembers = directory.config?.capabilities.canReadMembers === true;
  return (
    <div className="space-y-3">
      <section
        className="rounded-lg border bg-background p-3"
        aria-busy={directory.isLoading || directory.isLoadingMore}
        aria-labelledby="member-credential-target"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 id="member-credential-target" className="text-sm font-semibold">Credential owner</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Select an active workspace member. Guardian projects the exact key actions you may perform.
            </p>
          </div>
          {directory.error ? (
            <Button type="button" size="sm" variant="outline" onClick={directory.reload}>Retry</Button>
          ) : null}
        </div>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select
            value={membershipId}
            onValueChange={setMembershipId}
            disabled={directory.isLoading || !canReadMembers || directory.members.length === 0}
          >
            <SelectTrigger className="w-full sm:max-w-md" aria-label="Workspace member">
              <SelectValue placeholder={directory.isLoading
                ? 'Loading active members…'
                : !canReadMembers ? 'Member directory unavailable' : 'Choose an active member'} />
            </SelectTrigger>
            <SelectContent>
              {directory.members.map((member) => (
                <SelectItem key={member.membershipId} value={member.membershipId}>
                  {memberLabel(member.identity)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {directory.page?.hasMore ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={directory.isLoadingMore}
              onClick={() => { void directory.loadMore(); }}
            >
              {directory.isLoadingMore ? 'Loading…' : 'Load more members'}
            </Button>
          ) : null}
        </div>
        {directory.error ? <p className="mt-2 text-sm text-destructive" role="alert">{directory.error}</p> : null}
        {!directory.isLoading && canReadMembers && directory.members.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No active workspace members are available.</p>
        ) : null}
      </section>

      {membershipId ? (
        <TenantMemberApiKeyManagement
          key={membershipId}
          membershipId={membershipId}
          title="Selected member API keys"
          description="Issue, rotate, or revoke finite credentials for this active workspace member."
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
