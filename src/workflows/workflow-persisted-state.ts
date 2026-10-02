/**
 * Validation for immutable workflow snapshots and mutable durable run state.
 *
 * The engine treats these rows as an internal protocol. Invalid rows fail
 * closed before a handler runs or recovery clears an attempt fence.
 */

import { compileWorkflowCondition } from './workflow-condition';
import {
  MAX_WORKFLOW_ATTEMPTS,
  type StepDefinition,
  type WorkflowInstanceRecord,
  type WorkflowStepRecord,
} from './types';

const INSTANCE_STATUSES = new Set([
  'running',
  'completed',
  'failed',
  'cancelled',
  'paused',
]);
const STEP_STATUSES = new Set([
  'pending',
  'running',
  'completed',
  'failed',
  'waiting',
  'skipped',
]);
const DEFINITION_STEP_KEYS = new Set([
  'name',
  'handler',
  'retries',
  'backoffMs',
  'timeoutMs',
  'waitFor',
  'condition',
]);

export class WorkflowPersistedStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowPersistedStateError';
  }
}

export interface ValidatedWorkflowState {
  definitions: readonly StepDefinition[];
  /** First step that has not completed or been skipped, if one remains. */
  frontier: WorkflowStepRecord | null;
}

export function validateWorkflowPersistedState(
  instance: WorkflowInstanceRecord,
  steps: readonly WorkflowStepRecord[],
): ValidatedWorkflowState {
  if (!INSTANCE_STATUSES.has(String(instance.status))) {
    throw invalid(`Unknown workflow instance status "${String(instance.status)}"`);
  }
  assertJson(instance.input, 'Workflow input');
  assertJson(instance.output, 'Workflow output');
  const definitions = parseDefinitionSnapshot(instance.steps_json);
  if (definitions.length === 0) {
    throw invalid('Workflow definition snapshot must contain at least one step');
  }
  if (steps.length !== definitions.length) {
    throw invalid('Workflow step rows do not match the definition snapshot');
  }
  if (!Number.isInteger(instance.current_step)
    || instance.current_step < 0
    || instance.current_step > definitions.length) {
    throw invalid('Workflow current_step is outside the definition snapshot');
  }
  assertTimestamp(instance.created_at, 'Workflow instance created_at', false);
  assertTimestamp(instance.updated_at, 'Workflow instance updated_at', false);
  assertTimestamp(instance.completed_at, 'Workflow instance completed_at');

  const indices = new Set<number>();
  for (const step of steps) {
    if (step.instance_id !== instance.instance_id
      || (step.tenant_id ?? null) !== (instance.tenant_id ?? null)) {
      throw invalid('Workflow step belongs to a different instance or tenant');
    }
    if (!Number.isInteger(step.step_index)
      || step.step_index < 0
      || step.step_index >= definitions.length
      || indices.has(step.step_index)) {
      throw invalid('Workflow step indices are missing or duplicated');
    }
    indices.add(step.step_index);
    validateStepRow(step, definitions[step.step_index]!);
  }
  for (let index = 0; index < definitions.length; index += 1) {
    if (!indices.has(index)) {
      throw invalid('Workflow step indices are missing or duplicated');
    }
  }

  const ordered = [...steps].sort((left, right) => left.step_index - right.step_index);
  const frontierIndex = ordered.findIndex((step) => !isTerminalStep(step));
  const frontier = frontierIndex === -1 ? null : ordered[frontierIndex]!;
  if (frontier) {
    for (let index = frontierIndex + 1; index < ordered.length; index += 1) {
      assertPristineSuccessor(ordered[index]!);
    }
    if (instance.current_step > frontier.step_index) {
      throw invalid('Workflow current_step is ahead of its legal frontier');
    }
  }
  validateInstanceLifecycle(instance, ordered, frontier);

  return { definitions, frontier };
}

