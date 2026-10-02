/** Validates a start request and atomically creates its durable workflow rows. */

import { Value } from '@sinclair/typebox/value';
import type { WorkflowClock } from './workflow-executor';
import { WorkflowError } from './workflow-error';
import type { WorkflowRepository } from './workflow-repository';
import type { WorkflowRegistry } from './workflow-registry';
import { serializeWorkflowRuntimeJson } from './workflow-runtime-json';

export interface CreatedWorkflowInstance {
  instanceId: string;
  name: string;
}

export interface CreateWorkflowInstanceOptions {
  tenantId: string | null;
  /** Persist private execution authority in the same transaction as the run. */
  onCreate?: (instanceId: string) => void;
}

export class WorkflowInstanceFactory {
  constructor(
    private readonly registry: WorkflowRegistry,
    private readonly repository: WorkflowRepository,
    private readonly clock: WorkflowClock,
  ) {}

  create(
    name: string,
    input: unknown,
    startedBy: string | null | undefined,
    options: CreateWorkflowInstanceOptions,
  ): CreatedWorkflowInstance {
    const definition = this.registry.getWorkflow(name);
    if (!definition) {
      throw new WorkflowError(
        `Workflow "${name}" is not registered`,
        'WORKFLOW_DEFINITION_NOT_FOUND',
        404,
      );
    }
    let inputMatches = true;
    try {
      inputMatches = !definition.inputSchema || Value.Check(definition.inputSchema, input);
    } catch {
      throw new WorkflowError(
        `Input schema for workflow "${name}" is invalid`,
        'WORKFLOW_DEFINITION_INVALID',
        500,
      );
    }
    if (!inputMatches) {
      throw new WorkflowError(
        `Input does not match workflow "${name}"`,
        'WORKFLOW_INPUT_INVALID',
        422,
      );
    }

    const serializedInput = serializeInput(input);
    const snapshot = serializeDefinitionSnapshot(definition.name, definition.steps, definition.inputSchema);
    const instanceId = crypto.randomUUID();
    const now = this.clock.now().toISOString();
    const definitionId = this.repository.persistDefinition({
      name: definition.name,
      stepsJson: snapshot.stepsJson,
      inputSchema: snapshot.inputSchema,
      now,
    });
    this.repository.createInstance({
      instance_id: instanceId,
      tenant_id: options.tenantId,
      definition_id: definitionId,
      name: definition.name,
      status: 'running',
      current_step: 0,
      input: serializedInput,
      output: null,
      error: null,
      started_by: startedBy ?? null,
      created_at: now,
      updated_at: now,
      completed_at: null,
      steps_json: snapshot.stepsJson,
    }, definition.steps.map((step, stepIndex) => ({
      step_id: crypto.randomUUID(),
      tenant_id: options.tenantId,
      instance_id: instanceId,
      step_index: stepIndex,
      step_name: step.name,
      status: 'pending',
      input: null,
      output: null,
      error: null,
      retries: 0,
      max_retries: Math.max(1, step.retries ?? 3),
      retry_at: null,
      wait_event: step.waitFor ?? null,
      timeout_at: null,
      started_at: null,
      completed_at: null,
      created_at: now,
    })), () => options.onCreate?.(instanceId));
    return { instanceId, name: definition.name };
  }
}

function serializeDefinitionSnapshot(
  name: string,
  steps: unknown,
  inputSchema: unknown,
): { stepsJson: string; inputSchema: string | null } {
  try {
    const stepsJson = JSON.stringify(steps);
    const serializedSchema = inputSchema === undefined ? null : JSON.stringify(inputSchema);
    if (stepsJson === undefined || (inputSchema !== undefined && serializedSchema === undefined)) {
      throw new TypeError('Definition snapshot did not produce JSON');
    }
    return { stepsJson, inputSchema: serializedSchema ?? null };
  } catch {
    throw new WorkflowError(
      `Workflow definition "${name}" is not JSON-serializable`,
      'WORKFLOW_DEFINITION_INVALID',
      500,
    );
  }
}

function serializeInput(value: unknown): string | null {
  return serializeWorkflowRuntimeJson(value, {
    code: 'WORKFLOW_INPUT_INVALID', label: 'Workflow input',
  });
}
