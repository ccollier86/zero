'use client';

import * as React from 'react';

import { TenantMemberApiKeyManagement } from '@zero/framework/components/auth';
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
import { useTenantMembers } from '@zero/framework/react/hooks';

/** App-owned member picker composed with Guardian's capability-aware key control. */
export function WorkspaceMemberApiKeys() {
  const directory = useTenantMembers({ status: 'active', limit: 100 });
  const [membershipId, setMembershipId] = React.useState('');
  const memberIds = directory.members.map((member) => member.membershipId).join('|');

  React.useEffect(() => {
    if (!directory.isLoading
      && membershipId
      && !directory.members.some((member) => member.membershipId === membershipId)) {
      setMembershipId('');
    }
  }, [directory.isLoading, memberIds, membershipId]);

  const canReadMembers = directory.config?.capabilities.canReadMembers === true;

  return (
    <div className="grid gap-4">
      <Card aria-busy={directory.isLoading || directory.isLoadingMore}>
        <CardHeader>
          <CardTitle>Member automation credentials</CardTitle>
          <CardDescription>
            Choose an active workspace member, then let Guardian project the exact key actions
            your current authority may perform. Secrets are shown once.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {directory.error ? (
            <div className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between" role="alert">
              <span>{directory.error}</span>
              <Button type="button" size="sm" variant="outline" onClick={directory.reload}>
                Retry
              </Button>
            </div>
          ) : directory.isLoading && directory.config === null ? (
            <p className="text-sm text-muted-foreground" role="status">
              Loading active workspace members…
            </p>
          ) : !canReadMembers ? (
            <p className="text-sm text-muted-foreground">
              Your current workspace authority cannot browse member credentials.
            </p>
          ) : directory.members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active workspace members are available.</p>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select value={membershipId} onValueChange={setMembershipId}>
                <SelectTrigger className="w-full sm:max-w-md" aria-label="Workspace member">
                  <SelectValue placeholder="Choose an active member" />
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
                  variant="outline"
                  disabled={directory.isLoadingMore}
                  onClick={() => { void directory.loadMore(); }}
                >
                  {directory.isLoadingMore ? 'Loading…' : 'Load more members'}
                </Button>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

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