function parseDefinitionSnapshot(value: unknown): readonly StepDefinition[] {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalid('Workflow definition snapshot is missing');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new WorkflowPersistedStateError(
      `Workflow definition snapshot contains malformed JSON: ${safeMessage(error)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw invalid('Workflow definition snapshot must be an array');
  }
  return parsed.map((entry, index) => validateDefinitionEntry(entry, index));
}

function validateDefinitionEntry(value: unknown, index: number): StepDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid(`Workflow definition step ${index} must be an object`);
  }
  const entry = value as Record<string, unknown>;
  const unknownKey = Object.keys(entry).find((key) => !DEFINITION_STEP_KEYS.has(key));
  if (unknownKey) {
    throw invalid(
      `Workflow definition step ${index} property "${unknownKey}" is not supported`,
    );
  }
  if (typeof entry.name !== 'string'
    || !entry.name.trim()
    || entry.name !== entry.name.trim()) {
    throw invalid(`Workflow definition step ${index} has no display name`);
  }
  if (typeof entry.handler !== 'string'
    || !entry.handler.trim()
    || entry.handler !== entry.handler.trim()) {
    throw invalid(`Workflow definition step ${index} has an invalid handler key`);
  }
  if (entry.retries !== undefined
    && (!Number.isInteger(entry.retries)
      || Number(entry.retries) < 1
      || Number(entry.retries) > MAX_WORKFLOW_ATTEMPTS)) {
    throw invalid(`Workflow definition step ${index} has an invalid retry budget`);
  }
  if (entry.backoffMs !== undefined
    && (typeof entry.backoffMs !== 'number'
      || !Number.isFinite(entry.backoffMs)
      || entry.backoffMs < 0)) {
    throw invalid(`Workflow definition step ${index} has an invalid retry backoff`);
  }
  if (entry.timeoutMs !== undefined
    && (typeof entry.timeoutMs !== 'number'
      || !Number.isFinite(entry.timeoutMs)
      || entry.timeoutMs <= 0
      || !Number.isFinite(new Date(Date.now() + entry.timeoutMs).getTime()))) {
    throw invalid(`Workflow definition step ${index} has an invalid timeout`);
  }
  if (entry.waitFor !== undefined
    && (typeof entry.waitFor !== 'string'
      || !entry.waitFor.trim()
      || entry.waitFor !== entry.waitFor.trim())) {
    throw invalid(`Workflow definition step ${index} has an invalid event name`);
  }
  if (entry.condition !== undefined) {
    if (typeof entry.condition !== 'string' || !entry.condition.trim()) {
      throw invalid(`Workflow definition step ${index} has an invalid condition`);
    }
    try {
      compileWorkflowCondition(entry.condition);
    } catch {
      throw invalid(`Workflow definition step ${index} has an invalid condition`);
    }
  }
  return entry as unknown as StepDefinition;
}

function validateStepRow(step: WorkflowStepRecord, definition: StepDefinition): void {
  if (!STEP_STATUSES.has(String(step.status))) {
    throw invalid(`Unknown workflow step status "${String(step.status)}"`);
  }
  assertJson(step.input, `Workflow step ${step.step_index} input`);
  assertJson(step.output, `Workflow step ${step.step_index} output`);
  // Zero 1.3 stored the handler key in step_name. Current rows store the
  // display label; both are intentionally accepted during rolling upgrades.
  if (step.step_name !== definition.name && step.step_name !== definition.handler) {
    throw invalid(`Workflow step ${step.step_index} identity does not match its snapshot`);
  }
  if (!Number.isInteger(step.retries)
    || step.retries < 0
    || !Number.isInteger(step.max_retries)
    || step.max_retries < 1
    || step.max_retries > MAX_WORKFLOW_ATTEMPTS
    || step.retries > step.max_retries) {
    throw invalid(`Workflow step ${step.step_index} has impossible retry counters`);
  }
  const expectedAttempts = definition.retries ?? 3;
  if (step.max_retries !== expectedAttempts) {
    throw invalid(`Workflow step ${step.step_index} retry budget does not match its snapshot`);
  }
  assertTimestamp(step.created_at, `Workflow step ${step.step_index} created_at`, false);
  assertTimestamp(step.started_at, `Workflow step ${step.step_index} started_at`);
  assertTimestamp(step.completed_at, `Workflow step ${step.step_index} completed_at`);
  assertTimestamp(step.retry_at, `Workflow step ${step.step_index} retry_at`);
  assertTimestamp(step.timeout_at, `Workflow step ${step.step_index} timeout_at`);
  if (step.retry_at !== null
    && (step.status !== 'failed' || step.retries >= step.max_retries)) {
    throw invalid(`Workflow step ${step.step_index} has an impossible retry deadline`);
  }
  if ((step.status === 'completed' || step.status === 'skipped')
    && (step.retry_at !== null || step.timeout_at !== null)) {
    throw invalid(`Workflow step ${step.step_index} retained a terminal deadline`);
  }
  if ((step.wait_event ?? null) !== (definition.waitFor ?? null)) {
    throw invalid(`Workflow step ${step.step_index} wait event does not match its snapshot`);
  }
  if (step.timeout_at !== null && definition.timeoutMs === undefined) {
    throw invalid(`Workflow step ${step.step_index} has a deadline absent from its snapshot`);
  }
  validateStepLifecycle(step);
}

function validateStepLifecycle(step: WorkflowStepRecord): void {
  const label = `Workflow step ${step.step_index}`;
  if (step.status !== 'completed' && step.output !== null) {
    throw invalid(`${label} has output before completion`);
  }
  if (step.status !== 'failed' && step.status !== 'skipped' && step.error !== null) {
    throw invalid(`${label} has an error in status "${step.status}"`);
  }
  if (step.status === 'pending') {
    if (step.retry_at !== null || step.completed_at !== null) {
      throw invalid(`${label} has impossible pending lifecycle fields`);
    }
    return;
  }
  if (step.status === 'running') {
    if (step.started_at === null
      || step.retry_at !== null
      || step.completed_at !== null) {
      throw invalid(`${label} has impossible running lifecycle fields`);
    }
    return;
  }
  if (step.status === 'waiting') {
    if (step.wait_event === null
      || step.started_at === null
      || step.retry_at !== null
      || step.completed_at !== null) {
      throw invalid(`${label} has impossible waiting lifecycle fields`);
    }
    return;
  }
  if (step.status === 'failed') {
    if (!step.error) throw invalid(`${label} has no failure error`);
    if (step.retry_at !== null) {
      if (step.retries < 1
        || step.retries >= step.max_retries
        || step.completed_at !== null) {
        throw invalid(`${label} has impossible retry lifecycle fields`);
      }
    } else if (step.completed_at === null || step.timeout_at !== null) {
      throw invalid(`${label} has impossible terminal failure fields`);
    }
    return;
  }
  if (step.completed_at === null) {
    throw invalid(`${label} has no terminal completion timestamp`);
  }
  if (step.status === 'completed' && step.started_at === null) {
    throw invalid(`${label} completed without starting`);
  }
}

function assertPristineSuccessor(step: WorkflowStepRecord): void {
  if (step.status !== 'pending'
    || step.input !== null
    || step.output !== null
    || step.error !== null
    || step.retries !== 0
    || step.retry_at !== null
    || step.timeout_at !== null
    || step.started_at !== null
    || step.completed_at !== null) {
    throw invalid(
      `Workflow step ${step.step_index} progressed behind an unfinished frontier`,
    );
  }
}

function validateInstanceLifecycle(
  instance: WorkflowInstanceRecord,
  steps: readonly WorkflowStepRecord[],
  frontier: WorkflowStepRecord | null,
): void {
  if (instance.status !== 'completed' && instance.output !== null) {
    throw invalid(`Workflow ${instance.status} instance has output before completion`);
  }
  if (instance.status === 'running' || instance.status === 'paused') {
    if (instance.completed_at !== null || instance.error !== null) {
      throw invalid(`Workflow ${instance.status} instance has terminal lifecycle fields`);
    }
    if (instance.status === 'paused' && frontier === null) {
      throw invalid('Paused workflow has no unfinished frontier');
    }
    return;
  }
  if (instance.completed_at === null) {
    throw invalid(`Workflow ${instance.status} instance has no completion timestamp`);
  }
  if (instance.status === 'completed') {
    if (frontier !== null
      || instance.current_step !== steps.length
      || instance.error !== null) {
      throw invalid('Completed workflow has inconsistent terminal state');
    }
    return;
  }
  if (instance.status === 'failed') {
    if (!instance.error
      || frontier?.status !== 'failed'
      || frontier.retry_at !== null
      || instance.current_step !== frontier.step_index) {
      throw invalid('Failed workflow has inconsistent terminal state');
    }
    return;
  }
  if (frontier !== null || instance.error !== null) {
    throw invalid('Cancelled workflow has inconsistent terminal state');
  }
}

function isTerminalStep(step: WorkflowStepRecord): boolean {
  return step.status === 'completed' || step.status === 'skipped';
}

function assertTimestamp(value: unknown, label: string, nullable = true): void {
  if (value === null && nullable) return;
  if (typeof value !== 'string') throw invalid(`${label} is invalid`);
  const time = new Date(value).getTime();
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
    throw invalid(`${label} is invalid`);
  }
}

function assertJson(value: unknown, label: string): void {
  if (value === null) return;
  if (typeof value !== 'string') throw invalid(`${label} is invalid`);
  try {
    JSON.parse(value);
  } catch {
    throw invalid(`${label} contains malformed JSON`);
  }
}

function invalid(message: string): WorkflowPersistedStateError {
  return new WorkflowPersistedStateError(message);
}

function safeMessage(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return 'unprintable parse error';
  }
}
