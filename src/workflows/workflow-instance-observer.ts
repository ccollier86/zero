/**
 * Committed workflow-instance change boundary for trusted runtime adapters.
 *
 * Consumers receive only committed rows. Optional replay lets an adapter
 * reconcile durable projections after process restart without inventing a
 * second scheduler or depending on transient process memory.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import type { Change } from '../sync/types';
import type { WorkflowInstanceRecord, WorkflowStatus } from './types';

export interface WorkflowInstanceTransition {
  readonly instance: WorkflowInstanceRecord;
  readonly previousStatus: WorkflowStatus | null;
  readonly source: 'change' | 'replay';
}

export type WorkflowInstanceTransitionListener = (
  transition: WorkflowInstanceTransition,
) => void;

export interface ObserveWorkflowInstancesOptions {
  /** Reconcile existing matching rows before returning from subscribe. */
  readonly replay?: boolean;
  /** Exact code-owned workflow names admitted to this observer. */
  readonly names?: readonly string[];
}

interface Subscription {
  readonly listener: WorkflowInstanceTransitionListener;
  readonly names: ReadonlySet<string> | null;
}

/** One app-local fan-out over ReactiveDB's committed workflow row stream. */
export class WorkflowInstanceObserver {
  private readonly subscriptions = new Set<Subscription>();
  private readonly unsubscribe: () => void;
  private disposed = false;

  constructor(private readonly db: ReactiveDB) {
    this.unsubscribe = db.onChange((change) => this.onChange(change));
  }

  subscribe(
    listener: WorkflowInstanceTransitionListener,
    options: ObserveWorkflowInstancesOptions = {},
  ): () => void {
    if (this.disposed) throw new Error('Workflow instance observer is disposed');
    const names = normalizeNames(options.names);
    const subscription = { listener, names } satisfies Subscription;
    this.subscriptions.add(subscription);
    if (options.replay === true) {
      for (const instance of this.listExisting(names)) {
        listener({ instance, previousStatus: null, source: 'replay' });
      }
    }
    return () => this.subscriptions.delete(subscription);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.subscriptions.clear();
  }

  private onChange(change: Change): void {
    if (change.table !== 'workflow_instances' || change.row === null) return;
    const instance = change.row as unknown as WorkflowInstanceRecord;
    if (typeof instance.instance_id !== 'string' || typeof instance.name !== 'string') return;
    const previousStatus = workflowStatus(change.previousRow?.status) ?? null;
    for (const subscription of [...this.subscriptions]) {
      if (subscription.names !== null && !subscription.names.has(instance.name)) continue;
      subscription.listener({ instance, previousStatus, source: 'change' });
    }
  }

  private listExisting(names: ReadonlySet<string> | null): WorkflowInstanceRecord[] {
    if (names !== null && names.size === 0) return [];
    if (names === null) {
      return this.db.prepare(`SELECT * FROM workflow_instances
        ORDER BY created_at ASC, rowid ASC`).all() as WorkflowInstanceRecord[];
    }
    const values = [...names];
    const placeholders = values.map(() => '?').join(', ');
    return this.db.prepare(`SELECT * FROM workflow_instances
      WHERE name IN (${placeholders})
      ORDER BY created_at ASC, rowid ASC`).all(...values) as WorkflowInstanceRecord[];
  }
}

function normalizeNames(input: readonly string[] | undefined): ReadonlySet<string> | null {
  if (input === undefined) return null;
  return new Set(input.filter((name) => typeof name === 'string' && name.length > 0));
}

function workflowStatus(value: unknown): WorkflowStatus | undefined {
  return typeof value === 'string' && [
    'pending', 'running', 'completed', 'failed', 'cancelled', 'paused',
  ].includes(value)
    ? value as WorkflowStatus
    : undefined;
}
