/** Public workflow record projections shared by HTTP and Sync boundaries. */

import { parseWorkflowStepDefinitions } from './workflow-step-definition';

/** Remove the immutable executable topology snapshot from a runtime instance. */
export function toPublicWorkflowInstance<T extends object>(
  instance: T,
): Omit<T, 'steps_json'> {
  const record = instance as T & { steps_json?: unknown };
  const { steps_json: _stepsJson, ...publicInstance } = record;
  return publicInstance as Omit<T, 'steps_json'>;
}

/**
 * Publish a human step label without trusting legacy `step_name` rows, which
 * stored executable handler keys in Zero 1.3. Missing snapshots use a stable
 * generic label rather than leaking that legacy key.
 */
export function toPublicWorkflowStep<T extends object>(
  step: T,
  stepsJson: unknown,
): Omit<T, 'wait_event'> {
  const record = step as T & {
    step_index?: unknown;
    step_name?: unknown;
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
  const label = typeof definition?.name === 'string' && definition.name.trim()
    ? definition.name
    : index === null ? 'Workflow step' : `Step ${index + 1}`;
  const { wait_event: _waitEvent, ...publicStep } = record;
  return { ...publicStep, step_name: label } as Omit<T, 'wait_event'>;
}
