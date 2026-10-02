/**
 * workflow-definition-version-store.ts
 *
 * Owns immutable workflow-version publication, activation, retirement, and
 * integrity-checked resolution. It consumes ReactiveDB transaction/raw SQL
 * primitives but does not compile graphs or authorize callers.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import { OBS_CODES } from '../observability/codes';
import { WorkflowDefinitionDraftStore } from './workflow-definition-draft-store';
import { emitWorkflowDefinitionCode } from './workflow-definition-version-observability';
import { resolveWorkflowDefinitionVersionRecord } from './workflow-definition-version-resolution';
import { ensureWorkflowGraphSchema } from './workflow-graph-schema';
import type {
  PublishWorkflowDefinitionDraftInput,
  PublishWorkflowDefinitionVersionInput,
  PublishWorkflowDefinitionVersionResult,
  ResolveWorkflowDefinitionVersionInput,
  ResolvedWorkflowDefinitionVersion,
  WorkflowDefinitionCatalogRecord,
  WorkflowDefinitionScope,
  WorkflowDefinitionVersionRecord,
} from './workflow-definition-version-types';
import { WorkflowDefinitionVersionStoreError } from './workflow-definition-version-types';
import {
  normalizeWorkflowDefinitionScope as normalizeScope,
  requireWorkflowDefinitionName as requireName,
  canonicalizeWorkflowVersionContent,
  assertWorkflowDefinitionSourceScope,
  assertWorkflowDefinitionSource,
  assertWorkflowExpectedActiveVersion,
  workflowVersionConflict as conflict,
  workflowVersionNotFound as versionNotFound,
} from './workflow-definition-version-validation';
import {
  workflowRuntimeTransaction,
  type WorkflowRuntimeFence,
} from './workflow-runtime-fence';

type VersionDatabase = Pick<ReactiveDB, 'afterCommit' | 'exec' | 'prepare' | 'transaction'>;

/** Durable immutable-version catalog used by code and database definitions. */
export class WorkflowDefinitionVersionStore {
  readonly drafts: WorkflowDefinitionDraftStore;

  constructor(
    private readonly db: VersionDatabase,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly runtimeFence: WorkflowRuntimeFence | null = null,
  ) {
    ensureWorkflowGraphSchema(db);
    this.drafts = new WorkflowDefinitionDraftStore(db, clock, runtimeFence);
  }

