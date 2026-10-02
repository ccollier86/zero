'use client';

import * as React from 'react';

import { PermissionGate } from '@zero/framework/components/auth';
import { Badge } from '@zero/framework/components/ui/badge';
import { Button } from '@zero/framework/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@zero/framework/components/ui/card';
import { Input } from '@zero/framework/components/ui/input';
import { Check, Play, Radio } from '@zero/framework/icons';
import { toast } from '@zero/framework/react';
import {
  useAuth,
  useWorkflowActions,
  useWorkflowList,
} from '@zero/framework/react/hooks';

import { TORRENT_PROOF_WORKFLOW } from '../../shared/torrent-proof';
import { TorrentRunMonitor } from './torrent-run-monitor';

/** Starts, selects, and live-monitors the proof workflow in the active workspace. */
export function TorrentProofPanel() {
  const auth = useAuth();
  const actions = useWorkflowActions();
  const runs = useWorkflowList({ name: TORRENT_PROOF_WORKFLOW });
  const [title, setTitle] = React.useState('Review the launch checklist');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [starting, setStarting] = React.useState(false);
  const scopeId = auth.activeTenant?.tenantId ?? null;

  React.useEffect(() => {
    setSelectedId(null);
  }, [scopeId]);

  React.useEffect(() => {
    if (!selectedId && runs.instances[0]) {
      setSelectedId(runs.instances[0].instance_id);
    }
  }, [runs.instances, selectedId]);

  async function startReview(event: React.FormEvent) {
    event.preventDefault();
    const normalizedTitle = title.trim();
    if (!normalizedTitle || starting) return;
    setStarting(true);
    try {
      const instanceId = await actions.start(TORRENT_PROOF_WORKFLOW, {
        taskId: crypto.randomUUID(),
        title: normalizedTitle,
      }, { version: 1 });
      setSelectedId(instanceId);
      setTitle('Review another tenant task');
      toast.success('Torrent review started.');
    } catch (cause) {
      toast.error(errorMessage(cause, 'The Torrent review could not be started.'));
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="space-y-5" data-testid="torrent-proof-panel">
      <Card className="overflow-hidden border-primary/20 bg-[linear-gradient(135deg,color-mix(in_oklch,var(--primary)_9%,var(--card)),var(--card)_64%)]">
        <CardHeader className="gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <Badge variant="outline" className="w-fit gap-1.5 bg-background/70">
              <Radio className="size-3.5 text-primary" aria-hidden="true" />
              Live Torrent proof
            </Badge>
            <div>
              <CardTitle asChild><h2>Review, branch, and write across both data planes</h2></CardTitle>
              <CardDescription className="mt-1 max-w-3xl leading-6">
                Torrent keeps the run and human interaction in Zero&apos;s system database. An
                approval invokes a scope-closed activity that writes one actor-owned task into
                this workspace&apos;s Fabric database.
              </CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">Version 1 pinned</Badge>
            <Badge variant="secondary">Starter-only response</Badge>
            <Badge variant="secondary">Tenant-scoped write</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <PermissionGate
            permission="tasks:create"
            loadingFallback={<p className="text-sm text-muted-foreground">Checking workflow authority…</p>}
            fallback={(
              <div className="rounded-md border border-border bg-muted/35 px-4 py-3 text-sm text-muted-foreground">
                Your current role may inspect owned runs but cannot start this task-creation
                workflow. Assign the contributor or manager role to exercise the start path.
              </div>
            )}
          >
            <form className="flex flex-col gap-2 sm:flex-row" onSubmit={startReview}>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                aria-label="Task proposed for Torrent review"
                placeholder="Task proposed for review"
                maxLength={200}
                disabled={starting}
              />
              <Button type="submit" disabled={starting || !title.trim()}>
                <Play className="size-4" aria-hidden="true" />
                {starting ? 'Starting…' : 'Start review'}
              </Button>
            </form>
          </PermissionGate>
        </CardContent>
      </Card>

      <div className="grid min-h-[34rem] gap-5 xl:grid-cols-[minmax(15rem,0.32fr)_minmax(0,1fr)]">
        <RunDirectory
          instanceIds={runs.instances.map((instance) => ({
            id: instance.instance_id,
            status: instance.status,
            createdAt: instance.created_at,
          }))}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <TorrentRunMonitor instanceId={selectedId} />
      </div>
    </div>
  );
}

function RunDirectory({
  instanceIds,
  selectedId,
  onSelect,
}: {
  instanceIds: readonly {
    id: string;
    status: string;
    createdAt: string;
  }[];
  selectedId: string | null;
  onSelect(instanceId: string): void;
}) {
  return (
    <Card className="min-h-0">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle asChild><h2>Visible runs</h2></CardTitle>
          <Badge variant="secondary">{instanceIds.length}</Badge>
        </div>
        <CardDescription>
          Owner-scoped for members and scope-wide for authorized workflow managers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {instanceIds.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            Start a review to create the first durable run.
          </div>
        ) : instanceIds.slice(0, 12).map((run) => (
          <Button
            key={run.id}
            type="button"
            variant="ghost"
            className={`h-auto w-full justify-start whitespace-normal rounded-md border px-3 py-3 text-left transition-colors ${
              selectedId === run.id
                ? 'border-primary/45 bg-primary/8'
                : 'border-border bg-background hover:bg-muted/45'
            }`}
            aria-pressed={selectedId === run.id}
            onClick={() => onSelect(run.id)}
          >
            <span className="w-full">
              <span className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-xs">{shortId(run.id)}</span>
                <RunStatus status={run.status} />
              </span>
              <span className="mt-1.5 block text-xs font-normal text-muted-foreground">
                {formatRunTime(run.createdAt)}
              </span>
            </span>
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}

function RunStatus({ status }: { status: string }) {
  const complete = status === 'completed';
  return (
    <Badge
      variant={status === 'failed' || status === 'cancelled'
        ? 'destructive'
        : status === 'paused' ? 'warning' : 'secondary'}
      className={complete ? 'gap-1 text-success' : undefined}
    >
      {complete ? <Check className="size-3" aria-hidden="true" /> : null}
      {status}
    </Badge>
  );
}

export function shortId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-5)}` : value;
}

export function formatRunTime(value: string): string {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? 'Timestamp unavailable' : timestamp.toLocaleString();
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
