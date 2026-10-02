/** Publication, resolution, and integrity checks for executable graph versions. */

import type { CompiledWorkflowDefinition } from './workflow-compiler';
import type { WorkflowDefinitionVersionStore } from './workflow-definition-version-store';
import {
  WorkflowDefinitionVersionStoreError,
  type ResolvedWorkflowDefinitionVersion,
} from './workflow-definition-version-types';
import { WorkflowError } from './workflow-error';
import type { WorkflowGraphIR } from './workflow-ir';
import { validateWorkflowGraphIR } from './workflow-ir-validator';
import type { WorkflowRegistry } from './workflow-registry';
import { validateWorkflowSchemaValue } from './workflow-schema-snapshot';
import type { WorkflowInstanceRecord } from './types';

export interface StartWorkflowGraphOptions {
  version?: number;
  source?: 'code' | 'database';
}

export class WorkflowGraphDefinitionResolver {
  constructor(
    private readonly versions: WorkflowDefinitionVersionStore,
    private readonly registry: WorkflowRegistry,
  ) {}

  publishRegisteredDefinitions(): number {
    let published = 0;
    for (const definition of this.registry.listCompiledWorkflows()) {
      if (definition.format === 'legacy') continue;
      this.publishDefinition(definition);
      published += 1;
    }
    return published;
  }

  resolveRegistered(
    definition: CompiledWorkflowDefinition,
    input: unknown,
    options: StartWorkflowGraphOptions,
  ): ResolvedWorkflowDefinitionVersion {
    if (options.source && options.source !== definition.authoringSource) {
      throw new WorkflowError(
        'Workflow authoring source does not match its registered definition',
        'WORKFLOW_VERSION_SOURCE_CONFLICT',
        409,
      );
    }
    let resolved: ResolvedWorkflowDefinitionVersion;
    try {
      resolved = this.versions.resolve({ name: definition.name, version: options.version });
    } catch (error) {
      throwMappedStoreError(error);
    }
    if (resolved.version.source !== definition.authoringSource) {
      throw new WorkflowError(
        'Workflow authoring source does not match its registered definition',
        'WORKFLOW_VERSION_SOURCE_CONFLICT',
        409,
      );
    }
    this.validateResolved(resolved, input, false);
    return resolved;
  }

  resolvePersisted(
    name: string,
    input: unknown,
    options: StartWorkflowGraphOptions,
  ): ResolvedWorkflowDefinitionVersion {
    let resolved: ResolvedWorkflowDefinitionVersion;
    try {
      resolved = this.versions.resolve({ name, version: options.version });
    } catch (error) {
      throwMappedStoreError(error);
    }
    if (resolved.version.source !== 'database') {
      throw new WorkflowError(
        'Workflow definition is not database-authored',
        'WORKFLOW_VERSION_NOT_FOUND',
        404,
      );
    }
    this.validateResolved(resolved, input, true);
    return resolved;
  }

  resolvePinned(instance: WorkflowInstanceRecord): WorkflowGraphIR {
    if (!instance.definition_version_id || !instance.graph_fingerprint) {
      throw new TypeError('Workflow graph instance is not pinned to an immutable version');
    }
    let resolved: ResolvedWorkflowDefinitionVersion;
    try {
      resolved = this.versions.resolve({
        versionId: instance.definition_version_id,
        includeRetired: true,
      });
    } catch (error) {
      throwMappedStoreError(error);
    }
    if (resolved.catalog.definition_id !== instance.definition_id
      || resolved.version.version_number !== instance.definition_version
      || resolved.version.fingerprint !== instance.graph_fingerprint
      || resolved.version.graph_json !== instance.graph_json) {
      throw new TypeError('Workflow graph snapshot does not match its immutable version');
    }
    const graph = resolved.graph as WorkflowGraphIR;
    validateWorkflowGraphIR(graph);
    this.validateActivities(graph, resolved.version.source === 'database');
    return graph;
  }

  private validateResolved(
    resolved: ResolvedWorkflowDefinitionVersion,
    input: unknown,
    requireDatabaseSource: boolean,
  ): void {
    validateInput(resolved.catalog.name, resolved.inputSchema, input);
    const graph = resolved.graph as WorkflowGraphIR;
    validateWorkflowGraphIR(graph);
    this.validateActivities(graph, requireDatabaseSource);
  }

  private publishDefinition(
    definition: CompiledWorkflowDefinition,
  ): ResolvedWorkflowDefinitionVersion {
    try {
      return this.versions.publish({
        name: definition.name,
        graph: definition.graph,
        source: definition.authoringSource,
        graphFormat: definition.format,
        schemaVersion: definition.graph.schemaVersion,
        inputSchema: definition.inputSchema,
        accessPolicy: definition.access,
        version: definition.version,
        activate: definition.activate,
        expectedFingerprint: definition.fingerprint,
      });
    } catch (error) {
      throwMappedStoreError(error);
    }
  }

  private validateActivities(graph: WorkflowGraphIR, database: boolean): void {
    for (const node of graph.nodes) {
      if (node.kind === 'activity') this.resolveActivity(node.activity, database);
      if (node.kind === 'each') this.validateActivities(node.body, database);
      if (node.kind === 'wait' && node.interaction) {
        node.interaction.delivery?.forEach((entry) => this.resolveActivity(entry.activity, database));
        if (node.interaction.validator) this.resolveActivity(node.interaction.validator, database);
      }
    }
  }

  private resolveActivity(
    reference: { name: string; version?: string },
    database: boolean,
  ): void {
    if (database) this.registry.activities.resolveDatabaseCallable(reference);
    else this.registry.activities.resolve(reference);
  }
}

function validateInput(name: string, schema: unknown, input: unknown): void {
  if (!schema) return;
  try {
    if (validateWorkflowSchemaValue(schema, input)) return;
  } catch {
    throw new WorkflowError(
      `Input schema for workflow "${name}" is invalid`,
      'WORKFLOW_DEFINITION_INVALID',
      500,
    );
  }
  throw new WorkflowError(`Input does not match workflow "${name}"`, 'WORKFLOW_INPUT_INVALID', 422);
}

function throwMappedStoreError(error: unknown): never {
  if (!(error instanceof WorkflowDefinitionVersionStoreError)) throw error;
  const code = error.code === 'WORKFLOW_DEFINITION_VERSION_NOT_FOUND'
    ? 'WORKFLOW_VERSION_NOT_FOUND'
    : error.code === 'WORKFLOW_DEFINITION_VERSION_CONFLICT'
      ? 'WORKFLOW_VERSION_CONFLICT'
      : error.code === 'WORKFLOW_DEFINITION_HISTORY_INVALID'
        ? 'WORKFLOW_VERSION_HISTORY_INVALID'
        : error.code === 'WORKFLOW_DEFINITION_GRAPH_INVALID'
          ? 'WORKFLOW_DEFINITION_GRAPH_INVALID'
          : error.code === 'WORKFLOW_DEFINITION_DRAFT_CONFLICT'
          ? 'WORKFLOW_DRAFT_CONFLICT'
          : error.code === 'WORKFLOW_DEFINITION_SCOPE_CONFLICT'
            ? 'WORKFLOW_VERSION_SCOPE_CONFLICT'
            : 'WORKFLOW_VERSION_SOURCE_CONFLICT';
  throw new WorkflowError(error.message, code, error.status);
}
