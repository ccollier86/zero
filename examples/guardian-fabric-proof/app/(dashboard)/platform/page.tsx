'use client';

import {
  AdministrationScopeGate,
  ControlPlaneAuditViewer,
} from '@zero/framework/components/auth';
import { PlatformUserManagement } from '@zero/framework/react';
import { useRouter } from '@zero/framework/react/hooks';

import { ControlPlaneTabs } from '../../components/control-plane-tabs';
import { PlatformApiKeyControls } from '../../components/platform-api-key-controls';

export const meta = {
  title: 'Platform operations | Guardian + Fabric + Torrent Proof',
  description: 'Adaptive Administration Organization controls for access, credentials, and audit.',
};

/** Presentation gate for the protected scope; every component reauthorizes server-side. */
export default function PlatformPage() {
  const router = useRouter();
  return (
    <AdministrationScopeGate fallback={<AdministrationScopeRequired />}>
      <ControlPlaneTabs
        defaultValue="directory"
        tabs={[
          {
            id: 'directory',
            label: 'Directory',
            description: 'Manage Administration Organization people, global identities, and customer workspaces.',
            content: (
              <PlatformUserManagement
                className="h-[calc(100svh-13rem)] min-h-[36rem]"
                onActorSessionInvalidated={() => router.replace('/login')}
                onActorAuthorizationChanged={() => router.replace('/login')}
              />
            ),
          },
          {
            id: 'credentials',
            label: 'Credentials',
            description: 'Issue and review customer-member API keys under explicit platform authority.',
            content: <PlatformApiKeyControls />,
          },
          {
            id: 'activity',
            label: 'Activity',
            description: 'Inspect the bounded platform authorization and account-security trail.',
            content: (
              <ControlPlaneAuditViewer
                scope="platform"
                title="Platform authorization audit"
                description="Bounded Guardian control-plane events visible from the Administration Organization."
              />
            ),
          },
        ]}
      />
    </AdministrationScopeGate>
  );
}

function AdministrationScopeRequired() {
  return (
    <div className="rounded-lg border border-dashed bg-background p-6">
      <h2 className="font-semibold">Administration Organization required</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Switch to the protected Administration Organization to manage platform people and workspaces.
      </p>
    </div>
  );
}
