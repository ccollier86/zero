/** Actor-bound public authoring over Torrent's canonical manager; no HTTP, ambient scope or second graph store. */
import type { DatabaseWorkflowDefinitionInput, DatabaseWorkflowDraftInput, WorkflowDefinitionManager } from './workflow-definition-manager';
import { WorkflowError } from './workflow-error';

/** Stable keyset pagination for bounded authoring metadata. */
export interface WorkflowAuthoringPageOptions { limit?: number; after?: string }
export interface WorkflowAuthoringPage<T, Cursor = string> { items: T[]; nextCursor: Cursor | null }
export type WorkflowCreateDraftInput = Omit<DatabaseWorkflowDefinitionInput, 'version' | 'activate' | 'expectedActiveVersionId' | 'expectedFingerprint'> & { editorMetadata?: unknown };
export interface WorkflowPublishDraftOptions { expectedRevision: number; version?: number; activate?: boolean; expectedActiveVersionId?: string | null }

/** Safe retained authoring service. Every call rechecks its exact original actor and scope. */
export interface WorkflowDefinitionAuthoring {
  list(options?: WorkflowAuthoringPageOptions): WorkflowAuthoringPage<ReturnType<WorkflowDefinitionManager['page']>[number]>;
  versions(definitionId: string, options?: { limit?: number; before?: number }): WorkflowAuthoringPage<ReturnType<WorkflowDefinitionManager['pageVersions']>[number], number>;
  drafts(definitionId: string, options?: WorkflowAuthoringPageOptions): WorkflowAuthoringPage<ReturnType<WorkflowDefinitionManager['pageDrafts']>[number]>;
  activities(): ReturnType<WorkflowDefinitionManager['listActivities']>;
  getVersion(definitionId: string, versionId: string): ReturnType<WorkflowDefinitionManager['getVersion']>;
  getDraft(draftId: string): ReturnType<WorkflowDefinitionManager['getDraft']>;
  validate(input: DatabaseWorkflowDefinitionInput): ReturnType<WorkflowDefinitionManager['validate']>;
  createDraft(input: WorkflowCreateDraftInput): ReturnType<WorkflowDefinitionManager['createDraft']>;
  saveDraft(input: DatabaseWorkflowDraftInput): ReturnType<WorkflowDefinitionManager['saveDraft']>;
  deleteDraft(draftId: string, expectedRevision: number): boolean;
  publish(input: DatabaseWorkflowDefinitionInput): ReturnType<WorkflowDefinitionManager['publish']>;
  publishDraft(draftId: string, options: WorkflowPublishDraftOptions): ReturnType<WorkflowDefinitionManager['publishDraft']>;
  activate(definitionId: string, versionId: string, expectedActiveVersionId: string | null): ReturnType<WorkflowDefinitionManager['activate']>;
  retire(definitionId: string, versionId: string): ReturnType<WorkflowDefinitionManager['retire']>;
}

