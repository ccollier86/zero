'use client';

import type { ConnectionHealth } from '@zero/framework/react/hooks';
import type {
  DataRealmReadinessUiStatus,
} from '@zero/framework/react/hooks';
import { Layers, Lock, Wifi } from '@zero/framework/icons';
import { Badge } from '@zero/framework/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@zero/framework/components/ui/card';

type StatusTone = 'ready' | 'pending' | 'neutral' | 'attention';

export interface ProofStatusGridProps {
  authorizationReady: boolean;
  authorizationStatus: string;
  tenantKind: 'administration' | 'organization' | undefined;
  realmStatus?: DataRealmReadinessUiStatus;
  pendingRealmOperations?: number;
  connection: ConnectionHealth;
}

/** Safe runtime signals for Guardian, Fabric, and ReactiveDB. */
export function ProofStatusGrid({
  authorizationReady,
  authorizationStatus,
  tenantKind,
  realmStatus,
  pendingRealmOperations = 0,
  connection,
}: ProofStatusGridProps) {
  const guardian = guardianStatus(authorizationReady, authorizationStatus);
  const fabric = fabricStatus(tenantKind, realmStatus, pendingRealmOperations);
  const realtime = realtimeStatus(tenantKind, connection);
  const cards = [
    {
      id: 'guardian',
      icon: Lock,
      title: 'Guardian authority',
      ...guardian,
    },
    {
      id: 'fabric',
      icon: Layers,
      title: 'Fabric data realm',
      ...fabric,
    },
    {
      id: 'reactive-db',
      icon: Wifi,
      title: 'ReactiveDB Sync',
      ...realtime,
    },
  ] as const;

  return (
    <section className="grid gap-3 md:grid-cols-3" aria-label="Live platform status">
      {cards.map(({ id, icon: Icon, title, label, description, tone }) => (
        <Card key={id} data-testid={`proof-status-${id}`}>
          <CardHeader className="gap-3 pb-3">
            <div className="flex items-start justify-between gap-3">
              <span className="grid size-9 place-items-center rounded-md bg-muted text-muted-foreground">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <Badge
                variant={tone === 'pending' ? 'warning' : tone === 'attention' ? 'destructive' : 'outline'}
                className={toneClassName(tone)}
                role="status"
              >
                {label}
              </Badge>
            </div>
            <CardTitle asChild><h2>{title}</h2></CardTitle>
          </CardHeader>
          <CardContent>
            <CardDescription className="leading-6">{description}</CardDescription>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

export function realtimeStatus(
  tenantKind: ProofStatusGridProps['tenantKind'],
  connection: Pick<ConnectionHealth, 'connected' | 'offline' | 'pendingMutations' | 'lastSeq'>,
) {
  if (tenantKind === undefined) return {
    label: 'Restoring scope',
    description: 'Realtime status stays neutral until Guardian restores the active scope.',
    tone: 'pending' as const,
  };
  if (tenantKind === 'administration') return {
    label: 'Customer scope only',
    description: 'Switch to a customer workspace to open its tenant-scoped Sync stream.',
    tone: 'neutral' as const,
  };
  return connectionStatus(connection);
}

/** Pure connection projection used by UI contract tests. */
export function connectionStatus(
  connection: Pick<ConnectionHealth, 'connected' | 'offline' | 'pendingMutations' | 'lastSeq'>,
): { label: string; description: string; tone: StatusTone } {
  if (connection.offline) {
    return {
      label: 'Offline',
      description: `${connection.pendingMutations} local mutation${connection.pendingMutations === 1 ? '' : 's'} waiting for a connection.`,
      tone: 'attention',
    };
  }
  if (!connection.connected) {
    return {
      label: connection.lastSeq > 0 ? 'Reconnecting' : 'Connecting',
      description: connection.lastSeq > 0
        ? `The last committed sequence is ${connection.lastSeq}; the client is restoring its stream.`
        : 'The client is opening its tenant-scoped realtime stream.',
      tone: 'pending',
    };
  }
  return {
    label: 'Live',
    description: connection.pendingMutations > 0
      ? `${connection.pendingMutations} optimistic mutation${connection.pendingMutations === 1 ? '' : 's'} awaiting acknowledgement.`
      : `Connected with committed sequence ${connection.lastSeq}.`,
    tone: 'ready',
  };
}

function guardianStatus(ready: boolean, status: string) {
  if (ready) return {
    label: 'Authorized',
    description: 'Live roles and permissions are projected for this exact identity and scope.',
    tone: 'ready' as const,
  };
  if (status === 'error' || status === 'revoked') return {
    label: 'Attention',
    description: 'The authorization projection is unavailable or no longer current.',
    tone: 'attention' as const,
  };
  return {
    label: 'Restoring',
    description: 'Guardian is restoring the current scope before protected controls become active.',
    tone: 'pending' as const,
  };
}

export function fabricStatus(
  tenantKind: ProofStatusGridProps['tenantKind'],
  status: DataRealmReadinessUiStatus | undefined,
  pendingOperations: number,
) {
  if (tenantKind === undefined) return {
    label: 'Restoring scope',
    description: 'Fabric waits for a current Guardian scope before resolving any data realm.',
    tone: 'pending' as const,
  };
  if (tenantKind !== 'organization') return {
    label: 'Customer scope only',
    description: 'Switch to a customer workspace to bind a physical application database.',
    tone: 'neutral' as const,
  };
  if (status === 'ready') return {
    label: 'Ready',
    description: 'The active workspace schema and identity anchors are ready for tenant data.',
    tone: 'ready' as const,
  };
  if (status === 'failed' || status === 'error') return {
    label: 'Attention',
    description: 'The active data realm needs a safe retry or administrator attention.',
    tone: 'attention' as const,
  };
  if (status === 'loading' || status === undefined) return {
    label: 'Checking',
    description: 'Fabric is resolving readiness for the active customer workspace.',
    tone: 'pending' as const,
  };
  if (status === 'retrying') return {
    label: 'Retrying',
    description: 'Fabric is safely retrying setup for the active workspace data realm.',
    tone: 'pending' as const,
  };
  if (status === 'provisioning') return {
    label: 'Provisioning',
    description: pendingOperations > 0
      ? `${pendingOperations} setup operation${pendingOperations === 1 ? '' : 's'} remain before data access opens.`
      : 'Fabric is preparing the workspace data realm before data access opens.',
    tone: 'pending' as const,
  };
  if (status === 'not-required') return {
    label: 'Not required',
    description: 'The active scope does not require a provisioned Fabric data realm.',
    tone: 'neutral' as const,
  };
  return {
    label: 'Unavailable',
    description: 'Data-realm readiness is not available for the current session.',
    tone: 'attention' as const,
  };
}

function toneClassName(tone: StatusTone): string {
  if (tone === 'ready') return 'border-success/35 bg-success/10 text-foreground';
  if (tone === 'neutral') return 'text-muted-foreground';
  return '';
}
