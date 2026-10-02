/** Trusted administration boundary for database-authored workflow versions. */

import type { TSchema } from 'elysia';
import type { WorkflowDefinitionAccessPolicy } from './types';
import {
  canAccessWorkflowDefinition,
  freezeWorkflowAccessPolicy,
  type WorkflowAccessPrincipal,
} from './workflow-access';
import { compileWorkflowDefinition } from './workflow-compiler';
import type { WorkflowDefinitionVersionStore } from './workflow-definition-version-store';
import {
  WorkflowDefinitionVersionStoreError,
  type PublishWorkflowDefinitionVersionResult,
  type ResolvedWorkflowDefinitionDraft,
  type ResolvedWorkflowDefinitionVersion,
  type WorkflowDefinitionCatalogRecord,
  type WorkflowDefinitionVersionRecord,
} from './workflow-definition-version-types';
import { WorkflowError } from './workflow-error';
import type { WorkflowGraphIR } from './workflow-ir';
import type { WorkflowRegistry } from './workflow-registry';

export interface DatabaseWorkflowDefinitionInput {
  name: string;
  graph: WorkflowGraphIR;
  inputSchema?: unknown;
  access?: WorkflowDefinitionAccessPolicy;
  version?: number;
  activate?: boolean;
  expectedActiveVersionId?: string | null;
}

export interface DatabaseWorkflowDraftInput extends DatabaseWorkflowDefinitionInput {
  definitionId: string;
  draftId?: string;
  baseVersionId?: string | null;
  expectedRevision?: number;
  editorMetadata?: unknown;
}

export interface WorkflowDefinitionSummary {
  definitionId: string | null;
  name: string;
  source: 'code' | 'database';
  format: string;
  /** Safe labels from the exact active immutable graph shown to this principal. */
  steps: Array<{ name: string }>;
  activeVersion: number | null;
  latestVersion: number | null;
  status: 'active' | 'retired';
}

/** Validates trust boundaries before allowing graph content into history. */
export class WorkflowDefinitionManager {
  constructor(
    private readonly registry: WorkflowRegistry,
    private readonly versions: WorkflowDefinitionVersionStore,
  ) {}

  listVisible(principal: WorkflowAccessPrincipal): WorkflowDefinitionSummary[] {
    const catalogs = this.versions.listCatalogs();
    const catalogsByName = new Map(catalogs.map((catalog) => [catalog.name, catalog]));
    const code = this.registry.listCompiledWorkflows().flatMap((definition) => {
      // Legacy definitions retain the live 1.3 runtime and authority contract;
      // migration history is archival and must not override current code.
      if (definition.format === 'legacy') {
        if (!canAccessWorkflowDefinition(definition, 'inspect', principal)) return [];
        return [{
          definitionId: null,
          name: definition.name,
          source: 'code' as const,
          format: definition.format,
          steps: definitionLabels(definition),
          activeVersion: null,
          latestVersion: null,
          status: 'active' as const,
        }];
      }
      const catalog = catalogsByName.get(definition.name);
      if (catalog?.source === 'code' && catalog.active_version_id) {
        const resolved = this.tryResolveActive(catalog);
        if (!resolved || !canAccessWorkflowDefinition(
          { access: parseAccess(resolved, catalog.name) },
          'inspect',
          principal,
        )) return [];
        return [toSummary(catalog, resolved)];
      }
      // A staged graph with no active immutable version remains admin-only
      // until an operator deliberately activates it.
      return [];
    });
    const database = catalogs
      .filter((catalog) => catalog.source === 'database')
      .flatMap((catalog) => {
        const resolved = this.tryResolveActive(catalog);
        if (!resolved || !canAccessWorkflowDefinition(
          { access: parseAccess(resolved, catalog.name) },
          'inspect',
          principal,
        )) return [];
        return [toSummary(catalog, resolved)];
      });
    return [...code, ...database].sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  }

