/**
 * workflow-definition-query-service.ts
 *
 * Owns read models, visibility checks, and start authorization for workflow
 * definitions. Mutation, publication, and compilation remain in the manager.
 */

import type { WorkflowDefinitionAccessPolicy } from './types';
import {
  canAccessWorkflowDefinition,
  freezeWorkflowAccessPolicy,
  type WorkflowAccessPrincipal,
} from './workflow-access';
import {
  APPLICATION_WORKFLOW_DEFINITION_SCOPE,
  workflowDefinitionCatalogMatchesScope,
} from './workflow-definition-scope';
import type { WorkflowDefinitionVersionStore } from './workflow-definition-version-store';
import {
  WorkflowDefinitionVersionStoreError,
  type ResolvedWorkflowDefinitionDraft,
  type ResolvedWorkflowDefinitionVersion,
  type WorkflowDefinitionCatalogRecord,
  type WorkflowDefinitionVersionRecord,
  type WorkflowDefinitionScope,
} from './workflow-definition-version-types';
import { WorkflowError } from './workflow-error';
import type { WorkflowGraphIR } from './workflow-ir';
import type { WorkflowRegistry } from './workflow-registry';

/** Safe workflow catalog metadata exposed by definition list operations. */
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

/**
 * Read workflow catalogs through their scope and access-policy boundaries.
 *
 * This service consumes only the registry and immutable-version store. It does
 * not compile, publish, activate, retire, or otherwise mutate definitions.
 */
export class WorkflowDefinitionQueryService {
  constructor(
    private readonly registry: WorkflowRegistry,
    private readonly versions: WorkflowDefinitionVersionStore,
    private readonly scope: WorkflowDefinitionScope = APPLICATION_WORKFLOW_DEFINITION_SCOPE,
  ) {}

