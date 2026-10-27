/** Private in-memory stages. Real SHA-256/allocation/upload results drive state; no pretend progress. */
import type { WorkspaceSource, MessagingWorkspaceUpload } from './workspace-state';
import { MESSAGING_ATTACHMENT_MIMES } from '../../messaging/attachment-contracts';
interface Stage { readonly localId: string; readonly conversationId: string; readonly file: File; readonly allocateId: string; readonly uploadId: string;
  readonly abort: AbortController; readonly visibility: 'conversation' | 'staff'; assetId: string | null; state: MessagingWorkspaceUpload['state']; task?: Promise<void> }
export class MessagingWorkspaceUploads {
  private readonly stages = new Map<string, Stage>();
  hasUnfinished(): boolean { return this.stages.size > 0; }
  constructor(private readonly source: WorkspaceSource, private readonly current: () => boolean, private readonly signal: AbortSignal, private readonly changed: () => void) {}
  snapshot(id: string, visibility: 'conversation' | 'staff' = 'conversation'): readonly MessagingWorkspaceUpload[] {
    return [...this.stages.values()].filter(stage => stage.conversationId === id && stage.visibility === visibility).map(stage => ({ id: stage.localId, name: stage.file.name, state: stage.state, attachmentId: stage.assetId }));
  }
  add(id: string, files: readonly File[], maximum: number, visibility: 'conversation' | 'staff'): void {
    if (!this.current()) return;
    if (!files.length || this.snapshot(id, visibility).length + files.length > 10 || this.stages.size + files.length > 32
      || [...this.stages.values()].reduce((sum, stage) => sum + stage.file.size, 0) + files.reduce((sum, file) => sum + file.size, 0) > 256 * 1024 * 1024
      || files.some(file => file.size < 1 || file.size > maximum || !file.name || file.name.length > 180 || /[/\\\p{Cc}\p{Cs}]/u.test(file.name)
        || !(MESSAGING_ATTACHMENT_MIMES as readonly string[]).includes(file.type))) {
      throw new Error('Choose up to ten supported files within the configured upload limit.');
    }
    for (const file of files) {
      const stage: Stage = { localId: crypto.randomUUID(), conversationId: id, file, allocateId: crypto.randomUUID(), uploadId: crypto.randomUUID(), abort: new AbortController(), visibility, assetId: null, state: 'uploading' };
      this.stages.set(stage.localId, stage); void this.upload(stage);
    }
    this.changed();
  }
  retry(localId: string): Promise<void> { const stage = this.stages.get(localId); return stage ? this.upload(stage) : Promise.resolve(); }
  async remove(localId: string): Promise<void> {
    const stage = this.stages.get(localId); if (!stage || !this.current()) return;
    stage.abort.abort(); this.stages.delete(localId); this.changed();
    // Allocation may be uncertain; do not fabricate an ID or delete anything
    // by filename. Native retention cleans unattached stages safely.
    if (stage.assetId) await this.source.attachments.remove(stage.conversationId, stage.assetId, { requestId: crypto.randomUUID(), signal: this.signal });
  }
  accepted(id: string, attachmentIds: readonly string[]): void {
    for (const [key, stage] of this.stages) if (stage.conversationId === id && stage.assetId && attachmentIds.includes(stage.assetId)) { stage.abort.abort(); this.stages.delete(key); }
    this.changed();
  }
  clear(): void { for (const stage of this.stages.values()) stage.abort.abort(); this.stages.clear(); }
  private upload(stage: Stage): Promise<void> {
    if (stage.task) return stage.task;
    if (!this.current() || stage.abort.signal.aborted) return Promise.resolve();
    stage.state = 'uploading'; this.changed();
    const signal = AbortSignal.any([this.signal, stage.abort.signal]);
    const work = (async () => {
      try {
        const bytes = await stage.file.arrayBuffer(); if (!this.current()) return; signal.throwIfAborted();
        const digest = await crypto.subtle.digest('SHA-256', bytes); if (!this.current()) return; signal.throwIfAborted();
        const checksum = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
        const allocated = await this.source.attachments.allocate(stage.conversationId, { fileName: stage.file.name, mimeType: stage.file.type, sizeBytes: stage.file.size, checksum, visibility: stage.visibility }, { requestId: stage.allocateId, signal });
        if (!this.current()) return; signal.throwIfAborted();
        if (allocated.conversationId !== stage.conversationId || allocated.checksum !== checksum || allocated.sizeBytes !== stage.file.size) throw new Error('Incompatible allocation acknowledgment.');
        stage.assetId = allocated.id;
        const ready = allocated.state === 'ready' ? allocated : await this.source.attachments.upload(stage.conversationId, allocated.id, stage.file, { requestId: stage.uploadId, signal });
        if (!this.current()) return; signal.throwIfAborted();
        if (ready.id !== stage.assetId || ready.conversationId !== stage.conversationId || ready.state !== 'ready') throw new Error('Incompatible attachment acknowledgment.');
        stage.state = 'ready';
      } catch { if (this.current() && !signal.aborted) stage.state = 'failed'; }
      finally { stage.task = undefined; if (this.current() && this.stages.has(stage.localId)) this.changed(); }
    })(); stage.task = work; return work;
  }
}
