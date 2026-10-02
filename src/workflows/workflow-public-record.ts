/** Public workflow record projections shared by HTTP and Sync boundaries. */

import { parseWorkflowStepDefinitions } from './workflow-step-definition';

type NullableFieldIfPresent<T, K extends PropertyKey> = K extends keyof T
  ? { [P in K]: T[P] | null }
  : object;

export type PublicWorkflowInstanceProjection<T extends object> = Omit<
  T,
  'steps_json' | 'graph_json' | 'definition_version_id' | 'input' | 'output' | 'error'
> & NullableFieldIfPresent<T, 'input'>
  & NullableFieldIfPresent<T, 'output'>
  & NullableFieldIfPresent<T, 'error'>;

export type PublicWorkflowStepProjection<T extends object> = Omit<
  T,
  'wait_event' | 'input' | 'output' | 'error'
> & NullableFieldIfPresent<T, 'input'>
  & NullableFieldIfPresent<T, 'output'>
  & NullableFieldIfPresent<T, 'error'>;

export type WorkflowRunProjectionKind = 'legacy' | 'graph' | 'ambiguous';

const INSTANCE_FIELDS = [
  'instance_id', 'tenant_id', 'definition_id', 'name', 'status', 'current_step',
  'input', 'output', 'error', 'started_by', 'definition_version',
  'graph_fingerprint', 'created_at', 'updated_at', 'completed_at',
] as const;

const STEP_FIELDS = [
  'step_id', 'tenant_id', 'instance_id', 'step_index', 'step_name', 'status',
  'input', 'output', 'error', 'retries', 'max_retries', 'retry_at', 'timeout_at',
  'started_at', 'completed_at', 'created_at', 'node_id', 'node_kind', 'node_path',
  'parent_step_id', 'branch_key', 'item_key', 'item_index', 'activation_key',
  'updated_at',
] as const;

const EVENT_FIELDS = [
  'event_id', 'tenant_id', 'instance_id', 'event_name', 'payload', 'sent_by', 'created_at',
] as const;

const INTERACTION_FIELDS = [
  'interaction_id', 'tenant_id', 'instance_id', 'node_id', 'step_id', 'safe_label',
  'status', 'opened_at', 'expires_at', 'accepted_at', 'accepted_by',
  'rejection_count', 'max_rejections', 'created_at', 'updated_at',
] as const;

/**
 * Positively classify legacy rows; every graph-shaped or partial identity is
 * treated as private. The distinction now selects safe labels only; payloads
 * are redacted for every format.
 */
export function classifyWorkflowRunProjection(instance: unknown): WorkflowRunProjectionKind {
  if (!isRecord(instance)) return 'ambiguous';
  const versionId = instance.definition_version_id;
  const version = instance.definition_version;
  const fingerprint = instance.graph_fingerprint;
  const graphJson = instance.graph_json;
  const graphSignal = [versionId, version, fingerprint, graphJson]
    .some((value) => value !== null && value !== undefined);
  const completeGraphIdentity = nonBlank(versionId)
    && typeof version === 'number'
    && Number.isSafeInteger(version)
    && version > 0
    && nonBlank(fingerprint)
    && typeof graphJson === 'string'
    && graphJson.length > 0;
  if (completeGraphIdentity) return 'graph';
  if (graphSignal) return 'ambiguous';
  return typeof instance.steps_json === 'string' ? 'legacy' : 'ambiguous';
}

/** Publish metadata-only run progress for every workflow format. */
export function toPublicWorkflowInstance<T extends object>(
  instance: T,
): PublicWorkflowInstanceProjection<T> {
  const record = instance as Record<string, unknown>;
  const projected = pick(record, INSTANCE_FIELDS);
  projected.input = null;
  projected.output = null;
  projected.error = null;
  return projected as PublicWorkflowInstanceProjection<T>;
}

/**
 * Publish a human label and fixed progress fields without run payloads,
 * raw failures, or payload-derived fan-out identity.
 */
export function toPublicWorkflowStep<T extends object>(
  step: T,
  stepsJson: unknown,
  owner: unknown,
): PublicWorkflowStepProjection<T> {
  const record = step as Record<string, unknown>;
  const kind = classifyWorkflowRunProjection(owner);
  const index = typeof record.step_index === 'number'
    && Number.isSafeInteger(record.step_index)
    && record.step_index >= 0
    ? record.step_index
    : null;
  const graphLabel = kind === 'graph'
    && nonBlank(record.node_id)
    && nonBlank(record.step_name)
    ? record.step_name.trim()
    : null;
  const label = graphLabel
    ?? (kind === 'legacy'
      ? publicLegacyWorkflowStepLabel(record, stepsJson)
      : index === null ? 'Workflow step' : `Step ${index + 1}`);
  const projected = pick(record, STEP_FIELDS);
  projected.step_name = label;
  // Public legacy topology uses durable step ids as its stable node paths.
  // Normalize the row projection to the same identity so visual monitors use
  // one topology-path join for legacy and graph runs alike.
  if (kind === 'legacy' && nonBlank(record.step_id)) {
    projected.node_path = record.step_id;
  }
  projected.input = null;
  projected.output = null;
  projected.error = null;
  // EACH keys are application data (often email, patient, or account IDs),
  // while activation keys can embed the same value. Item index plus step_id
  // provide stable public identity without publishing either secret.
  projected.item_key = null;
  projected.activation_key = null;
  return projected as unknown as PublicWorkflowStepProjection<T>;
}

/** Resolve only the human definition label; never expose a legacy handler key. */
export function publicLegacyWorkflowStepLabel(
  step: Record<string, unknown>,
  stepsJson: unknown,
): string {
  const index = typeof step.step_index === 'number'
    && Number.isSafeInteger(step.step_index)
    && step.step_index >= 0
    ? step.step_index
    : null;
  const definition = index === null
    ? undefined
    : parseWorkflowStepDefinitions(stepsJson)[index];
  return typeof definition?.name === 'string' && definition.name.trim()
    ? definition.name.trim()
    : index === null ? 'Workflow step' : `Step ${index + 1}`;
}

/** Publish event audit metadata without the event payload for every run format. */
export function toPublicWorkflowEvent<T extends object>(
  event: T,
  _owner: unknown,
): T {
  const projected = pick(event as Record<string, unknown>, EVENT_FIELDS);
  projected.payload = null;
  return projected as T;
}

/** Fixed safe progress projection for human/agent interactions. */
export function toPublicWorkflowInteraction<T extends object>(interaction: T): T {
  return pick(interaction as Record<string, unknown>, INTERACTION_FIELDS) as T;
}

function pick(
  record: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(record, field)) projected[field] = record[field];
  }
  return projected;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
