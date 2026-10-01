'use client';

import {
  TenantGate,
} from '@zero/framework/components/auth';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@zero/framework/components/ui/card';

import { WorkspaceApiKeyControls } from '../../components/workspace-api-key-controls';

export const meta = {
  title: 'Security | Guardian + Fabric Proof',
  description: 'Manage API keys for the current customer-workspace authority.',
};

/** Session-only management UI for finite, user-bound automation credentials. */
export default function SecurityPage() {
  return (
    <TenantGate tenantKind="organization" fallback={<CustomerWorkspaceRequired />}>
      <div className="grid gap-6">
        <WorkspaceApiKeyControls />
      </div>
    </TenantGate>
  );
}

function CustomerWorkspaceRequired() {
  return (
    <Card>
      <CardHeader>
        <CardTitle asChild><h2>Switch to a customer workspace</h2></CardTitle>
        <CardDescription>
          User API keys are bound to customer-workspace memberships. Platform operators can use
          the Credentials mode in Platform operations while the Administration Organization is active.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
