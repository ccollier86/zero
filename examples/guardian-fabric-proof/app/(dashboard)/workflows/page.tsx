'use client';

import {
  DataRealmReadyGate,
  TenantGate,
} from '@zero/framework/components/auth';
import { Button } from '@zero/framework/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@zero/framework/components/ui/card';

import { TorrentProofPanel } from '../../workflows/torrent-proof-panel';

export const meta = {
  title: 'Torrent workflows | Guardian + Fabric + Torrent Proof',
  description: 'Live, actor-scoped workflows with a physical tenant-database effect.',
};

export default function WorkflowsPage() {
  return (
    <TenantGate tenantKind="organization" fallback={<CustomerWorkspaceRequired />}>
      <DataRealmReadyGate>
        <TorrentProofPanel />
      </DataRealmReadyGate>
    </TenantGate>
  );
}
function CustomerWorkspaceRequired() {
  return (
    <Card>
      <CardHeader>
        <CardTitle asChild><h2>Create or select a customer workspace</h2></CardTitle>
        <CardDescription>
          The proof workflow requires a live Guardian membership and its physically isolated
          Fabric data realm.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button asChild><a href="/workspaces/new">Create workspace</a></Button>
        <Button asChild variant="outline"><a href="/app">Return to proof center</a></Button>
      </CardContent>
    </Card>
  );
}