/** Framework assembly only. Apps obtain this facade through zero.workflows.definitions or definitionsForActor. */
export function createWorkflowDefinitionAuthoring(manager: WorkflowDefinitionManager, actorId: string,
  assertAuthority: () => void, assertOutsideTransaction: () => void): WorkflowDefinitionAuthoring {
  const read = <T>(operation: () => T): T => { assertOutsideTransaction(); assertAuthority(); const result = operation(); assertAuthority(); return result; };
  const write = <T>(operation: () => T): T => read(() => manager.command(operation, assertAuthority));
  return Object.freeze({
    list: (options: WorkflowAuthoringPageOptions = {}) => read(() => {
      const limit = pageLimit(options.limit), after = pageCursor(options.after);
      return page(manager.page(limit + 1, after), limit, item => item.name);
    }),
    versions: (id: string, options: { limit?: number; before?: number } = {}) => read(() => {
      const limit = pageLimit(options.limit), before = options.before;
      if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) throw invalid('Version cursor must be a positive integer');
      return page(manager.pageVersions(id, limit + 1, before), limit, item => item.version_number);
    }),
    drafts: (id: string, options: WorkflowAuthoringPageOptions = {}) => read(() => {
      const limit = pageLimit(options.limit);
      return page(manager.pageDrafts(id, limit + 1, pageCursor(options.after)), limit, item => item.draft_id);
    }),
    activities: () => read(() => manager.listActivities()),
    getVersion: (id: string, versionId: string) => read(() => manager.getVersion(id, versionId)),
    getDraft: (id: string) => read(() => manager.getDraft(id)),
    validate: (input: DatabaseWorkflowDefinitionInput) => read(() => { definitionInput(input, PUBLICATION_FIELDS); return manager.validate(input); }),
    createDraft: (input: WorkflowCreateDraftInput) => write(() => { definitionInput(input, ['name', 'graph', 'inputSchema', 'access', 'editorMetadata']); return manager.createDraft(input, actorId, assertAuthority); }),
    saveDraft: (input: DatabaseWorkflowDraftInput) => write(() => { definitionInput(input, ['name', 'graph', 'definitionId', 'inputSchema', 'access', 'editorMetadata', 'baseVersionId', 'draftId', 'expectedRevision']); return manager.saveDraft(input, actorId, assertAuthority); }),
    deleteDraft: (id: string, revision: number) => write(() => manager.deleteDraft(id, revision, assertAuthority)),
    publish: (input: DatabaseWorkflowDefinitionInput) => write(() => { definitionInput(input, PUBLICATION_FIELDS); return manager.publish(input, actorId, assertAuthority); }),
    publishDraft: (id: string, options: WorkflowPublishDraftOptions) => write(() => manager.publishDraft(id, actorId, options, assertAuthority)),
    activate: (id: string, versionId: string, expectedActiveVersionId: string | null) => write(() => {
      const current = manager.getVersion(id, versionId);
      if (current.catalog.active_version_id !== expectedActiveVersionId) throw new WorkflowError('Workflow active version changed', 'WORKFLOW_VERSION_CONFLICT', 409);
      return manager.activate(id, versionId, actorId, assertAuthority);
    }),
    retire: (id: string, versionId: string) => write(() => manager.retire(id, versionId, actorId, assertAuthority)),
  });
}

function pageLimit(value = 40): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw invalid('Page limit must be an integer from 1 to 100');
  return value;
}
function pageCursor(value = ''): string {
  if (typeof value !== 'string' || value.length > 512) throw invalid('Page cursor is invalid');
  return value;
}
function page<T, C>(items: T[], limit: number, cursor: (item: T) => C): WorkflowAuthoringPage<T, C> {
  const more = items.length > limit;
  const selected = items.slice(0, limit);
  return { items: selected, nextCursor: more ? cursor(selected[selected.length - 1]!) : null };
}
function invalid(message: string) { return new WorkflowError(message, 'WORKFLOW_REQUEST_INVALID', 422); }

const PUBLICATION_FIELDS = ['name', 'graph', 'inputSchema', 'access', 'version', 'activate', 'expectedActiveVersionId', 'expectedFingerprint'];
/** Do not let hidden/getter fields or an ignored caller-selected actor/scope/source masquerade as admitted configuration. */
function definitionInput(value: unknown, allowed: readonly string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('Workflow authoring input must be an object');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw invalid('Workflow authoring input must be a plain object');
  for (const key of Reflect.ownKeys(value)) {
    const property = typeof key === 'string' ? Object.getOwnPropertyDescriptor(value, key) : null;
    if (typeof key !== 'string' || !allowed.includes(key) || !property?.enumerable || !('value' in property)) throw invalid('Workflow authoring input contains an unsupported field');
  }
  const name = (value as { name?: unknown }).name;
  if (typeof name !== 'string' || !name.trim() || name !== name.trim()) throw invalid('Workflow definition name must be nonempty and trimmed');
}
