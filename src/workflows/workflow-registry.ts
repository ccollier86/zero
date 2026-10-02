/**
 * workflow-registry.ts
 *
 * Owns in-memory registration for legacy handlers, versioned activities, and
 * compiled workflow definitions. It validates the code/database trust boundary
 * but does not persist definitions or execute workflow nodes.
 */

import {
  MAX_WORKFLOW_ATTEMPTS,
  type StepHandler,
  type WorkflowDefinition,
} from './types';
import { freezeWorkflowAccessPolicy } from './workflow-access';
import {
  WorkflowActivityCatalog,
  type RegisteredWorkflowActivity,
  type WorkflowActivityDefinition,
} from './workflow-activity-catalog';
import {
  compileWorkflowDefinition,
  type CompiledWorkflowDefinition,
  type WorkflowDefinitionAuthoringSource,
  type WorkflowDefinitionInput,
} from './workflow-compiler';
import { compileWorkflowCondition } from './workflow-condition';
import type { WorkflowActivityReference } from './workflow-ir';
import { WorkflowError } from './workflow-error';

export interface RegisterWorkflowOptions {
  /** Database definitions can call only explicitly opted-in activities. */
  authoringSource?: WorkflowDefinitionAuthoringSource;
}

export class WorkflowRegistry {
  private readonly handlers = new Map<string, StepHandler>();
  private readonly definitions = new Map<string, WorkflowDefinition>();
  private readonly compiled = new Map<string, CompiledWorkflowDefinition>();
  readonly activities = new WorkflowActivityCatalog();

  /** Register a legacy handler as activity version `1`, never database-callable. */
  registerHandler(name: string, handler: StepHandler): void {
    validateHandler(name, handler);
    if (this.handlers.has(name)) {
      throw invalidDefinition(`Workflow handler "${name}" is already registered`);
    }
    this.activities.register({
      name,
      version: '1',
      handler,
      databaseCallable: false,
      default: true,
    });
    this.handlers.set(name, handler);
  }

  /** Register a typed, versioned activity used by graph workflows. */
  registerActivity(definition: WorkflowActivityDefinition): RegisteredWorkflowActivity {
    return this.activities.register(definition);
  }

  /** Resolve a legacy handler without throwing. */
  getHandler(name: string): StepHandler | undefined {
    return this.handlers.get(name);
  }

  /** Register and compile one legacy, flow, or canonical graph definition. */
  registerWorkflow(
    definition: WorkflowDefinitionInput,
    options: RegisterWorkflowOptions = {},
  ): void {
    if (!definition || typeof definition.name !== 'string' || !definition.name.trim()) {
      throw invalidDefinition('Workflow name is required');
    }
    if (definition.name !== definition.name.trim()) {
      throw invalidDefinition('Workflow names must not have surrounding whitespace');
    }
    if (this.compiled.has(definition.name)) {
      throw invalidDefinition(`Workflow "${definition.name}" is already registered`);
    }
    const legacy = 'steps' in definition && Array.isArray(definition.steps);
    if (legacy) validateLegacyDefinition(definition as WorkflowDefinition, this.handlers);

    const access = freezeWorkflowAccessPolicy(definition.access, definition.name);
    const normalized = {
      ...definition,
      ...(access === undefined ? {} : { access }),
    } as WorkflowDefinitionInput;
    const authoringSource = options.authoringSource ?? 'code';
    if (authoringSource !== 'code' && authoringSource !== 'database') {
      throw invalidDefinition('Workflow authoringSource must be "code" or "database"');
    }
    const compiled = compileWorkflowDefinition(normalized, {
      authoringSource,
      resolveActivity: (reference) => this.pinActivity(
        legacy ? { ...reference, version: '1' } : reference,
        authoringSource,
      ),
    });
    this.compiled.set(definition.name, compiled);

    // Keep the proven 1.3 sequential lookup intact while the graph runtime is
    // integrated. Graph callers use getCompiledWorkflow().
    if (compiled.format === 'legacy') {
      const legacyDefinition = definition as WorkflowDefinition;
      const steps = compiled.legacySteps!.map((step) => Object.freeze({ ...step }));
      Object.freeze(steps);
      this.definitions.set(definition.name, Object.freeze({
        name: definition.name,
        steps,
        ...(legacyDefinition.inputSchema === undefined
          ? {}
          : { inputSchema: legacyDefinition.inputSchema }),
        ...(access === undefined ? {} : { access }),
      }));
    }
  }

