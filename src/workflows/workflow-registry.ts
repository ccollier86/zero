/**
 * workflow-registry.ts
 *
 * Part of: Workflows subsystem (registry)
 *
 * In-memory registry for workflow definitions and step handlers.
 * Handlers are keyed by string name and looked up at execution time.
 * Definitions are registered by name and persisted to DB on first use.
 */

import { MAX_WORKFLOW_ATTEMPTS, type StepHandler, type WorkflowDefinition } from './types';
import { freezeWorkflowAccessPolicy } from './workflow-access';
import { compileWorkflowCondition } from './workflow-condition';
import { WorkflowError } from './workflow-error';

export class WorkflowRegistry {
  private handlers = new Map<string, StepHandler>();
  private definitions = new Map<string, WorkflowDefinition>();

  registerHandler(name: string, handler: StepHandler): void {
    if (typeof name !== 'string' || !name.trim()) {
      throw invalidDefinition('Workflow handler name is required');
    }
    if (name !== name.trim()) {
      throw invalidDefinition('Workflow handler names must not have surrounding whitespace');
    }
    if (typeof handler !== 'function') {
      throw invalidDefinition(`Workflow handler "${name}" must be a function`);
    }
    if (this.handlers.has(name)) {
      throw invalidDefinition(`Workflow handler "${name}" is already registered`);
    }
    this.handlers.set(name, handler);
  }

  getHandler(name: string): StepHandler | undefined {
    return this.handlers.get(name);
  }

  registerWorkflow(definition: WorkflowDefinition): void {
    if (!definition || typeof definition.name !== 'string' || !definition.name.trim()) {
      throw invalidDefinition('Workflow name is required');
    }
    if (definition.name !== definition.name.trim()) {
      throw invalidDefinition('Workflow names must not have surrounding whitespace');
    }
    assertKnownKeys(
      definition,
      ['name', 'steps', 'inputSchema', 'access'],
      `Workflow "${definition.name}"`,
    );
    if (!Array.isArray(definition.steps)) {
      throw invalidDefinition(`Workflow "${definition.name}" steps must be an array`);
    }
    if (definition.steps.length === 0) {
      throw invalidDefinition(`Workflow "${definition.name}" must define at least one step`);
    }
    if (this.definitions.has(definition.name)) {
      throw invalidDefinition(`Workflow "${definition.name}" is already registered`);
    }

    // Validate all steps reference registered handlers
    for (const [index, step] of definition.steps.entries()) {
      const label = `Workflow "${definition.name}" step ${index}`;
      if (!step || typeof step.name !== 'string' || !step.name.trim()) {
        throw invalidDefinition(`${label} must have a name`);
      }
      assertKnownKeys(
        step,
        ['name', 'handler', 'retries', 'backoffMs', 'timeoutMs', 'waitFor', 'condition'],
        label,
      );
      if (typeof step.handler !== 'string' || !step.handler.trim()) {
        throw invalidDefinition(`${label} must have a handler`);
      }
      if (step.handler !== step.handler.trim()) {
        throw invalidDefinition(`${label} handler must not have surrounding whitespace`);
      }
      if (!this.handlers.has(step.handler)) {
        throw invalidDefinition(
          `Workflow "${definition.name}" references unregistered handler "${step.handler}"`
        );
      }
      if (step.retries !== undefined
        && (!Number.isInteger(step.retries)
          || step.retries < 1
          || step.retries > MAX_WORKFLOW_ATTEMPTS)) {
        throw invalidDefinition(
          `${label} retries must be an integer from 1 to ${MAX_WORKFLOW_ATTEMPTS}`,
        );
      }
      if (step.backoffMs !== undefined
        && (!Number.isFinite(step.backoffMs) || step.backoffMs < 0)) {
        throw invalidDefinition(`${label} backoffMs must be a finite non-negative number`);
      }
      if (step.timeoutMs !== undefined
        && (!Number.isFinite(step.timeoutMs)
          || step.timeoutMs <= 0
          || !Number.isFinite(new Date(Date.now() + step.timeoutMs).getTime()))) {
        throw invalidDefinition(
          `${label} timeoutMs must be a finite positive duration within the supported date range`,
        );
      }
      if (step.waitFor !== undefined
        && (typeof step.waitFor !== 'string' || !step.waitFor.trim())) {
        throw invalidDefinition(`${label} waitFor must not be empty`);
      }
      if (step.waitFor !== undefined && step.waitFor !== step.waitFor.trim()) {
        throw invalidDefinition(`${label} waitFor must not have surrounding whitespace`);
      }
      if (step.condition !== undefined) {
        if (typeof step.condition !== 'string' || !step.condition.trim()) {
          throw invalidDefinition(`${label} condition must not be empty`);
        }
        try {
          compileWorkflowCondition(step.condition);
        } catch {
          throw invalidDefinition(`${label} condition is not valid JavaScript expression syntax`);
        }
      }
    }
    const steps = definition.steps.map((step) => Object.freeze({ ...step }));
    Object.freeze(steps);
    const access = freezeWorkflowAccessPolicy(definition.access, definition.name);
    this.definitions.set(definition.name, Object.freeze({
      ...definition,
      steps,
      ...(access === undefined ? {} : { access }),
    }));
  }

  /** Canonical create alias for registerWorkflow(). */
  create(definition: WorkflowDefinition): void {
    this.registerWorkflow(definition);
  }

  getWorkflow(name: string): WorkflowDefinition | undefined {
    return this.definitions.get(name);
  }

  /** Canonical get alias for getWorkflow(). */
  get(name: string): WorkflowDefinition | undefined {
    return this.getWorkflow(name);
  }

  listWorkflows(): WorkflowDefinition[] {
    return Array.from(this.definitions.values());
  }

  /** Canonical list alias for listWorkflows(). */
  list(): WorkflowDefinition[] {
    return this.listWorkflows();
  }

  listHandlers(): string[] {
    return Array.from(this.handlers.keys());
  }
}

function invalidDefinition(message: string): WorkflowError {
  return new WorkflowError(message, 'WORKFLOW_DEFINITION_INVALID', 500);
}

function assertKnownKeys(
  value: object,
  allowed: readonly string[],
  label: string,
): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknown) throw invalidDefinition(`${label} property "${unknown}" is not supported`);
}
