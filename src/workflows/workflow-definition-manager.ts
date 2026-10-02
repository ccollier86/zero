/**
 * workflow-definition-manager.ts
 *
 * Owns compilation and mutation commands for database-authored workflow
 * definitions. It consumes the registry and version store, delegates reads to
 * the query service, and does not own HTTP transport or workflow execution.
 */

import type { TSchema } from 'elysia';
import type { WorkflowDefinitionAccessPolicy } from './types';
import {
  freezeWorkflowAccessPolicy,
  type WorkflowAccessPrincipal,
} from './workflow-access';
import { compileWorkflowDefinition } from './workflow-compiler';
import {
  mapWorkflowDefinitionVersionError,
  type WorkflowDefinitionSummary,
  WorkflowDefinitionQueryService,
  workflowDefinitionHidden,
} from './workflow-definition-query-service';
export type { WorkflowDefinitionSummary } from './workflow-definition-query-service';
import type { WorkflowDefinitionVersionStore } from './workflow-definition-version-store';
import {
  APPLICATION_WORKFLOW_DEFINITION_SCOPE,
  workflowDefinitionCatalogMatchesScope,
} from './workflow-definition-scope';
import {
  WorkflowDefinitionVersionStoreError,
  type PublishWorkflowDefinitionVersionResult,
  type PublishWorkflowDefinitionVersionInput,
  type ResolvedWorkflowDefinitionDraft,
  type ResolvedWorkflowDefinitionVersion,
  type WorkflowDefinitionCatalogRecord,
  type WorkflowDefinitionVersionRecord,
  type WorkflowDefinitionScope,
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

interface DatabaseWorkflowDraftBase {
  definitionId: string;
  name: string;
  graph: WorkflowGraphIR;
  inputSchema?: unknown;
  access?: WorkflowDefinitionAccessPolicy;
  baseVersionId?: string | null;
  editorMetadata?: unknown;
}

/** Create with a server-owned id, or update an existing draft with its exact revision. */
export type DatabaseWorkflowDraftInput = DatabaseWorkflowDraftBase & (
  | { draftId?: never; expectedRevision?: never }
  | { draftId: string; expectedRevision: number }
);

/** Compile and mutate trusted database-authored workflow history. */
export class WorkflowDefinitionManager {
  private readonly queries: WorkflowDefinitionQueryService;

  constructor(
    private readonly registry: WorkflowRegistry,
    private readonly versions: WorkflowDefinitionVersionStore,
    private readonly scope: WorkflowDefinitionScope = APPLICATION_WORKFLOW_DEFINITION_SCOPE,
  ) {
    this.queries = new WorkflowDefinitionQueryService(registry, versions, scope);
  }

  /** Return definitions the principal may inspect without exposing graph content. */
  listVisible(principal: WorkflowAccessPrincipal): WorkflowDefinitionSummary[] {
    return this.queries.listVisible(principal);
  }

  /** Fail closed unless the principal may start the exact selected definition. */
  assertCanStart(
    name: string,
    version: number | undefined,
    principal: WorkflowAccessPrincipal,
  ): void {
    this.queries.assertCanStart(name, version, principal);
  }

  /** Return the administration catalog, including staged and retired definitions. */
  listAdmin(): WorkflowDefinitionSummary[] {
    return this.queries.listAdmin();
  }

  /** Return immutable versions only after confirming definition ownership. */
  listVersions(definitionId: string): WorkflowDefinitionVersionRecord[] {
    return this.queries.listVersions(definitionId);
  }

  /** Resolve one immutable version within its owned definition boundary. */
  getVersion(definitionId: string, versionId: string): ResolvedWorkflowDefinitionVersion {
    return this.queries.getVersion(definitionId, versionId);
  }

  /** Resolve a mutable draft only within this manager's definition scope. */
  getDraft(draftId: string): ResolvedWorkflowDefinitionDraft {
    return this.queries.getDraft(draftId);
  }

  deleteDraft(
    draftId: string,
    expectedRevision: number,
    assertCurrentAuthority?: () => void,
  ): boolean {
    this.getDraft(draftId);
    return this.run(() => this.versions.drafts.delete(
      draftId,
      expectedRevision,
      assertCurrentAuthority,
    ));
  }

  /** Return the trusted activity catalog available to workflow authors. */
  listActivities() {
    return this.queries.listActivities();
  }

  publish(
    input: DatabaseWorkflowDefinitionInput,
    actorId: string,
    assertCurrentAuthority?: () => void,
  ): PublishWorkflowDefinitionVersionResult {
    return this.run(() => this.versions.publish(
      this.compilePublication(input, actorId),
      assertCurrentAuthority,
    ));
  }

  saveDraft(
    input: DatabaseWorkflowDraftInput,
    actorId: string,
    assertCurrentAuthority?: () => void,
  ): ResolvedWorkflowDefinitionDraft {
    const updating = input.draftId !== undefined;
    if (updating !== (input.expectedRevision !== undefined)) {
      throw new WorkflowError(
        'Existing workflow draft updates require draftId and expectedRevision together',
        'WORKFLOW_REQUEST_INVALID',
        422,
      );
    }
    const catalog = this.requireOwnedCatalog(input.definitionId);
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
        expectedRevision: input.expectedRevision,
      }, assertCurrentAuthority));
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
    assertCurrentAuthority?: () => void,
  ): PublishWorkflowDefinitionVersionResult {
    if (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 1) {
      throw new WorkflowError(
        'Workflow draft publication requires a positive expected revision',
        'WORKFLOW_REQUEST_INVALID',
        422,
      );
    }
    const draft = this.run(() => this.versions.drafts.require(draftId));
    const catalog = this.requireOwnedCatalog(draft.draft.definition_id);
    const publication = this.compilePublication({
      name: catalog.name,
      graph: draft.graph as WorkflowGraphIR,
      ...(draft.inputSchema === null ? {} : { inputSchema: draft.inputSchema }),
      ...(draft.accessPolicy === null
        ? {}
        : { access: draft.accessPolicy as WorkflowDefinitionAccessPolicy }),
      ...(options.version === undefined ? {} : { version: options.version }),
      ...(options.activate === undefined ? {} : { activate: options.activate }),
      ...(Object.prototype.hasOwnProperty.call(options, 'expectedActiveVersionId')
        ? { expectedActiveVersionId: options.expectedActiveVersionId }
        : {}),
    }, actorId);
    return this.run(() => this.versions.publishDraft({
      draftId,
      definitionId: draft.draft.definition_id,
      expectedRevision: options.expectedRevision,
      expectedDraftFingerprint: draft.draft.fingerprint,
      publication,
    }, assertCurrentAuthority));
  }

  activate(
    definitionId: string,
    versionId: string,
    actorId: string,
    assertCurrentAuthority?: () => void,
  ) {
    this.requireOwnedCatalog(definitionId);
    return this.run(() => this.versions.activate(
      definitionId, versionId, actorId, assertCurrentAuthority,
    ));
  }

  retire(
    definitionId: string,
    versionId: string,
    actorId: string,
    assertCurrentAuthority?: () => void,
  ) {
    this.requireOwnedCatalog(definitionId);
    return this.run(() => this.versions.retire(
      definitionId, versionId, actorId, assertCurrentAuthority,
    ));
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

  private compilePublication(
    input: DatabaseWorkflowDefinitionInput,
    actorId: string,
  ): PublishWorkflowDefinitionVersionInput {
    const compiled = this.compile(input);
    return {
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
      scope: this.scope,
      ...(Object.prototype.hasOwnProperty.call(input, 'expectedActiveVersionId')
        ? { expectedActiveVersionId: input.expectedActiveVersionId }
        : {}),
      expectedFingerprint: compiled.fingerprint,
    };
  }

  private requireOwnedCatalog(definitionId: string): WorkflowDefinitionCatalogRecord {
    const catalog = this.versions.listCatalogs(this.scope)
      .find((candidate) => candidate.definition_id === definitionId);
    if (!catalog || !workflowDefinitionCatalogMatchesScope(catalog, this.scope)) {
      throw workflowDefinitionHidden();
    }
    return catalog;
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
