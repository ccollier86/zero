/** Acknowledged blog draft state. Owns stable retry identities, revisions and concurrent-edit reconciliation; never guesses a committed outcome. */
import type { BlogPostContent, BlogPostRecord, BlogPostsApi } from '../../blog/content-types';
import type { FormSubmitResult } from '../../hooks/form-save-types';

type Action = 'save' | 'publish' | 'withdraw' | 'trash' | 'restore';
export interface BlogDraftState {
  readonly record: BlogPostRecord | null;
  readonly content: BlogPostContent;
  readonly dirty: boolean;
  readonly busy: boolean;
  readonly uncertain: boolean;
  readonly conflict: boolean;
  readonly incomingRevision: number | null;
  readonly error: string | null;
}
interface Attempt { action: Action; requestId: string; content: BlogPostContent; execute(signal: AbortSignal): Promise<BlogPostRecord> }
/** Every UI action uses the same public API and original request identity after an interrupted response. */
export class BlogDraftController {
  private state: BlogDraftState;
  private readonly initial: BlogPostContent;
  private readonly lifetime = new AbortController();
  private readonly listeners = new Set<() => void>();
  private attempt: Attempt | null = null;
  constructor(private readonly api: BlogPostsApi, content: BlogPostContent, record: BlogPostRecord | null = null) {
    this.initial = structuredClone(content);
    this.state = { record, content: this.initial, dirty: false, busy: false, uncertain: false, conflict: false, incomingRevision: null, error: null };
  }
  readonly getSnapshot = () => this.state;
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  setContent(content: BlogPostContent): void {
    if (this.lifetime.signal.aborted) return;
    this.set({ content: structuredClone(content), dirty: JSON.stringify(content) !== JSON.stringify(this.state.record?.content ?? this.initial) });
  }
  /** An authoritative competing revision is a warning, not permission to replace an unsaved draft. */
  incoming(record: BlogPostRecord): void {
    if (this.lifetime.signal.aborted || record.id !== this.state.record?.id || record.revision <= this.state.record.revision) return;
    if (this.state.busy || this.state.dirty || this.state.uncertain) this.set({ incomingRevision: record.revision });
    else this.adopt(record);
  }
  reload(record: BlogPostRecord): void {
    if (this.state.busy || this.state.uncertain) throw new Error('Reconcile the pending operation first.');
    if (this.state.record && this.state.record.id !== record.id) throw new Error('Draft target changed.');
    this.adopt(record);
  }
  reset(): void {
    if (this.state.busy || this.state.uncertain) throw new Error('Reconcile the original operation before discarding.');
    this.set({ content: structuredClone(this.state.record?.content ?? this.initial), dirty: false, error: null });
  }
  async save(): Promise<FormSubmitResult> { return this.execute('save'); }
  async act(action: Exclude<Action, 'save'>, revision?: number): Promise<FormSubmitResult> { return this.execute(action, revision); }
  /** A retry repeats exactly the retained action, body and expected revision, not the caller's latest edits. */
  async retry(): Promise<FormSubmitResult> { return this.attempt ? this.execute(this.attempt.action) : { kind: 'blocked' }; }
  close(): void { this.lifetime.abort(); this.listeners.clear(); }
  private async execute(action: Action, revision?: number): Promise<FormSubmitResult> {
    if (this.lifetime.signal.aborted) return { kind: 'retired' };
    if (this.state.busy) return { kind: 'blocked' };
    if (this.state.conflict) return { kind: 'failed', error: this.state.error ?? 'Reload the current revision before saving.', conflict: true };
    if (this.attempt && this.attempt.action !== action) return { kind: 'blocked' };
    if (!this.attempt && action !== 'save' && (!this.state.record || this.state.dirty)) return { kind: 'blocked' };
    if (!this.attempt && action === 'save' && this.state.record && !this.state.dirty) return this.accepted(this.state.record);
    if (!this.attempt) {
      const content = structuredClone(this.state.content), record = this.state.record, requestId = crypto.randomUUID();
      this.attempt = { action, content, requestId, execute: signal => {
        const options = { requestId, signal };
        if (action === 'save') return record ? this.api.update(record.id, record.revision, content, options) : this.api.create(content, options);
        if (action === 'restore') return this.api.restore(record!.id, record!.revision, revision!, options);
        return this.api[action](record!.id, record!.revision, options);
      } };
    }
    const attempt = this.attempt;
    this.set({ busy: true, error: null });
    try {
      const accepted = await attempt.execute(this.lifetime.signal);
      if (this.lifetime.signal.aborted) return { kind: 'retired' };
      this.attempt = null;
      const editedDuringSave = JSON.stringify(this.state.content) !== JSON.stringify(attempt.content);
      const content = editedDuringSave ? this.state.content : accepted.content;
      this.set({ record: accepted, content, dirty: JSON.stringify(content) !== JSON.stringify(accepted.content), busy: false, uncertain: false, conflict: false, incomingRevision: null, error: null });
      return this.accepted(accepted);
    } catch (error) {
      if (this.lifetime.signal.aborted) return { kind: 'retired' };
      const detail = failure(error), conflict = detail.code === 'BLOG_REVISION_CONFLICT';
      const knownRejected = !['BLOG_OUTCOME_UNKNOWN', 'DATABASE_OUTCOME_UNKNOWN'].includes(detail.code) && detail.status >= 400 && detail.status < 500;
      if (knownRejected) this.attempt = null;
      const message = conflict ? 'This article changed elsewhere. Your draft is preserved. Compare or reload the current revision before saving.'
        : knownRejected ? 'The change was not accepted. Check the title, slug, author, media alternatives and current permissions, then try again.'
          : 'The outcome is not confirmed. Retry the original operation before publishing or making another change.';
      this.set({ busy: false, uncertain: !knownRejected, conflict, error: message });
      return { kind: 'failed', conflict, error: message };
    }
  }
  private accepted(record: BlogPostRecord): FormSubmitResult { return { kind: 'accepted', values: { id: record.id, revision: record.revision }, revision: record.revision }; }
  private adopt(record: BlogPostRecord) { this.attempt = null; this.set({ record, content: structuredClone(record.content), dirty: false, incomingRevision: null, conflict: false, uncertain: false, error: null }); }
  private set(changes: Partial<BlogDraftState>) { this.state = { ...this.state, ...changes }; for (const listener of this.listeners) listener(); }
}
function failure(error: unknown): { code: string; status: number } {
  if (!error || typeof error !== 'object') return { code: '', status: 0 };
  const value = error as { status?: unknown; code?: unknown; body?: { code?: unknown } };
  const code = value.code ?? value.body?.code;
  return { status: typeof value.status === 'number' ? value.status : 0, code: typeof code === 'string' ? code : '' };
}
