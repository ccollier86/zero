/**
 * types.ts
 *
 * Part of: Workflows subsystem (types)
 *
 * Core types for the durable workflow engine. Workflows are multi-step
 * processes with durable state in SQLite. Steps execute sequentially
 * with I/O chaining, retries with exponential backoff, optional wait-for
 * events, and condition-based branching.
 *
 * Tables use NO `_` prefix so changes broadcast via the sync engine
 * for real-time workflow observability on the client.
 */

import type { TSchema } from 'elysia';
import type { ClientTableDef } from '../schema/define-schema';
import type { WorkflowExecutionIdentity } from './workflow-execution-authority';

// ─── Status Enums ────────────────────────────────────

export type WorkflowStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'paused';

export type StepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'waiting'
  | 'skipped';

// ─── Definitions ─────────────────────────────────────

export interface StepDefinition {
  /** Human-readable step name */
  name: string;
  /** Key in the handler registry */
  handler: string;
  /** Max retry attempts (default 3) */
  retries?: number;
  /** Base backoff in ms (default 1000), exponential with 5min cap */
  backoffMs?: number;
  /** Step timeout in ms — fails if exceeded */
  timeoutMs?: number;
  /** Event name to wait for before executing */
  waitFor?: string;
  /** Simple expression for branching — skip step if evaluates to false */
  condition?: string;
}

export interface WorkflowDefinition {
  name: string;
  steps: StepDefinition[];
  inputSchema?: TSchema;
}

// ─── Runtime Context ─────────────────────────────────

export interface StepContext<TInput = unknown, TServices = unknown> {
  /** Previous step's output (or workflow input for step 0) */
  input: TInput;
  /** Original workflow input */
  workflowInput: unknown;
  /** Workflow instance ID */
  instanceId: string;
  /** Current step index */
  stepIndex: number;
  /** Current retry attempt (0-based) */
  attempt: number;
  /** Event data if step was waiting for an event */
  waitEvent?: { name: string; payload: unknown };
  /** Immutable actor/system provenance and tenant-safe authorization scope. */
  execution: WorkflowExecutionIdentity;
  /** Request-equivalent, scope-closed services when the app installed a provider. */
  zero: TServices | null;
  /** Revalidate immediately before an app-owned external/security-sensitive effect. */
  assertCurrentAuthority(): void;
}

export type StepHandler<TInput = unknown, TServices = unknown> = (
  ctx: StepContext<TInput, TServices>,
) => Promise<unknown>;

// ─── Persisted Records ───────────────────────────────

export interface WorkflowDefinitionRecord {
  definition_id: string;
  name: string;
  version: number;
  steps_json: string;
  input_schema: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowInstanceRecord {
  instance_id: string;
  /** Null in single-tenant mode; tenant id for multi-tenant instances. */
  tenant_id: string | null;
  definition_id: string;
  name: string;
  status: WorkflowStatus;
  current_step: number;
  input: string | null;
  output: string | null;
  error: string | null;
  started_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface WorkflowStepRecord {
  step_id: string;
  /** Duplicated from the parent instance for direct Sync filtering. */
  tenant_id: string | null;
  instance_id: string;
  step_index: number;
  step_name: string;
  status: StepStatus;
  input: string | null;
  output: string | null;
  error: string | null;
  retries: number;
  max_retries: number;
  retry_at: string | null;
  wait_event: string | null;
  timeout_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface WorkflowEventRecord {
  event_id: string;
  /** Duplicated from the parent instance for direct Sync filtering. */
  tenant_id: string | null;
  instance_id: string;
  event_name: string;
  payload: string | null;
  sent_by: string | null;
  created_at: string;
}

// ─── Client Table Definitions ────────────────────────

/**
 * Spread into your client's `tables` config to enable workflow sync.
 * Auto-registered by the platform — apps don't need to import this manually.
 */
export const WORKFLOW_TABLES: Record<string, ClientTableDef> = {
  workflow_definitions: {
    _pk: 'definition_id',
    definition_id: 'text',
    name: 'text',
    version: 'integer',
    steps_json: 'text',
    input_schema: 'text',
    created_at: 'text',
    updated_at: 'text',
  },
  workflow_instances: {
    _pk: 'instance_id',
    instance_id: 'text',
    tenant_id: 'text',
    definition_id: 'text',
    name: 'text',
    status: 'text',
    current_step: 'integer',
    input: 'text',
    output: 'text',
    error: 'text',
    started_by: 'text',
    steps_json: 'text',
    created_at: 'text',
    updated_at: 'text',
    completed_at: 'text',
  },
  workflow_steps: {
    _pk: 'step_id',
    step_id: 'text',
    tenant_id: 'text',
    instance_id: 'text',
    step_index: 'integer',
    step_name: 'text',
    status: 'text',
    input: 'text',
    output: 'text',
    error: 'text',
    retries: 'integer',
    max_retries: 'integer',
    retry_at: 'text',
    wait_event: 'text',
    timeout_at: 'text',
    started_at: 'text',
    completed_at: 'text',
    created_at: 'text',
  },
  workflow_events: {
    _pk: 'event_id',
    event_id: 'text',
    tenant_id: 'text',
    instance_id: 'text',
    event_name: 'text',
    payload: 'text',
    sent_by: 'text',
    created_at: 'text',
  },
};
