'use client';

import {
  SelfApiKeyManagement,
  TenantGate,
} from '@zero/framework/components/auth';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@zero/framework/components/ui/card';

export const meta = {
  title: 'Security | Guardian + Fabric Proof',
  description: 'Manage API keys for the current customer-workspace authority.',
};

/** Session-only management UI for finite, user-bound automation credentials. */
export default function SecurityPage() {
  return (
    <TenantGate tenantKind="organization" fallback={<CustomerWorkspaceRequired />}>
      <SelfApiKeyManagement
        title="Workspace automation credentials"
        description="Issue finite API keys for your current customer workspace. The raw secret is shown once."
        pageSize={20}
      />
    </TenantGate>
  );
}

function CustomerWorkspaceRequired() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Switch to a customer workspace</CardTitle>
        <CardDescription>
          User API keys are bound to customer-workspace memberships. Platform operators manage
          customer credentials from Platform operations while using the Administration Organization.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
