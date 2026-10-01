'use client';

import {
  ControlPlaneAuditViewer,
  TenantGate,
  TenantMemberManagement,
  TenantOnboardingManagement,
} from '@zero/framework/components/auth';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@zero/framework/components/ui/card';
import { useRouter } from '@zero/framework/react/hooks';

import { WorkspaceMemberApiKeys } from '../../components/workspace-member-api-keys';

export const meta = {
  title: 'Members & access | Guardian + Fabric Proof',
  description: 'Manage the active customer workspace and review its authorization audit.',
};

/** Customer-workspace management composed entirely from Guardian controls. */
export default function OrganizationPage() {
  const router = useRouter();
  return (
    <TenantGate tenantKind="organization" fallback={<CustomerWorkspaceRequired />}>
      <div className="grid gap-6">
        <TenantMemberManagement
          title="Workspace members"
          description="Manage membership state and assign only roles your current authority may grant."
          onActorSessionInvalidated={() => router.replace('/login')}
        />
        <WorkspaceMemberApiKeys />
        <TenantOnboardingManagement
          title="Workspace onboarding"
          description="Invite exact email addresses with one-time tokens and review retained workspace access requests."
        />
        <ControlPlaneAuditViewer
          scope="tenant"
          title="Workspace authorization audit"
          description="Guardian events visible to your current tenant-scoped authority."
        />
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
          Customer membership and onboarding controls are separate from the protected Administration Organization.
          Choose a customer workspace above, or create one from the workspace menu.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
