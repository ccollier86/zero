'use client';

import { Check, CircleX, Lock, User } from '@zero/framework/icons';
import { Badge } from '@zero/framework/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@zero/framework/components/ui/card';
import { useAuth, useAuthorization } from '@zero/framework/react/hooks';

import {
  TASK_CAPABILITY_ORDER,
  TASK_PERMISSION_REGISTRY,
  TASK_ROLE_REGISTRY,
  type TaskRole,
} from '../../shared/task-access';

/** Current safe authority projection plus the exact task-role contract. */
export function ProofAccessPanel() {
  const auth = useAuth();
  const current = useAuthorization();
  const snapshot = current.authorization;
  if (!current.isReady || !snapshot) {
    const failed = current.status === 'error' || current.status === 'revoked';
    return (
      <Card data-testid="proof-current-authority" aria-busy={!failed}>
        <CardHeader>
          <CardTitle asChild>
            <h2>{failed ? 'Guardian authority unavailable' : 'Restoring Guardian authority'}</h2>
          </CardTitle>
          <CardDescription role="status" aria-live="polite">
            {failed
              ? 'The live authorization projection is unavailable. Protected server policy remains closed.'
              : 'Roles and permissions stay hidden until the active identity and scope are current.'}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const scope = snapshot.scope;
  const roles = scope?.roles ?? [];
  const permissions = new Set([
    ...(scope?.permissions ?? []),
    ...(snapshot.applicationScope?.permissions ?? []),
  ]);
  const displayName = [auth.user?.firstName, auth.user?.lastName].filter(Boolean).join(' ')
    || auth.user?.username
    || 'Current user';

  return (
    <section className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]" aria-label="Current Guardian access">
      <Card data-testid="proof-current-authority">
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
              <User className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <CardTitle asChild><h2>Current authority</h2></CardTitle>
              <CardDescription>
                Browser-safe hints for this session. Server policy remains authoritative.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <AuthorityDetail label="Identity" value={displayName} />
            <AuthorityDetail label="Workspace" value={auth.activeTenant?.name ?? 'Restoring…'} />
            <AuthorityDetail
              label="Scope"
              value={auth.activeTenant?.kind === 'administration'
                ? 'Administration Organization'
                : auth.activeTenant?.kind === 'organization' ? 'Customer workspace' : 'Restoring…'}
            />
            <AuthorityDetail label="Authorization" value={snapshot.profile.authorization} />
          </dl>
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {auth.activeTenant?.kind === 'administration'
                ? 'Administration Organization roles'
                : 'Live workspace roles'}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {roles.length > 0 ? roles.map((role) => (
                <Badge key={role} variant="secondary">{roleLabel(role)}</Badge>
              )) : (
                <span className="text-sm text-muted-foreground">No tenant roles projected.</span>
              )}
            </div>
          </div>
          {auth.activeTenant?.kind === 'organization' && snapshot.applicationScope ? (
            <AuthorityBadges
              label="Carried application roles"
              values={snapshot.applicationScope.roles}
              empty="No application roles projected."
            />
          ) : null}
          {scope?.membershipId ? (
            <p className="text-xs text-muted-foreground">
              Membership reference <code className="rounded bg-muted px-1.5 py-0.5">{shortId(scope.membershipId)}</code>
            </p>
          ) : null}
        </CardContent>
      </Card>

      {auth.activeTenant?.kind === 'administration' ? (
        <ApplicationAuthorityCard
          roles={snapshot.applicationScope?.roles ?? []}
          permissions={snapshot.applicationScope?.permissions ?? []}
        />
      ) : (
      <Card data-testid="proof-permission-matrix">
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
              <Lock className="size-4" aria-hidden="true" />
            </span>
            <div>
              <CardTitle asChild><h2>Task permission matrix</h2></CardTitle>
              <CardDescription>
                Declared capabilities evaluated across the current workspace and any carried
                application projection. The server still reauthorizes every operation.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border" aria-label="Task permissions">
            {TASK_CAPABILITY_ORDER.map((permission) => {
              const granted = permissions.has(permission);
              const definition = TASK_PERMISSION_REGISTRY[permission];
              return (
                <li key={permission} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  {granted ? (
                    <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                  ) : (
                    <CircleX className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{definition.label}</span>
                      <Badge
                        variant="outline"
                        className={granted
                          ? 'border-success/35 bg-success/10 text-foreground'
                          : 'text-muted-foreground'}
                      >
                        {granted ? 'Granted' : 'Not granted'}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{definition.description}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
      )}
    </section>
  );
}

function ApplicationAuthorityCard({
  roles,
  permissions,
}: {
  roles: readonly string[];
  permissions: readonly string[];
}) {
  return (
    <Card data-testid="proof-application-authority">
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <Lock className="size-4" aria-hidden="true" />
          </span>
          <div>
            <CardTitle asChild><h2>Application authority</h2></CardTitle>
            <CardDescription>
              Platform capabilities projected separately from the Administration Organization membership.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <AuthorityBadges label="Application roles" values={roles} empty="No application roles projected." />
        <AuthorityBadges
          label={`Application permissions (${permissions.length})`}
          values={permissions}
          empty="No application permissions projected."
        />
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground">
          Task permissions are intentionally not evaluated here. The task Resource also requires a
          customer-workspace tenant kind, so application authority cannot open a tenant data plane.
        </p>
      </CardContent>
    </Card>
  );
}

function AuthorityBadges({
  label,
  values,
  empty,
}: {
  label: string;
  values: readonly string[];
  empty: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {values.length > 0
          ? values.map((value) => <Badge key={value} variant="secondary">{value}</Badge>)
          : <span className="text-sm text-muted-foreground">{empty}</span>}
      </div>
    </div>
  );
}

function AuthorityDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate font-medium" title={value}>{value}</dd>
    </div>
  );
}

function roleLabel(role: string): string {
  return Object.hasOwn(TASK_ROLE_REGISTRY, role)
    ? TASK_ROLE_REGISTRY[role as TaskRole].label
    : role;
}

function shortId(value: string): string {
  return value.length <= 14 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}
