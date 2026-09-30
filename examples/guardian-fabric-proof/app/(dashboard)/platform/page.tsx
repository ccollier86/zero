'use client';

import {
  AdministrationScopeGate,
  ControlPlaneAuditViewer,
  PlatformAdministrationManagement,
  PlatformApiKeyManagement,
  PlatformTenantManagement,
} from '@zero/framework/components/auth';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@zero/framework/components/ui/card';
import { PlatformUserManagement } from '@zero/framework/react';

export const meta = {
  title: 'Platform operations | Guardian + Fabric Proof',
  description: 'Administration Organization controls for people, tenants, API keys, and audit.',
};

/** Presentation gate for the protected scope; every component reauthorizes server-side. */
export default function PlatformPage() {
  return (
    <AdministrationScopeGate fallback={<AdministrationScopeRequired />}>
      <div className="grid gap-6">
        <PlatformAdministrationManagement />
        <section className="grid gap-3" aria-labelledby="platform-identities-heading">
          <div>
            <h2 id="platform-identities-heading" className="text-lg font-semibold">
              Platform identities
            </h2>
            <p className="text-sm text-muted-foreground">
              Create or activate an account here before assigning it as a new customer
              workspace owner.
            </p>
          </div>
          <PlatformUserManagement className="h-[42rem] min-h-[32rem]" />
        </section>
        <PlatformTenantManagement />
        <PlatformApiKeyManagement
          title="Customer API key directory"
          description="Review and revoke customer-workspace credentials within your projected platform capabilities."
          pageSize={20}
        />
        <ControlPlaneAuditViewer
          scope="platform"
          title="Platform authorization audit"
          description="Bounded Guardian control-plane events visible from the Administration Organization."
        />
      </div>
    </AdministrationScopeGate>
  );
}

function AdministrationScopeRequired() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Administration Organization required</CardTitle>
        <CardDescription>
          Platform controls are shown only while your live session is bound to the protected Administration Organization.
          The server independently authorizes every list and mutation.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
