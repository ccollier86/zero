/**
 * types.ts
 *
 * Part of: Workflows subsystem (types)
 *
 * Core types for the durable workflow engine. Workflows are multi-step
 * processes with durable state in SQLite. Legacy sequential definitions and
 * versioned graph definitions share lifecycle, retry, interaction, fan-out,
 * scratch-memory, and live-projection contracts.
 *
 * Public runtime tables use no `_` prefix for authorized real-time Sync.
 * Definitions and underscore-prefixed coordination tables remain server-only.
 */

import type { TSchema } from 'elysia';
import type { ClientTableDef } from '../schema/define-schema';
import type { WorkflowExecutionIdentity } from './workflow-execution-authority';
import type {
  WorkflowInteractionRecord,
  WorkflowInteractionStatus,
} from './workflow-interaction-records';
import type { WorkflowMemoryContext } from './workflow-memory-context';

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
 * capability to an administrator of the workflow's current application or
 * tenant scope. An array names accepted live roles in that same scope.
 * A global users.role value never grants tenant authority by itself.
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
  /** Mutually exclusive graph authoring formats are accepted by WorkflowRegistry. */
  flow?: never;
  graph?: never;
  /** Immutable publication belongs to flow/graph definitions. */
  version?: never;
  /** Immutable publication belongs to flow/graph definitions. */
  activate?: never;
  inputSchema?: TSchema;
  /** Optional HTTP authority policy. Trusted WorkflowService calls bypass it. */
  access?: WorkflowDefinitionAccessPolicy;
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
  /** Unique token for this physical handler invocation (always set by Zero). */
  attemptId?: string;
  /** Stable key for idempotent external effects by this logical step (always set by Zero). */
  idempotencyKey?: string;
  /** Cooperative cancellation signal (always set by Zero at runtime). */
  signal?: AbortSignal;
  /** Event data if step was waiting for an event */
  waitEvent?: { id: string; name: string; payload: unknown };
  /** Immutable actor/system provenance and tenant-safe authorization scope. */
  execution: WorkflowExecutionIdentity;
  /** Request-equivalent, scope-closed services when the app installed a provider. */
  zero: TServices | null;
  /** Revalidate immediately before an app-owned external/security-sensitive effect. */
  assertCurrentAuthority(): void;
  /** Attempt-local durable scratchpad; staged writes commit only with success. */
  memory?: WorkflowMemoryContext;
  /** Current fan-out item for an each activity. */
  item?: { value: unknown; index: number; key: string };
  /** Public interaction metadata for delivery or validation activities. */
  interaction?: WorkflowInteractionRecord;
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
  steps_json: string | null;
  definition_version_id?: string | null;
  definition_version?: number | null;
  graph_json?: string | null;
  graph_fingerprint?: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

/** Runtime instance shape exposed through HTTP and Sync. */
export type WorkflowClientInstanceRecord = Omit<
  WorkflowInstanceRecord,
  'steps_json' | 'graph_json' | 'definition_version_id'
>;

export interface WorkflowStepRecord {
  step_id: string;
  /** Duplicated from the parent instance for direct Sync filtering. */
  tenant_id: string | null;
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
  node_id?: string | null;
  node_kind?: string | null;
  node_path?: string | null;
  parent_step_id?: string | null;
  branch_key?: string | null;
  item_key?: string | null;
  item_index?: number | null;
  activation_key?: string | null;
  updated_at?: string | null;
}

/** Runtime step shape exposed through HTTP and Sync. */
export type WorkflowClientStepRecord = Omit<WorkflowStepRecord, 'wait_event'>;

/** Privacy-safe interaction progress exposed over HTTP and ReactiveDB Sync. */
export interface WorkflowClientInteractionRecord {
  interaction_id: string;
  /** Duplicated from the parent instance for direct Sync filtering. */
  tenant_id: string | null;
  instance_id: string;
  node_id: string;
  step_id: string;
  safe_label: string;
  status: WorkflowInteractionStatus;
  opened_at: string;
  expires_at: string | null;
  accepted_at: string | null;
  accepted_by: string | null;
  rejection_count: number;
  max_rejections: number;
  created_at: string;
  updated_at: string;
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
    definition_version: 'integer',
    graph_fingerprint: 'text',
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
    timeout_at: 'text',
    started_at: 'text',
    completed_at: 'text',
    created_at: 'text',
    node_id: 'text',
    node_kind: 'text',
    node_path: 'text',
    parent_step_id: 'text',
    branch_key: 'text',
    item_key: 'text',
    item_index: 'integer',
    activation_key: 'text',
    updated_at: 'text',
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
  workflow_interactions: {
    _pk: 'interaction_id',
    interaction_id: 'text',
    tenant_id: 'text',
    instance_id: 'text',
    node_id: 'text',
    step_id: 'text',
    safe_label: 'text',
    status: 'text',
    opened_at: 'text',
    expires_at: 'text',
    accepted_at: 'text',
    accepted_by: 'text',
    rejection_count: 'integer',
    max_rejections: 'integer',
    created_at: 'text',
    updated_at: 'text',
  },
};

/**
 * Every workflow table protected by the server boundary, including tables
 * deliberately absent from the browser client descriptor.
 */
export const WORKFLOW_SERVER_TABLE_NAMES: ReadonlySet<string> = new Set([
  'workflow_definitions',
  'workflow_definition_versions',
  '_workflow_definition_drafts',
  '_workflow_graph_edges',
  '_workflow_decisions',
  '_workflow_each_items',
  '_workflow_memory_policies',
  '_workflow_memory',
  '_workflow_interaction_details',
  '_workflow_interaction_responses',
  '_workflow_event_delivery',
  '_workflow_event_authorities',
  '_workflow_system_event_receipts',
  '_workflow_system_start_receipts',
  '_workflow_event_usage',
  '_workflow_step_attempts',
  '_workflow_pauses',
  '_workflow_runtime_usage',
  '_workflow_runtime_owner_lease',
  '_workflow_execution_authorities',
  '_workflow_step_executions',
  ...Object.keys(WORKFLOW_TABLES),
]);