  /** Publish only the exact draft revision compiled by the caller. */
  publishDraft(
    input: PublishWorkflowDefinitionDraftInput,
  ): PublishWorkflowDefinitionVersionResult {
    return this.transaction(() => {
      if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
        throw draftInvalid('Workflow draft publication requires a positive expected revision');
      }
      const draft = this.drafts.require(input.draftId).draft;
      if (draft.definition_id !== input.definitionId
        || draft.source !== input.publication.source
        || draft.revision !== input.expectedRevision
        || draft.fingerprint !== input.expectedDraftFingerprint
        || input.publication.expectedFingerprint !== draft.fingerprint) {
        throw draftConflict('Workflow draft changed before it could be published');
      }
      const catalog = this.requireCatalog(input.definitionId);
      const scope = normalizeScope(input.publication.scope);
      if (catalog.name !== requireName(input.publication.name)
        || catalog.source !== input.publication.source
        || catalog.scope_type !== scope.type
        || catalog.scope_id !== scope.id) {
        throw draftConflict('Workflow draft publication identity changed');
      }
      return this.publish(input.publication);
    });
  }

  /**
   * Publish immutable definition content and optionally make it the default.
   *
   * Automatic publication deduplicates by canonical fingerprint. Explicit
   * versions are idempotent only when the existing content is identical.
   */
  publish(
    input: PublishWorkflowDefinitionVersionInput,
  ): PublishWorkflowDefinitionVersionResult {
    const name = requireName(input.name);
    const scope = normalizeScope(input.scope);
    assertWorkflowDefinitionSourceScope(input.source, scope);
    const content = canonicalizeWorkflowVersionContent(input);
    if (input.expectedFingerprint && input.expectedFingerprint !== content.fingerprint) {
      throw conflict('Compiler and persistence fingerprints do not match');
    }
    if (input.version !== undefined
      && (!Number.isSafeInteger(input.version) || input.version < 1)) {
      throw conflict('Workflow definition version must be a positive safe integer');
    }

    let activatedNow = false;
    const result = this.transaction(() => {
      let catalog = this.findCatalogByName(name, scope);
      if (!catalog) catalog = this.createCatalog(input, name, scope, content);
      assertWorkflowDefinitionSource(catalog, input.source);
      assertWorkflowExpectedActiveVersion(catalog, input);

      const existingAtVersion = input.version === undefined
        ? null
        : this.findVersionNumber(catalog.definition_id, input.version);
      if (existingAtVersion && existingAtVersion.fingerprint !== content.fingerprint) {
        throw conflict(`Workflow definition version ${input.version} already has different content`);
      }
      const existingFingerprint = this.findVersionFingerprint(
        catalog.definition_id,
        content.fingerprint,
      );
      if (input.version !== undefined
        && !existingAtVersion
        && existingFingerprint) {
        throw conflict(
          `Workflow definition content is already published as version ${existingFingerprint.version_number}`,
        );
      }

      let version = existingAtVersion
        ?? (input.version === undefined
          ? existingFingerprint
          : null);
      let created = false;
      if (!version) {
        const versionNumber = input.version ?? Number(catalog.version) + 1;
        if (versionNumber <= Number(catalog.version)) {
          throw conflict('Explicit workflow versions must advance monotonically');
        }
        version = this.insertVersion(catalog.definition_id, versionNumber, input, content);
        created = true;
        this.updateCatalogLatest(catalog, version, input.actorId ?? null);
        catalog = this.requireCatalog(catalog.definition_id);
      }

      const shouldActivate = input.activate !== false;
      if (shouldActivate && version.status === 'retired') {
        throw conflict('A retired workflow definition version cannot be activated');
      }
      let activated = catalog.active_version_id === version.version_id;
      if (shouldActivate && !activated) {
        this.activateRecord(catalog, version, input.actorId ?? null);
        catalog = this.requireCatalog(catalog.definition_id);
        activated = true;
        activatedNow = true;
      }

      const resolved = {
        ...resolveWorkflowDefinitionVersionRecord(catalog, version),
        created,
        activated,
      };
      if (created) this.db.afterCommit(() => {
        emitWorkflowDefinitionCode(
          OBS_CODES.WORKFLOW_DEFINITION_PUBLISHED,
          resolved,
          input.actorId,
        );
      });
      if (activatedNow) this.db.afterCommit(() => {
        emitWorkflowDefinitionCode(
          OBS_CODES.WORKFLOW_DEFINITION_ACTIVATED,
          resolved,
          input.actorId,
        );
      });
      return resolved;
    });
    return result;
  }

  /** Resolve an active, numbered, or explicitly identified immutable version. */
  resolve(input: ResolveWorkflowDefinitionVersionInput): ResolvedWorkflowDefinitionVersion {
    this.runtimeFence?.assertCurrent();
    const catalog = this.resolveCatalog(input);
    let version: WorkflowDefinitionVersionRecord | null;
    if (input.versionId) version = this.findVersionId(input.versionId);
    else if (input.version !== undefined) {
      version = this.findVersionNumber(catalog.definition_id, input.version);
    } else {
      version = catalog.active_version_id
        ? this.findVersionId(catalog.active_version_id)
        : null;
    }
    if (!version || version.definition_id !== catalog.definition_id) throw versionNotFound();
    if (version.status === 'retired' && !input.includeRetired) throw versionNotFound();
    return resolveWorkflowDefinitionVersionRecord(catalog, version);
  }

  /** Activate one published version and update the legacy head mirror atomically. */
  activate(
    definitionId: string,
    versionId: string,
    actorId: string | null = null,
  ): ResolvedWorkflowDefinitionVersion {
    let activatedNow = false;
    const result = this.transaction(() => {
      const catalog = this.requireCatalog(definitionId);
      const version = this.requireOwnedVersion(definitionId, versionId);
      if (version.status === 'retired') {
        throw conflict('A retired workflow definition version cannot be activated');
      }
      resolveWorkflowDefinitionVersionRecord(catalog, version);
      if (catalog.active_version_id !== versionId) {
        this.activateRecord(catalog, version, actorId);
        activatedNow = true;
      }
      const resolved = resolveWorkflowDefinitionVersionRecord(
        this.requireCatalog(definitionId),
        version,
      );
      if (activatedNow) this.db.afterCommit(() => {
        emitWorkflowDefinitionCode(
          OBS_CODES.WORKFLOW_DEFINITION_ACTIVATED,
          resolved,
          actorId,
        );
      });
      return resolved;
    });
    return result;
  }

  /** Retire a version for new starts without changing pinned workflow instances. */
  retire(
    definitionId: string,
    versionId: string,
    actorId: string | null = null,
  ): ResolvedWorkflowDefinitionVersion {
    let retiredNow = false;
    const result = this.transaction(() => {
      let catalog = this.requireCatalog(definitionId);
      let version = this.requireOwnedVersion(definitionId, versionId);
      resolveWorkflowDefinitionVersionRecord(catalog, version);
      if (version.status !== 'retired') {
        retiredNow = true;
        const now = this.clock();
        if (catalog.active_version_id === versionId) {
          this.db.prepare(`UPDATE workflow_definitions SET active_version_id = NULL,
            status = 'retired', updated_by = ?, updated_at = ? WHERE definition_id = ?`)
            .run(actorId, now, definitionId);
        }
        this.db.prepare(`UPDATE workflow_definition_versions
          SET status = 'retired', retired_by = ?, retired_at = ? WHERE version_id = ?`)
          .run(actorId, now, versionId);
        catalog = this.requireCatalog(definitionId);
        version = this.requireOwnedVersion(definitionId, versionId);
      }
      const resolved = resolveWorkflowDefinitionVersionRecord(catalog, version);
      if (retiredNow) this.db.afterCommit(() => {
        emitWorkflowDefinitionCode(
          OBS_CODES.WORKFLOW_DEFINITION_RETIRED,
          resolved,
          actorId,
        );
      });
      return resolved;
    });
    return result;
  }

  /** List immutable version metadata newest first; content remains server-only. */
  listVersions(definitionId: string): WorkflowDefinitionVersionRecord[] {
    this.runtimeFence?.assertCurrent();
    this.requireCatalog(definitionId);
    return this.db.prepare(`SELECT * FROM workflow_definition_versions
      WHERE definition_id = ? ORDER BY version_number DESC`)
      .all(definitionId) as WorkflowDefinitionVersionRecord[];
  }

  /** List definition catalog metadata without exposing executable graph JSON. */
  listCatalogs(scope?: WorkflowDefinitionScope): WorkflowDefinitionCatalogRecord[] {
    this.runtimeFence?.assertCurrent();
    if (!scope) {
      return this.db.prepare(`SELECT * FROM workflow_definitions
        ORDER BY name ASC, definition_id ASC`)
        .all() as WorkflowDefinitionCatalogRecord[];
    }
    const normalized = normalizeScope(scope);
    return this.db.prepare(`SELECT * FROM workflow_definitions
      WHERE scope_type = ? AND scope_id = ?
      ORDER BY name ASC, definition_id ASC`)
      .all(normalized.type, normalized.id) as WorkflowDefinitionCatalogRecord[];
  }

  private createCatalog(
    input: PublishWorkflowDefinitionVersionInput,
    name: string,
    scope: Required<WorkflowDefinitionScope>,
    content: ReturnType<typeof canonicalizeWorkflowVersionContent>,
  ): WorkflowDefinitionCatalogRecord {
    const nameCollision = this.db.prepare(
      'SELECT * FROM workflow_definitions WHERE name = ? LIMIT 1',
    ).get(name) as WorkflowDefinitionCatalogRecord | null;
    if (nameCollision) {
      throw new WorkflowDefinitionVersionStoreError(
        'Workflow definition name is already owned by another scope',
        'WORKFLOW_DEFINITION_SCOPE_CONFLICT',
        409,
      );
    }
    const definitionId = crypto.randomUUID();
    const now = this.clock();
    this.db.prepare(`INSERT INTO workflow_definitions (
      definition_id, name, version, steps_json, input_schema, created_at, updated_at,
      active_version_id, source, scope_type, scope_id, status, access_policy_json,
      created_by, updated_by
    ) VALUES (?, ?, 0, ?, ?, ?, ?, NULL, ?, ?, ?, 'active', ?, ?, ?)`)
      .run(
        definitionId,
        name,
        content.graphJson,
        content.inputSchemaJson,
        now,
        now,
        input.source,
        scope.type,
        scope.id,
        content.accessPolicyJson,
        input.actorId ?? null,
        input.actorId ?? null,
      );
    return this.requireCatalog(definitionId);
  }

  private insertVersion(
    definitionId: string,
    versionNumber: number,
    input: PublishWorkflowDefinitionVersionInput,
    content: ReturnType<typeof canonicalizeWorkflowVersionContent>,
  ): WorkflowDefinitionVersionRecord {
    const versionId = crypto.randomUUID();
    this.db.prepare(`INSERT INTO workflow_definition_versions (
      version_id, definition_id, version_number, source, graph_format,
      schema_version, graph_json, input_schema_json, access_policy_json,
      fingerprint, status, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?)`)
      .run(
        versionId,
        definitionId,
        versionNumber,
        input.source,
        input.graphFormat,
        input.schemaVersion,
        content.graphJson,
        content.inputSchemaJson,
        content.accessPolicyJson,
        content.fingerprint,
        input.actorId ?? null,
        this.clock(),
      );
    return this.requireOwnedVersion(definitionId, versionId);
  }

  private updateCatalogLatest(
    catalog: WorkflowDefinitionCatalogRecord,
    version: WorkflowDefinitionVersionRecord,
    actorId: string | null,
  ): void {
    this.db.prepare(`UPDATE workflow_definitions SET version = ?, updated_by = ?,
      updated_at = ? WHERE definition_id = ?`).run(
      Math.max(Number(catalog.version), version.version_number),
      actorId,
      this.clock(),
      catalog.definition_id,
    );
  }

  private activateRecord(
    catalog: WorkflowDefinitionCatalogRecord,
    version: WorkflowDefinitionVersionRecord,
    actorId: string | null,
  ): void {
    this.db.prepare(`UPDATE workflow_definitions SET active_version_id = ?, version = ?,
      steps_json = ?, input_schema = ?, access_policy_json = ?, status = 'active',
      updated_by = ?, updated_at = ? WHERE definition_id = ?`).run(
      version.version_id,
      Math.max(Number(catalog.version), version.version_number),
      version.graph_json,
      version.input_schema_json,
      version.access_policy_json,
      actorId,
      this.clock(),
      catalog.definition_id,
    );
  }

  private resolveCatalog(input: ResolveWorkflowDefinitionVersionInput): WorkflowDefinitionCatalogRecord {
    if (input.definitionId) return this.requireCatalog(input.definitionId);
    if (input.versionId) {
      const version = this.findVersionId(input.versionId);
      if (!version) throw versionNotFound();
      return this.requireCatalog(version.definition_id);
    }
    if (!input.name) throw versionNotFound();
    const catalog = this.findCatalogByName(requireName(input.name), normalizeScope(input.scope));
    if (!catalog) throw versionNotFound();
    return catalog;
  }

  private findCatalogByName(
    name: string,
    scope: Required<WorkflowDefinitionScope>,
  ): WorkflowDefinitionCatalogRecord | null {
    return (this.db.prepare(`SELECT * FROM workflow_definitions
      WHERE name = ? AND scope_type = ? AND scope_id = ? LIMIT 1`)
      .get(name, scope.type, scope.id) as WorkflowDefinitionCatalogRecord | null) ?? null;
  }

  private requireCatalog(definitionId: string): WorkflowDefinitionCatalogRecord {
    const row = this.db.prepare('SELECT * FROM workflow_definitions WHERE definition_id = ?')
      .get(definitionId) as WorkflowDefinitionCatalogRecord | null;
    if (!row) throw versionNotFound();
    return row;
  }

  private findVersionId(versionId: string): WorkflowDefinitionVersionRecord | null {
    return (this.db.prepare('SELECT * FROM workflow_definition_versions WHERE version_id = ?')
      .get(versionId) as WorkflowDefinitionVersionRecord | null) ?? null;
  }

  private findVersionNumber(
    definitionId: string,
    version: number,
  ): WorkflowDefinitionVersionRecord | null {
    return (this.db.prepare(`SELECT * FROM workflow_definition_versions
      WHERE definition_id = ? AND version_number = ?`).get(
        definitionId,
        version,
      ) as WorkflowDefinitionVersionRecord | null) ?? null;
  }

  private findVersionFingerprint(
    definitionId: string,
    fingerprint: string,
  ): WorkflowDefinitionVersionRecord | null {
    return (this.db.prepare(`SELECT * FROM workflow_definition_versions
      WHERE definition_id = ? AND fingerprint = ?`).get(
        definitionId,
        fingerprint,
      ) as WorkflowDefinitionVersionRecord | null) ?? null;
  }

  private requireOwnedVersion(definitionId: string, versionId: string): WorkflowDefinitionVersionRecord {
    const version = this.findVersionId(versionId);
    if (!version || version.definition_id !== definitionId) throw versionNotFound();
    return version;
  }

  private transaction<T>(operation: () => T): T {
    return workflowRuntimeTransaction(this.db, this.runtimeFence, operation);
  }

}

function draftInvalid(message: string): WorkflowDefinitionVersionStoreError {
  return new WorkflowDefinitionVersionStoreError(
    message,
    'WORKFLOW_DEFINITION_DRAFT_INVALID',
    422,
  );
}

function draftConflict(message: string): WorkflowDefinitionVersionStoreError {
  return new WorkflowDefinitionVersionStoreError(
    message,
    'WORKFLOW_DEFINITION_DRAFT_CONFLICT',
    409,
  );
}
