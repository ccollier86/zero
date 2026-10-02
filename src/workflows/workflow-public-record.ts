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

/** Remove executable topology and internal catalog identity from a runtime instance. */
export function toPublicWorkflowInstance<T extends object>(
  instance: T,
): PublicWorkflowInstanceProjection<T> {
  const record = instance as T & {
    steps_json?: unknown;
    graph_json?: unknown;
    definition_version_id?: unknown;
    input?: unknown;
    output?: unknown;
    error?: unknown;
  };
  const {
    steps_json: _stepsJson,
    graph_json: _graphJson,
    definition_version_id: _definitionVersionId,
    ...publicInstance
  } = record;
  const graphRun = typeof record.graph_json === 'string';
  return {
    ...publicInstance,
    // Realtime rows are an operational projection. Graph inputs, results, and
    // raw handler messages may contain credentials, PHI, or interaction data;
    // explicit result APIs can apply a narrower authorization contract later.
    ...(graphRun ? { input: null, output: null, error: null } : {}),
  } as PublicWorkflowInstanceProjection<T>;
}

/**
 * Publish a human step label without trusting legacy `step_name` rows, which
 * stored executable handler keys in Zero 1.3. Missing snapshots use a stable
 * generic label rather than leaking that legacy key.
 */
export function toPublicWorkflowStep<T extends object>(
  step: T,
  stepsJson: unknown,
  graphJson?: unknown,
): PublicWorkflowStepProjection<T> {
  const record = step as T & {
    step_index?: unknown;
    step_name?: unknown;
    node_id?: unknown;
    input?: unknown;
    output?: unknown;
    error?: unknown;
    wait_event?: unknown;
  };
  const index = typeof record.step_index === 'number'
    && Number.isSafeInteger(record.step_index)
    && record.step_index >= 0
    ? record.step_index
    : null;
  const definition = index === null
    ? undefined
    : parseWorkflowStepDefinitions(stepsJson)[index];
  const graphLabel = typeof graphJson === 'string'
    && typeof record.node_id === 'string'
    && record.node_id.length > 0
    && typeof record.step_name === 'string'
    && record.step_name.trim().length > 0
    ? record.step_name.trim()
    : null;
  const label = graphLabel
    ?? (typeof definition?.name === 'string' && definition.name.trim()
      ? definition.name
      : index === null ? 'Workflow step' : `Step ${index + 1}`);
  const { wait_event: _waitEvent, ...publicStep } = record;
  // Graph activity inputs can contain accepted interaction/event values and
  // outputs or raw errors can carry application secrets. Keep every graph
  // node's execution data server-side while exposing only live progress.
  const graphStep = typeof graphJson === 'string';
  return {
    ...publicStep,
    step_name: label,
    ...(graphStep ? { input: null, output: null, error: null } : {}),
  } as unknown as PublicWorkflowStepProjection<T>;
}

/** Hide graph-event payloads while retaining their realtime audit metadata. */
export function toPublicWorkflowEvent<T extends object>(
  event: T,
  graphJson: unknown,
): T {
  if (typeof graphJson !== 'string') return event;
  return { ...event, payload: null };
}