  /** Return definition summaries the principal may inspect. */
  listVisible(principal: WorkflowAccessPrincipal): WorkflowDefinitionSummary[] {
    const ownedCatalogs = this.versions.listCatalogs(this.scope);
    const database = ownedCatalogs.filter((catalog) => catalog.source === 'database');
    const databaseNames = new Set(database.map((catalog) => catalog.name));
    const codeCatalogs = this.versions.listCatalogs(APPLICATION_WORKFLOW_DEFINITION_SCOPE)
      .filter((catalog) => catalog.source === 'code');
    const codeCatalogsByName = new Map(codeCatalogs.map((catalog) => [catalog.name, catalog]));
    const code = this.registry.listCompiledWorkflows().flatMap((definition) => {
      // A tenant-owned database definition shadows an application code
      // definition with the same name in that tenant only.
      if (databaseNames.has(definition.name)) return [];
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
      const catalog = codeCatalogsByName.get(definition.name);
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
    const visibleDatabase = database.flatMap((catalog) => {
      const resolved = this.tryResolveActive(catalog);
      if (!resolved || !canAccessWorkflowDefinition(
        { access: parseAccess(resolved, catalog.name) },
        'inspect',
        principal,
      )) return [];
      return [toSummary(catalog, resolved)];
    });
    return [...code, ...visibleDatabase].sort(compareSummaryNames);
  }

  /** Fail closed unless the principal may start the exact selected definition. */
  assertCanStart(
    name: string,
    version: number | undefined,
    principal: WorkflowAccessPrincipal,
  ): void {
    if (this.scope.type === 'tenant') {
      const tenantCatalog = this.versions.findCatalog(name, this.scope);
      if (tenantCatalog) {
        let tenantDefinition: ResolvedWorkflowDefinitionVersion;
        try {
          tenantDefinition = this.resolve({ name, version });
        } catch (error) {
          if (error instanceof WorkflowError && error.code === 'WORKFLOW_VERSION_NOT_FOUND') {
            throw workflowDefinitionHidden();
          }
          throw error;
        }
        if (tenantDefinition.version.source !== 'database'
          || !canAccessWorkflowDefinition(
            { access: parseAccess(tenantDefinition, name) },
            'start',
            principal,
          )) throw workflowDefinitionHidden();
        return;
      }
    }
    const compiled = this.registry.getCompiledWorkflow(name);
    if (compiled) {
      if (compiled.format === 'legacy') {
        if (!canAccessWorkflowDefinition(compiled, 'start', principal)) {
          throw workflowDefinitionHidden();
        }
        return;
      }
      if (version !== undefined) {
        try {
          const historical = this.resolve({
            name,
            version,
            scope: APPLICATION_WORKFLOW_DEFINITION_SCOPE,
          });
          if (historical.version.source === 'code') {
            if (!canAccessWorkflowDefinition(
              { access: parseAccess(historical, name) },
              'start',
              principal,
            )) throw workflowDefinitionHidden();
            return;
          }
        } catch (error) {
          if (!(error instanceof WorkflowError)
            || error.code !== 'WORKFLOW_VERSION_NOT_FOUND') throw error;
        }
      }
      let active: ResolvedWorkflowDefinitionVersion;
      try {
        active = this.resolve({ name, scope: APPLICATION_WORKFLOW_DEFINITION_SCOPE });
      } catch (error) {
        if (error instanceof WorkflowError && error.code === 'WORKFLOW_VERSION_NOT_FOUND') {
          throw workflowDefinitionHidden();
        }
        throw error;
      }
      if (active.version.source !== 'code'
        || !canAccessWorkflowDefinition(
          { access: parseAccess(active, name) },
          'start',
          principal,
        )) throw workflowDefinitionHidden();
      return;
    }
    let resolved: ResolvedWorkflowDefinitionVersion;
    try {
      resolved = this.resolve({ name, version });
    } catch (error) {
      if (error instanceof WorkflowError && error.code === 'WORKFLOW_VERSION_NOT_FOUND') {
        throw workflowDefinitionHidden();
      }
      throw error;
    }
    if (resolved.version.source !== 'database'
      || !canAccessWorkflowDefinition(
        { access: parseAccess(resolved, name) },
        'start',
        principal,
      )) throw workflowDefinitionHidden();
  }

  /** Return the full administration catalog without exposing executable graphs. */
  listAdmin(): WorkflowDefinitionSummary[] {
    const byName = new Map<string, WorkflowDefinitionSummary>();
    for (const summary of this.listVisible({ role: 'admin' })) byName.set(summary.name, summary);
    const ownedCatalogs = this.versions.listCatalogs(this.scope);
    const ownedNames = new Set(ownedCatalogs.map((catalog) => catalog.name));
    const catalogs = [
      ...ownedCatalogs,
      ...(this.scope.type === 'application'
        ? []
        : this.versions.listCatalogs(APPLICATION_WORKFLOW_DEFINITION_SCOPE)
          .filter((catalog) => catalog.source === 'code')),
    ];
    for (const catalog of catalogs) {
      if (catalog.source === 'code' && this.scope.type === 'tenant'
        && ownedNames.has(catalog.name)) {
        continue;
      }
      const active = this.tryResolveActive(catalog);
      byName.set(catalog.name, toSummary(
        catalog,
        active,
        definitionLabels(this.registry.getCompiledWorkflow(catalog.name)),
      ));
    }
    return [...byName.values()].sort(compareSummaryNames);
  }

  /** Return immutable versions after confirming the catalog belongs to this scope. */
  listVersions(definitionId: string): WorkflowDefinitionVersionRecord[] {
    this.requireOwnedCatalog(definitionId);
    return this.run(() => this.versions.listVersions(definitionId));
  }

  /** Resolve one immutable version within an owned catalog. */
  getVersion(definitionId: string, versionId: string): ResolvedWorkflowDefinitionVersion {
    this.requireOwnedCatalog(definitionId);
    const resolved = this.run(() => this.versions.resolve({ versionId, includeRetired: true }));
    if (resolved.catalog.definition_id !== definitionId) throw workflowDefinitionHidden();
    return resolved;
  }

  /** Resolve one draft only when its catalog belongs to this scope. */
  getDraft(draftId: string): ResolvedWorkflowDefinitionDraft {
    const draft = this.run(() => this.versions.drafts.require(draftId));
    this.requireOwnedCatalog(draft.draft.definition_id);
    return draft;
  }

  /** Return safe metadata for the trusted activities available to authors. */
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

  private resolve(input: {
    name: string;
    version?: number;
    scope?: WorkflowDefinitionScope;
  }): ResolvedWorkflowDefinitionVersion {
    return this.run(() => this.versions.resolve({
      ...input,
      scope: input.scope ?? this.scope,
    }));
  }

  private requireOwnedCatalog(definitionId: string): WorkflowDefinitionCatalogRecord {
    const catalog = this.versions.listCatalogs(this.scope)
      .find((candidate) => candidate.definition_id === definitionId);
    if (!catalog || !workflowDefinitionCatalogMatchesScope(catalog, this.scope)) {
      throw workflowDefinitionHidden();
    }
    return catalog;
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
        throw mapWorkflowDefinitionVersionError(error);
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

function compareSummaryNames(
  left: WorkflowDefinitionSummary,
  right: WorkflowDefinitionSummary,
): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

/** Map private persistence failures to the stable public workflow error contract. */
export function mapWorkflowDefinitionVersionError(
  error: WorkflowDefinitionVersionStoreError,
): WorkflowError {
  const code = error.code === 'WORKFLOW_DEFINITION_VERSION_NOT_FOUND'
    ? 'WORKFLOW_VERSION_NOT_FOUND'
    : error.code === 'WORKFLOW_DEFINITION_VERSION_CONFLICT'
      ? 'WORKFLOW_VERSION_CONFLICT'
      : error.code === 'WORKFLOW_DEFINITION_HISTORY_INVALID'
        ? 'WORKFLOW_VERSION_HISTORY_INVALID'
        : error.code === 'WORKFLOW_DEFINITION_GRAPH_INVALID'
          ? 'WORKFLOW_DEFINITION_GRAPH_INVALID'
          : error.code === 'WORKFLOW_DEFINITION_DRAFT_INVALID'
            ? 'WORKFLOW_REQUEST_INVALID'
            : error.code === 'WORKFLOW_DEFINITION_DRAFT_CONFLICT'
              ? 'WORKFLOW_DRAFT_CONFLICT'
              : error.code === 'WORKFLOW_DEFINITION_SCOPE_CONFLICT'
                ? 'WORKFLOW_VERSION_SCOPE_CONFLICT'
                : 'WORKFLOW_VERSION_SOURCE_CONFLICT';
  return new WorkflowError(error.message, code, error.status);
}

/** Build the intentionally indistinguishable not-found response for hidden definitions. */
export function workflowDefinitionHidden(): WorkflowError {
  return new WorkflowError('Workflow not found', 'WORKFLOW_NOT_FOUND', 404);
}
