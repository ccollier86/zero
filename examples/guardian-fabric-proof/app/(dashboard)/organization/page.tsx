'use client';

import {
  ControlPlaneAuditViewer,
  TenantGate,
  TenantOnboardingManagement,
} from '@zero/framework/components/auth';
import { PlatformUserManagement } from '@zero/framework/react';
import { useRouter } from '@zero/framework/react/hooks';

import { ControlPlaneTabs } from '../../components/control-plane-tabs';

export const meta = {
  title: 'Members & access | Guardian + Fabric Proof',
  description: 'Adaptive people and access controls for the active customer workspace.',
};

/** Customer-workspace management composed entirely from Guardian controls. */
export default function OrganizationPage() {
  const router = useRouter();
  return (
    <TenantGate tenantKind="organization" fallback={<CustomerWorkspaceRequired />}>
      <ControlPlaneTabs
        defaultValue="people"
        tabs={[
          {
            id: 'people',
            label: 'People',
            description: 'Manage workspace membership, roles, effective access, and focused invitations.',
            content: (
              <PlatformUserManagement
                className="h-[calc(100svh-13rem)] min-h-[36rem]"
                onActorSessionInvalidated={() => router.replace('/login')}
              />
            ),
          },
          {
            id: 'onboarding',
            label: 'Onboarding',
            description: 'Review retained access requests and the complete invitation/domain workflow.',
            content: (
              <TenantOnboardingManagement
                title="Workspace onboarding"
                description="Review retained workspace access requests and advanced onboarding policy."
              />
            ),
          },
          {
            id: 'activity',
            label: 'Activity',
            description: 'Inspect the bounded authorization history for this workspace.',
            content: (
              <ControlPlaneAuditViewer
                scope="tenant"
                title="Workspace authorization audit"
                description="Guardian events visible to your current tenant-scoped authority."
              />
            ),
          },
        ]}
      />
    </TenantGate>
  );
}

function CustomerWorkspaceRequired() {
  return (
    <div className="rounded-lg border border-dashed bg-background p-6">
      <h2 className="font-semibold">Switch to a customer workspace</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Choose a customer workspace to manage its people and access.
      </p>
    </div>
  );
}
