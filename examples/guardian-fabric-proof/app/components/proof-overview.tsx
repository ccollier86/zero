'use client';

import { DataRealmReadinessNotice } from '@zero/framework/components/auth';
import { Badge } from '@zero/framework/components/ui/badge';
import { Button } from '@zero/framework/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@zero/framework/components/ui/card';
import { ArrowRight, Check, Layers, Lock } from '@zero/framework/icons';
import {
  useAuth,
  useAuthorization,
  useConnectionHealth,
  useDataRealmReadiness,
} from '@zero/framework/react/hooks';

import { ProofAccessPanel } from './proof-access-panel';
import { ProofStatusGrid } from './proof-status-grid';

interface JourneyStep {
  readonly title: string;
  readonly description: string;
  readonly href: string;
  readonly action: string;
}

/** Scope-adaptive launchpad for exercising Guardian, Fabric, Torrent, and ReactiveDB. */
export function ProofOverview() {
  const auth = useAuth();
  const authorization = useAuthorization();
  const connection = useConnectionHealth();
  const tenantKind = auth.activeTenant?.kind;

  return (
    <div className="space-y-6" data-testid="guardian-fabric-proof-center">
      <Card className="overflow-hidden border-primary/20 bg-[linear-gradient(135deg,color-mix(in_oklch,var(--primary)_10%,var(--card)),var(--card)_60%)]">
        <CardContent className="grid gap-6 p-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="space-y-3">
            <Badge variant="outline" className="w-fit gap-1.5 bg-background/70">
              <Check className="size-3.5 text-success" aria-hidden="true" />
              Live integration proof
            </Badge>
            <div className="space-y-2">
              <h1 className="max-w-3xl text-2xl font-semibold tracking-tight sm:text-3xl">
                One authority model. One realtime experience. One physical database per customer workspace.
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
                This control center exposes the safe runtime state needed to test the complete
                Guardian, ReactiveDB Fabric, and Torrent path without leaking database filenames,
                workflow payloads, secrets, or internal actor identifiers.
              </p>
            </div>
          </div>
          {tenantKind ? (
            <Button asChild>
              <a href={tenantKind === 'administration' ? '/platform' : '/tasks'}>
                {tenantKind === 'administration' ? 'Open platform operations' : 'Open realtime tasks'}
                <ArrowRight className="size-4" aria-hidden="true" />
              </a>
            </Button>
          ) : (
            <Badge variant="warning" role="status">Restoring active scope…</Badge>
          )}
        </CardContent>
      </Card>

      {tenantKind === 'organization' ? (
        <CustomerRuntimeStatus
          authorizationReady={authorization.isReady}
          authorizationStatus={authorization.status}
          connection={connection}
        />
      ) : (
        <ProofStatusGrid
          authorizationReady={authorization.isReady}
          authorizationStatus={authorization.status}
          tenantKind={tenantKind}
          connection={connection}
        />
      )}

      <ProofAccessPanel />
      <ProofJourney tenantKind={tenantKind} />
      <StorageBoundary />
    </div>
  );
}

function CustomerRuntimeStatus({
  authorizationReady,
  authorizationStatus,
  connection,
}: {
  authorizationReady: boolean;
  authorizationStatus: string;
  connection: ReturnType<typeof useConnectionHealth>;
}) {
  const readiness = useDataRealmReadiness();
  return (
    <div className="space-y-3">
      <ProofStatusGrid
        authorizationReady={authorizationReady}
        authorizationStatus={authorizationStatus}
        tenantKind="organization"
        realmStatus={readiness.status}
        pendingRealmOperations={readiness.snapshot?.pendingOperations}
        connection={connection}
      />
      {!readiness.isReady ? (
        <DataRealmReadinessNotice
          readiness={readiness}
          provisioningTitle="Preparing this workspace database"
          provisioningDescription="Fabric is applying the realm schema and required identity anchors. This page will continue automatically."
        />
      ) : null}
    </div>
  );
}