  assertCanStart(
    name: string,
    version: number | undefined,
    principal: WorkflowAccessPrincipal,
  ): void {
    const compiled = this.registry.getCompiledWorkflow(name);
    if (compiled) {
      if (compiled.format === 'legacy') {
        if (!canAccessWorkflowDefinition(compiled, 'start', principal)) throw workflowHidden();
        return;
      }
      if (version !== undefined) {
        try {
          const historical = this.resolve({ name, version });
          if (historical.version.source === 'code') {
            if (!canAccessWorkflowDefinition(
              { access: parseAccess(historical, name) },
              'start',
              principal,
            )) throw workflowHidden();
            return;
          }
        } catch (error) {
          if (!(error instanceof WorkflowError)
            || error.code !== 'WORKFLOW_VERSION_NOT_FOUND') throw error;
        }
      }
      let active: ResolvedWorkflowDefinitionVersion;
      try {
        active = this.resolve({ name });
      } catch (error) {
        if (error instanceof WorkflowError && error.code === 'WORKFLOW_VERSION_NOT_FOUND') {
          throw workflowHidden();
        }
        throw error;
      }
      if (active.version.source !== 'code'
        || !canAccessWorkflowDefinition(
          { access: parseAccess(active, name) },
          'start',
          principal,
        )) throw workflowHidden();
      return;
    }
    let resolved: ResolvedWorkflowDefinitionVersion;
    try {
      resolved = this.resolve({ name, version });
    } catch (error) {
      if (error instanceof WorkflowError && error.code === 'WORKFLOW_VERSION_NOT_FOUND') {
        throw workflowHidden();
      }
      throw error;
    }
    if (resolved.version.source !== 'database'
      || !canAccessWorkflowDefinition(
        { access: parseAccess(resolved, name) },
        'start',
        principal,
      )) throw workflowHidden();
  }

  listAdmin(): WorkflowDefinitionSummary[] {
    const byName = new Map<string, WorkflowDefinitionSummary>();
    for (const summary of this.listVisible({ role: 'admin' })) byName.set(summary.name, summary);
    for (const catalog of this.versions.listCatalogs()) {
      const active = this.tryResolveActive(catalog);
      byName.set(catalog.name, toSummary(
        catalog,
        active,
        definitionLabels(this.registry.getCompiledWorkflow(catalog.name)),
      ));
    }
    return [...byName.values()].sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  }

  listVersions(definitionId: string): WorkflowDefinitionVersionRecord[] {
    return this.run(() => this.versions.listVersions(definitionId));
  }

  getVersion(definitionId: string, versionId: string): ResolvedWorkflowDefinitionVersion {
    const resolved = this.run(() => this.versions.resolve({ versionId, includeRetired: true }));
    if (resolved.catalog.definition_id !== definitionId) throw workflowHidden();
    return resolved;
  }

  getDraft(draftId: string): ResolvedWorkflowDefinitionDraft {
    return this.run(() => this.versions.drafts.require(draftId));
  }

  deleteDraft(draftId: string, expectedRevision: number): boolean {
    return this.run(() => this.versions.drafts.delete(draftId, expectedRevision));
  }

  listActivities() {
    return this.registry.activities.list().map((activity) => ({
      name: activity.name,
      version: activity.version,
      description: activity.description ?? null,
      capabilities: activity.capabilities,
      databaseCallable: activity.databaseCallable,
      default: activity.default,
      inputSchema: activity.inputSchema ?? null,
      outputSchema: activity.outputSchema ?? null,
    }));
  }

  publish(
    input: DatabaseWorkflowDefinitionInput,
    actorId: string,
  ): PublishWorkflowDefinitionVersionResult {
    const compiled = this.compile(input);
    return this.run(() => this.versions.publish({
      name: compiled.name,
      graph: compiled.graph,
      source: 'database',
      graphFormat: compiled.format,
      schemaVersion: compiled.graph.schemaVersion,
      inputSchema: compiled.inputSchema,
      accessPolicy: compiled.access,
      version: compiled.version,
      activate: compiled.activate,
      actorId,
      ...(Object.prototype.hasOwnProperty.call(input, 'expectedActiveVersionId')
        ? { expectedActiveVersionId: input.expectedActiveVersionId }
        : {}),
      expectedFingerprint: compiled.fingerprint,
    }));
  }

