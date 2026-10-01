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
 * Public runtime tables use no `_` prefix for authorized real-time Sync.
 * Definitions and underscore-prefixed coordination tables remain server-only.
 */

import type { TSchema } from 'elysia';
import type { ClientTableDef } from '../schema/define-schema';

/** Registration-time ceiling for one step's total handler attempt budget. */
export const MAX_WORKFLOW_ATTEMPTS = 1_000;

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
  /** Total attempt budget, including the first attempt (default 3) */
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

/**
 * Declarative role requirement for one workflow-definition capability.
 *
 * `authenticated` preserves the historical behavior. `admin` limits the
 * capability to a global platform administrator. An array names the accepted
 * application roles. Global platform administrators always bypass the rule.
 */
export type WorkflowAccessRule = 'authenticated' | 'admin' | readonly string[];

export interface WorkflowDefinitionAccessPolicy {
  /** Who may start a new instance (default `authenticated`). */
  start?: WorkflowAccessRule;
  /** Who may discover definition metadata (defaults to the `start` rule). */
  inspect?: WorkflowAccessRule;
}

export interface WorkflowDefinition {
  name: string;
  steps: StepDefinition[];
  inputSchema?: TSchema;
  /** Optional HTTP authority policy. Trusted WorkflowService calls bypass it. */
  access?: WorkflowDefinitionAccessPolicy;
}

// ─── Runtime Context ─────────────────────────────────

export interface StepContext<TInput = unknown> {
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
  /** Unique token for this physical handler invocation (always set by Zero). */
  attemptId?: string;
  /** Stable key for idempotent external effects by this logical step (always set by Zero). */
  idempotencyKey?: string;
  /** Cooperative cancellation signal (always set by Zero at runtime). */
  signal?: AbortSignal;
  /** Event data if step was waiting for an event */
  waitEvent?: { id: string; name: string; payload: unknown };
}

export type StepHandler = (ctx: StepContext) => Promise<unknown>;

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
  definition_id: string;
  name: string;
  status: WorkflowStatus;
  current_step: number;
  input: string | null;
  output: string | null;
  error: string | null;
  started_by: string | null;
  steps_json: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

/** Runtime instance shape exposed through HTTP and Sync. */
export type WorkflowClientInstanceRecord = Omit<WorkflowInstanceRecord, 'steps_json'>;

export interface WorkflowStepRecord {
  step_id: string;
  instance_id: string;
  step_index: number;
  /** Human-readable step label for new rows; 1.3 rows may contain the handler key. */
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

/** Runtime step shape exposed through HTTP and Sync. */
export type WorkflowClientStepRecord = Omit<WorkflowStepRecord, 'wait_event'>;

export interface WorkflowEventRecord {
  event_id: string;
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
  workflow_instances: {
    _pk: 'instance_id',
    instance_id: 'text',
    definition_id: 'text',
    name: 'text',
    status: 'text',
    current_step: 'integer',
    input: 'text',
    output: 'text',
    error: 'text',
    started_by: 'text',
    created_at: 'text',
    updated_at: 'text',
    completed_at: 'text',
  },
  workflow_steps: {
    _pk: 'step_id',
    step_id: 'text',
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
    timeout_at: 'text',
    started_at: 'text',
    completed_at: 'text',
    created_at: 'text',
  },
  workflow_events: {
    _pk: 'event_id',
    event_id: 'text',
    instance_id: 'text',
    event_name: 'text',
    payload: 'text',
    sent_by: 'text',
    created_at: 'text',
  },
};

/**
 * Every workflow table protected by the server boundary, including tables
 * deliberately absent from the browser client descriptor.
 */
export const WORKFLOW_SERVER_TABLE_NAMES: ReadonlySet<string> = new Set([
  'workflow_definitions',
  ...Object.keys(WORKFLOW_TABLES),
]);