function ProofJourney({
  tenantKind,
}: {
  tenantKind: 'administration' | 'organization' | undefined;
}) {
  if (tenantKind === undefined) {
    return (
      <Card aria-busy="true">
        <CardHeader>
          <CardTitle asChild><h2>Restoring the guided path</h2></CardTitle>
          <CardDescription>
            Scope-specific exercises remain hidden until Guardian restores the active tenant.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  const steps = tenantKind === 'administration' ? ADMINISTRATION_STEPS : CUSTOMER_STEPS;
  return (
    <section className="space-y-3" aria-labelledby="proof-journey-heading">
      <div>
        <h2 id="proof-journey-heading" className="text-lg font-semibold">Exercise the stack</h2>
        <p className="text-sm text-muted-foreground">
          Follow these scope-aware paths to verify the platform from the UI.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, index) => (
          <Card key={step.href} className="flex flex-col">
            <CardHeader className="flex-1">
              <Badge variant="secondary" className="mb-2 w-fit">Step {index + 1}</Badge>
              <CardTitle asChild><h3>{step.title}</h3></CardTitle>
              <CardDescription className="leading-6">{step.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline" className="w-full justify-between">
                <a href={step.href}>
                  {step.action}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </a>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function StorageBoundary() {
  const planes = [
    {
      title: 'System plane',
      description: 'Guardian identities, credentials, sessions, memberships, RBAC, audit, and provisioning state.',
      badge: 'Privileged',
    },
    {
      title: 'Application plane',
      description: 'A separate pinned app database, intentionally minimal in this all-tenant-data proof.',
      badge: 'Clean',
    },
    {
      title: 'Tenant plane',
      description: 'Tasks, ID-only identity anchors, Sync state, and receipts in one actor-owned SQLite file per customer workspace.',
      badge: 'Physically isolated',
    },
  ] as const;
  return (
    <Card data-testid="proof-storage-boundary">
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <Layers className="size-4" aria-hidden="true" />
          </span>
          <div>
            <CardTitle asChild><h2>Three explicit storage planes</h2></CardTitle>
            <CardDescription>
              Tenant selection comes from live Guardian authority; browser input never chooses a database.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-3">
        {planes.map((plane) => (
          <div key={plane.title} className="rounded-md border border-border bg-muted/25 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium">{plane.title}</h3>
              <Badge variant="outline">{plane.badge}</Badge>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{plane.description}</p>
          </div>
        ))}
        <p className="md:col-span-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Local identity anchors contain identifiers only. They preserve foreign-key integrity and never become an authorization source.
        </p>
      </CardContent>
    </Card>
  );
}

export const ADMINISTRATION_STEPS: readonly JourneyStep[] = Object.freeze([
  {
    title: 'Operate the platform',
    description: 'Manage administrators, identities, customer workspaces, credentials, and platform audit.',
    href: '/platform',
    action: 'Platform operations',
  },
  {
    title: 'Create a workspace',
    description: 'Provision a customer organization and activate its tenant-bound Guardian session.',
    href: '/workspaces/new',
    action: 'Create workspace',
  },
  {
    title: 'Request membership',
    description: 'Submit a retained, non-enumerating request to another workspace by slug.',
    href: '/request-access',
    action: 'Request access',
  },
]);

export const CUSTOMER_STEPS: readonly JourneyStep[] = Object.freeze([
  {
    title: 'Collaborate in realtime',
    description: 'Create and move actor-owned tasks while another browser receives live changes.',
    href: '/tasks',
    action: 'Open tasks',
  },
  {
    title: 'Orchestrate durably',
    description: 'Start a human review, watch the conditional graph live, and approve a tenant-scoped Fabric write.',
    href: '/workflows',
    action: 'Open Torrent lab',
  },
  {
    title: 'Exercise RBAC',
    description: 'Invite members, assign roles, review join requests, and inspect tenant audit events.',
    href: '/organization',
    action: 'Members & access',
  },
  {
    title: 'Use an API key',
    description: 'Issue, rotate, and revoke finite credentials bound to this exact membership.',
    href: '/security',
    action: 'Security',
  },
  {
    title: 'Prove isolation',
    description: 'Create another workspace, reuse task identifiers, and switch back without row leakage.',
    href: '/workspaces/new',
    action: 'Create workspace',
  },
]);