  saveDraft(
    input: DatabaseWorkflowDraftInput,
    actorId: string,
  ): ResolvedWorkflowDefinitionDraft {
    const updating = input.draftId !== undefined;
    if (updating !== (input.expectedRevision !== undefined)) {
      throw new WorkflowError(
        'Existing workflow draft updates require draftId and expectedRevision together',
        'WORKFLOW_REQUEST_INVALID',
        422,
      );
    }
    const catalog = this.versions.listCatalogs()
      .find((candidate) => candidate.definition_id === input.definitionId);
    if (!catalog) throw workflowHidden();
    if (catalog.name !== input.name) {
      throw new WorkflowError(
        'Workflow draft definition identity does not match its name',
        'WORKFLOW_DRAFT_CONFLICT',
        409,
      );
    }
    const compiled = this.compile(input);
    const persistence = {
      definitionId: input.definitionId,
      source: 'database',
      graphFormat: compiled.format,
      schemaVersion: compiled.graph.schemaVersion,
      graph: compiled.graph,
      inputSchema: compiled.inputSchema,
      accessPolicy: compiled.access,
      editorMetadata: input.editorMetadata,
      actorId,
      ...(input.baseVersionId === undefined ? {} : { baseVersionId: input.baseVersionId }),
    } as const;
    return this.run(() => this.versions.drafts.save(input.draftId === undefined
      ? persistence
      : {
        ...persistence,
        draftId: input.draftId,
        expectedRevision: input.expectedRevision!,
      }));
  }

  publishDraft(
    draftId: string,
    actorId: string,
    options: {
      expectedRevision: number;
      version?: number;
      activate?: boolean;
      expectedActiveVersionId?: string | null;
    },
  ): PublishWorkflowDefinitionVersionResult {
    if (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 1) {
      throw new WorkflowError(
        'Workflow draft publication requires a positive expected revision',
        'WORKFLOW_REQUEST_INVALID',
        422,
      );
    }
    const draft = this.run(() => this.versions.drafts.require(draftId));
    const catalog = this.versions.listCatalogs()
      .find((candidate) => candidate.definition_id === draft.draft.definition_id);
    if (!catalog) throw workflowHidden();
    const compiled = this.compile({
      name: catalog.name,
      graph: draft.graph as WorkflowGraphIR,
      ...(draft.inputSchema === null ? {} : { inputSchema: draft.inputSchema }),
      ...(draft.accessPolicy === null
        ? {}
        : { access: draft.accessPolicy as WorkflowDefinitionAccessPolicy }),
      ...(options.version === undefined ? {} : { version: options.version }),
      ...(options.activate === undefined ? {} : { activate: options.activate }),
    });
    return this.run(() => this.versions.publishDraft({
      draftId,
      definitionId: draft.draft.definition_id,
      expectedRevision: options.expectedRevision,
      expectedDraftFingerprint: draft.draft.fingerprint,
      publication: {
        name: compiled.name,
        graph: compiled.graph,
        source: 'database',
        graphFormat: compiled.format,
        schemaVersion: compiled.graph.schemaVersion,
        inputSchema: compiled.inputSchema,
        accessPolicy: compiled.access,
        version: compiled.version,
        activate: compiled.activate,
        actorId,
        ...(Object.prototype.hasOwnProperty.call(options, 'expectedActiveVersionId')
          ? { expectedActiveVersionId: options.expectedActiveVersionId }
          : {}),
        expectedFingerprint: compiled.fingerprint,
      },
    }));
  }

  activate(definitionId: string, versionId: string, actorId: string) {
    return this.run(() => this.versions.activate(definitionId, versionId, actorId));
  }

