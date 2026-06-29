/**
 * workflow-registry.ts
 *
 * Part of: Workflows subsystem (registry)
 *
 * In-memory registry for workflow definitions and step handlers.
 * Handlers are keyed by string name and looked up at execution time.
 * Definitions are registered by name and persisted to DB on first use.
 */

import type { StepHandler, WorkflowDefinition } from './types';

export class WorkflowRegistry {
  private handlers = new Map<string, StepHandler>();
  private definitions = new Map<string, WorkflowDefinition>();

  registerHandler(name: string, handler: StepHandler): void {
    if (this.handlers.has(name)) {
      throw new Error(`Handler "${name}" already registered`);
    }
    this.handlers.set(name, handler);
  }

  getHandler(name: string): StepHandler | undefined {
    return this.handlers.get(name);
  }

  registerWorkflow(definition: WorkflowDefinition): void {
    // Validate all steps reference registered handlers
    for (const step of definition.steps) {
      if (!this.handlers.has(step.handler)) {
        throw new Error(
          `Workflow "${definition.name}" references unregistered handler "${step.handler}"`
        );
      }
    }
    this.definitions.set(definition.name, definition);
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
