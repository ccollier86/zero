/** Canonical commands and public acknowledgements for retry-safe privileged starts. */
import type { WorkflowSystemExecutionOptions } from './workflow-execution-authority';
import { WorkflowError } from './workflow-error';
import { validWorkflowDefinitionName } from './workflow-definition-identifiers';
import { serializeWorkflowJson, workflowJsonBytes } from './workflow-json-value';
import { serializeWorkflowRuntimeJson } from './workflow-runtime-json';
import { validateWorkflowStartOptions, type WorkflowStartOptions } from './workflow-start-options';
import type { WorkflowInstanceRecord } from './types';

/** Trusted source authority and a permanent effect key, isolated by scope and principal. */
export interface WorkflowSystemStartOptions extends WorkflowSystemExecutionOptions {
  readonly idempotencyKey: string;
}

/** Stable original acknowledgement, including the immutable graph version if applicable. */
export interface WorkflowSystemStartResult {
  readonly instanceId: string;
  readonly name: string;
  readonly createdAt: string;
  readonly definitionVersion: number | null;
}

/** Trusted live source fence; it must be synchronous and runs under the final writer lock. */
export interface WorkflowSystemStartMutation {
  readonly assertCurrentAuthority?: () => void;
}

export interface WorkflowSystemStartIdentity {
  readonly scopeKind: 'application' | 'tenant';
  readonly scopeId: string;
  readonly tenantId: string | null;
  readonly principal: string;
  readonly idempotencyKey: string;
}

/** Admit a bounded key without reflecting its value into errors or observability. */
export function requireWorkflowSystemStartKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
    throw new WorkflowError('Workflow system start requires a bounded idempotency key', 'WORKFLOW_START_IDEMPOTENCY_INVALID', 422);
  }
  return value;
}

/** Detach inputs before hashing and execution, preserving undefined versus JSON null. */
export function prepareWorkflowSystemStart(name: string, input: unknown, options: WorkflowStartOptions) {
  if (!validWorkflowDefinitionName(name)) {
    throw new WorkflowError('Workflow name is invalid', 'WORKFLOW_REQUEST_INVALID', 422);
  }
  const inputText = serializeWorkflowRuntimeJson(input, { code: 'WORKFLOW_INPUT_INVALID', label: 'Workflow input' });
  const canonicalInput = inputText === null ? null : serializeWorkflowJson(JSON.parse(inputText), 'WORKFLOW_INPUT_INVALID', 422);
  const optionText = serializeWorkflowJson(options, 'WORKFLOW_REQUEST_INVALID', 422);
  // Covers the maximum 16 MiB private-memory budget plus keys and public input.
  if (workflowJsonBytes(optionText) > 32 * 1024 * 1024) {
    throw new WorkflowError('Workflow start options exceed their byte limit', 'WORKFLOW_REQUEST_INVALID', 413);
  }
  return Object.freeze({
    input: canonicalInput === null ? undefined : JSON.parse(canonicalInput) as unknown,
    inputJson: canonicalInput,
    options: validateWorkflowStartOptions(JSON.parse(optionText)),
    optionsJson: optionText,
  });
}

/** Canonical cryptographic identity; callers never persist the raw command or private memory. */
export function workflowSystemStartHash(value: unknown): string {
  return new Bun.CryptoHasher('sha256').update(serializeWorkflowJson(value)).digest('hex');
}

/** Bind the original request to the actual immutable execution snapshot, not the current head. */
export function workflowSystemStartPin(instance: WorkflowInstanceRecord): string {
  return workflowSystemStartHash([
    instance.definition_id, instance.definition_version_id ?? null,
    instance.definition_version ?? null, instance.name, instance.graph_fingerprint ?? null,
    instance.graph_json ?? null, instance.steps_json ?? null, instance.input,
  ]);
}

export function workflowSystemStartConflict(): WorkflowError {
  return new WorkflowError('Workflow system start idempotency key was already used for another command', 'WORKFLOW_START_IDEMPOTENCY_CONFLICT', 409);
}