  retire(definitionId: string, versionId: string, actorId: string) {
    return this.run(() => this.versions.retire(definitionId, versionId, actorId));
  }

  private compile(input: DatabaseWorkflowDefinitionInput) {
    const access = freezeWorkflowAccessPolicy(input.access, input.name);
    return compileWorkflowDefinition({
      name: input.name,
      graph: input.graph,
      ...(input.inputSchema === undefined ? {} : { inputSchema: input.inputSchema as TSchema }),
      ...(access === undefined ? {} : { access }),
      ...(input.version === undefined ? {} : { version: input.version }),
      ...(input.activate === undefined ? {} : { activate: input.activate }),
    }, {
      authoringSource: 'database',
      resolveActivity: (reference) => {
        const activity = this.registry.activities.resolveDatabaseCallable(reference);
        return { name: activity.name, version: activity.version };
      },
    });
  }

  private resolve(input: { name: string; version?: number }) {
    return this.run(() => this.versions.resolve(input));
  }

  private tryResolveActive(
    catalog: WorkflowDefinitionCatalogRecord,
  ): ResolvedWorkflowDefinitionVersion | null {
    if (!catalog.active_version_id) return null;
    return this.run(() => this.versions.resolve({ definitionId: catalog.definition_id }));
  }

  private run<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      if (error instanceof WorkflowDefinitionVersionStoreError) {
        throw mapVersionError(error);
      }
      throw error;
    }
  }
}

function parseAccess(
  resolved: ResolvedWorkflowDefinitionVersion,
  name: string,
): WorkflowDefinitionAccessPolicy | undefined {
  if (resolved.accessPolicy === null) return undefined;
  return freezeWorkflowAccessPolicy(
    resolved.accessPolicy as WorkflowDefinitionAccessPolicy,
    name,
  );
}

function toSummary(
  catalog: WorkflowDefinitionCatalogRecord,
  active: ResolvedWorkflowDefinitionVersion | null,
  fallbackSteps: Array<{ name: string }> = [],
): WorkflowDefinitionSummary {
  return {
    definitionId: catalog.definition_id,
    name: catalog.name,
    source: catalog.source,
    format: active?.version.graph_format ?? 'graph',
    steps: active?.version.graph_format === 'graph'
      ? graphLabels(active.graph)
      : fallbackSteps,
    activeVersion: active?.version.version_number ?? null,
    latestVersion: Number(catalog.version),
    status: catalog.status,
  };
}

function definitionLabels(
  definition: ReturnType<WorkflowRegistry['getCompiledWorkflow']>,
): Array<{ name: string }> {
  if (!definition) return [];
  if (definition.legacySteps) {
    return definition.legacySteps.map((step) => ({ name: step.name }));
  }
  return graphLabels(definition.graph);
}

function graphLabels(graph: unknown): Array<{ name: string }> {
  if (!graph || typeof graph !== 'object' || !Array.isArray((graph as WorkflowGraphIR).nodes)) {
    return [];
  }
  return (graph as WorkflowGraphIR).nodes.map((node, index) => ({
    name: node.label?.trim() || `${humanizeNodeKind(node.kind)} ${index + 1}`,
  }));
}

function humanizeNodeKind(kind: string): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function mapVersionError(error: WorkflowDefinitionVersionStoreError): WorkflowError {
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
            : error.code === 'WORKFLOW_DEFINITION_DRAFT_INVALID'
              ? 'WORKFLOW_REQUEST_INVALID'
            : error.code === 'WORKFLOW_DEFINITION_SCOPE_CONFLICT'
              ? 'WORKFLOW_VERSION_SCOPE_CONFLICT'
              : 'WORKFLOW_VERSION_SOURCE_CONFLICT';
  return new WorkflowError(error.message, code, error.status);
}

function workflowHidden(): WorkflowError {
  return new WorkflowError('Workflow not found', 'WORKFLOW_NOT_FOUND', 404);
}
