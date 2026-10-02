'use client';

import * as React from 'react';

import { Badge } from '@zero/framework/components/ui/badge';
import { Button } from '@zero/framework/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@zero/framework/components/ui/card';
import { Check, CircleX, Pause, Play, RotateCw } from '@zero/framework/icons';
import { toast } from '@zero/framework/react';
import {
  useAuth,
  useWorkflowRun,
  useWorkflowTopology,
} from '@zero/framework/react/hooks';

import { TORRENT_PROOF_WORKFLOW } from '../../shared/torrent-proof';

export interface TorrentRunMonitorProps {
  readonly instanceId: string | null;
}

/** Live, payload-safe view of one selected Torrent run. */
export function TorrentRunMonitor({ instanceId }: TorrentRunMonitorProps) {
  const auth = useAuth();
  const run = useWorkflowRun(TORRENT_PROOF_WORKFLOW, { instanceId });
  const topology = useWorkflowTopology(instanceId);
  const openInteraction = run.interactions.find((interaction) => interaction.status === 'open');
  const busy = run.actionPending;
  const active = run.instance?.status === 'running' || run.instance?.status === 'pending';
  const cancellable = active || run.isPaused;
  const canRespond = run.instance?.started_by === auth.user?.userId;

  async function perform(label: string, operation: () => Promise<unknown>) {
    try {
      await operation();
      toast.success(label);
    } catch (cause) {
      toast.error(errorMessage(cause, `${label} failed.`));
    }
  }

  async function answer(approved: boolean) {
    if (!openInteraction) return;
    await perform(
      approved ? 'Review approved.' : 'Review declined.',
      async () => {
        const result = await run.submitResponse(
          openInteraction.interaction_id,
          { approved },
          { channel: 'proof-web' },
        );
        if (result.outcome === 'rejected') {
          throw new Error(result.publicMessage ?? 'The response was rejected.');
        }
      },
    );
  }

  if (!instanceId) {
    return (
      <Card className="grid min-h-[34rem] place-items-center border-dashed">
        <CardContent className="max-w-md space-y-2 text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-full bg-primary/10 text-primary">
            <Play className="size-5" aria-hidden="true" />
          </span>
          <h2 className="font-semibold">No Torrent run selected</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Start a review or choose an owned run to inspect its live graph and interaction.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="min-w-0" aria-busy={busy || topology.isLoading}>
      <CardHeader className="gap-4 border-b border-border/70">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle asChild><h2>Live run</h2></CardTitle>
              <StatusBadge status={run.instance?.status ?? 'loading'} />
              {run.isWaitingForInput ? <Badge variant="warning">Needs a response</Badge> : null}
            </div>
            <CardDescription className="break-all font-mono text-xs">
              {instanceId}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {run.isPaused ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => { void perform('Run resumed.', run.resume); }}
              >
                <Play className="size-3.5" aria-hidden="true" />
                Resume
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || !active}
                onClick={() => { void perform('Run paused.', run.pause); }}
              >
                <Pause className="size-3.5" aria-hidden="true" />
                Pause
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={busy || !cancellable}
              onClick={() => { void perform('Run cancelled.', run.cancel); }}
            >
              <CircleX className="size-3.5" aria-hidden="true" />
              Cancel
            </Button>
          </div>
        </div>
        <ProgressSummary
          completed={run.progress.completedSteps}
          total={run.progress.totalSteps}
          percent={run.progress.percent}
        />
      </CardHeader>

      <CardContent className="space-y-5 p-5">
        {openInteraction ? (
          <section className="rounded-lg border border-warning/35 bg-warning/5 p-4" aria-labelledby="torrent-response-heading">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 id="torrent-response-heading" className="font-medium">
                  {openInteraction.safe_label}
                </h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  The starter-only authority policy will accept one response. Approve to create
                  the task in this tenant file, or decline to complete without an app-data write.
                </p>
              </div>
              {canRespond ? (
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy || run.isPaused}
                    onClick={() => { void answer(false); }}
                  >
                    <CircleX className="size-4" aria-hidden="true" />
                    Decline
                  </Button>
                  <Button
                    type="button"
                    disabled={busy || run.isPaused}
                    onClick={() => { void answer(true); }}
                  >
                    <Check className="size-4" aria-hidden="true" />
                    Approve
                  </Button>
                </div>
              ) : (
                <Badge variant="outline" className="shrink-0">Starter response required</Badge>
              )}
            </div>
          </section>
        ) : null}

        {run.isComplete ? (
          <div className="flex flex-col gap-3 rounded-lg border border-success/30 bg-success/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-medium text-success">Run completed</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Open the task board to verify whether the approved branch arrived over the tenant Sync plane.
              </p>
            </div>
            <Button asChild size="sm" variant="outline"><a href="/tasks">Open realtime tasks</a></Button>
          </div>
        ) : null}

        <section className="space-y-3" aria-labelledby="torrent-topology-heading">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 id="torrent-topology-heading" className="font-medium">Pinned topology</h3>
              <p className="text-sm text-muted-foreground">
                Safe node identities from the immutable v1 definition, joined to live step state.
              </p>
            </div>
            {topology.error ? (
              <Button type="button" size="sm" variant="outline" onClick={topology.reload}>
                <RotateCw className="size-3.5" aria-hidden="true" />
                Retry
              </Button>
            ) : null}
          </div>

          {topology.isLoading ? (
            <div className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">
              Loading the presentation-safe workflow graph…
            </div>
          ) : topology.error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
              {errorMessage(topology.error, 'The workflow topology could not be loaded.')}
            </div>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {topology.topology?.nodes.map((node, index) => {
                const step = run.steps.find((candidate) => candidate.node_path === node.path);
                return (
                  <div key={node.path} className="rounded-md border border-border bg-muted/20 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          <span className="mr-2 text-xs text-muted-foreground">{index + 1}</span>
                          {node.label}
                        </p>
                        <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                          {node.path}
                        </p>
                      </div>
                      <Badge variant="outline">{step?.status ?? node.kind}</Badge>
                    </div>
                    {node.branchKey ? (
                      <p className="mt-2 text-xs text-muted-foreground">Branch: {node.branchKey}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

function ProgressSummary({
  completed,
  total,
  percent,
}: {
  completed: number;
  total: number;
  percent: number;
}) {
  return (
    <div className="space-y-1.5" aria-label={`${completed} of ${total} workflow nodes complete`}>
      <div className="flex justify-between gap-3 text-xs text-muted-foreground">
        <span>{completed} of {total || '—'} root nodes complete</span>
        <span>{percent}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant={status === 'failed' || status === 'cancelled'
        ? 'destructive'
        : status === 'paused' ? 'warning' : 'secondary'}
      className={status === 'completed' ? 'text-success' : undefined}
    >
      {status}
    </Badge>
  );
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