  /** Register a definition loaded from DB/API with the database-callable gate. */
  registerDatabaseWorkflow(definition: WorkflowDefinitionInput): void {
    this.registerWorkflow(definition, { authoringSource: 'database' });
  }

  /** Canonical create alias for registerWorkflow(). */
  create(definition: WorkflowDefinitionInput, options?: RegisterWorkflowOptions): void {
    this.registerWorkflow(definition, options);
  }

  /** Legacy sequential definition lookup retained during graph rollout. */
  getWorkflow(name: string): WorkflowDefinition | undefined {
    return this.definitions.get(name);
  }

  /** Canonical legacy get alias. */
  get(name: string): WorkflowDefinition | undefined {
    return this.getWorkflow(name);
  }

  /** Return the canonical graph for any registered authoring format. */
  getCompiledWorkflow(name: string): CompiledWorkflowDefinition | undefined {
    return this.compiled.get(name);
  }

  /** List legacy definitions for the 1.3 HTTP/runtime compatibility path. */
  listWorkflows(): WorkflowDefinition[] {
    return Array.from(this.definitions.values());
  }

  /** Canonical legacy list alias. */
  list(): WorkflowDefinition[] {
    return this.listWorkflows();
  }

  /** List every compiled graph definition in registration order. */
  listCompiledWorkflows(): CompiledWorkflowDefinition[] {
    return Array.from(this.compiled.values());
  }

  /** List legacy handler keys in registration order. */
  listHandlers(): string[] {
    return Array.from(this.handlers.keys());
  }

  private pinActivity(
    reference: WorkflowActivityReference,
    source: WorkflowDefinitionAuthoringSource,
  ): WorkflowActivityReference {
    const activity = source === 'database'
      ? this.activities.resolveDatabaseCallable(reference)
      : this.activities.resolve(reference);
    return Object.freeze({ name: activity.name, version: activity.version });
  }
}

function validateLegacyDefinition(
  definition: WorkflowDefinition,
  handlers: ReadonlyMap<string, StepHandler>,
): void {
  assertKnownKeys(
    definition,
    ['name', 'steps', 'version', 'activate', 'inputSchema', 'access'],
    `Workflow "${definition.name}"`,
  );
  if (!Array.isArray(definition.steps)) {
    throw invalidDefinition(`Workflow "${definition.name}" steps must be an array`);
  }
  if (definition.steps.length === 0) {
    throw invalidDefinition(`Workflow "${definition.name}" must define at least one step`);
  }
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
    if (!handlers.has(step.handler)) {
      throw invalidDefinition(
        `Workflow "${definition.name}" references unregistered handler "${step.handler}"`,
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
}

function validateHandler(name: string, handler: StepHandler): void {
  if (typeof name !== 'string' || !name.trim()) {
    throw invalidDefinition('Workflow handler name is required');
  }
  if (name !== name.trim()) {
    throw invalidDefinition('Workflow handler names must not have surrounding whitespace');
  }
  if (typeof handler !== 'function') {
    throw invalidDefinition(`Workflow handler "${name}" must be a function`);
  }
}

function invalidDefinition(message: string): WorkflowError {
  return new WorkflowError(message, 'WORKFLOW_DEFINITION_INVALID', 500);
}

function assertKnownKeys(value: object, allowed: readonly string[], label: string): void {
  const accepted = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !accepted.has(key));
  if (unknown) throw invalidDefinition(`${label} property "${unknown}" is not supported`);
}
