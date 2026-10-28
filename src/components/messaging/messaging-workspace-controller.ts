/** One scoped view owner over the existing native messaging facade. No polling database or second authentication client. */
import type { ConversationRecord, DurableMessage, MessagingPerson } from '../../messaging/contracts';
import { MessagingLiveError } from '../../messaging/live-error';
import { MessagingWorkspaceSends } from './workspace-send';
import { MessagingWorkspaceTranscript } from './workspace-transcript';
import { MessagingWorkspaceUploads } from './workspace-uploads';
import { MessagingWorkspaceCommands } from './workspace-command';
import type { MessagingMutationOptions, MessagingReceipt } from '../../messaging/contracts';
import { initialMessagingWorkspaceState, messagingErrorStatus, type MessagingWorkspaceState, type MessagingWorkspaceControllerOptions, type WorkspaceSource } from './workspace-state';

export class MessagingWorkspaceController {
  private state = initialMessagingWorkspaceState(); private readonly listeners = new Set<() => void>();
  private readonly abort = new AbortController(); private selectedAbort: AbortController | null = null;
  private stopList: (() => void) | undefined; private stopHead: (() => void) | undefined;
  private transcript: MessagingWorkspaceTranscript | null = null; private selection = 0; private started = false; private following = true;
  private listEpoch = 0; private readonly cursors: Array<string | undefined> = [undefined];
  private readonly sends: MessagingWorkspaceSends; private readonly uploads: MessagingWorkspaceUploads;
  private readonly commands: MessagingWorkspaceCommands;
  private reading: Promise<void> | null = null; private readonly readPositions = new Map<string, number>();
  private refreshing: { epoch: number; task: Promise<void>; again: boolean } | null = null;
  private readonly maximum: number;
  constructor(readonly source: WorkspaceSource, readonly userId: string, private readonly options: MessagingWorkspaceControllerOptions = {}) {
    this.maximum = options.maxMessages ?? 500;
    if (!Number.isSafeInteger(this.maximum) || this.maximum < 50 || this.maximum > 1000) throw new Error('Messaging maxMessages must be an integer between 50 and 1000.');
    this.uploads = new MessagingWorkspaceUploads(source, this.current, this.abort.signal, () => this.draftChanged());
    this.commands = new MessagingWorkspaceCommands(source, this.current, this.abort.signal, () => this.set({ command: this.commands.snapshot() }));
    this.sends = new MessagingWorkspaceSends(source, this.current, this.abort.signal, () => this.draftChanged(), (id, message) => {
      this.uploads.accepted(id, message.attachmentIds);
      if (this.state.selectedId === id) this.transcript?.accepted(message);
    });
  }
  readonly current = (): boolean => !this.abort.signal.aborted && (this.options.isCurrent?.() ?? true);
  readonly getSnapshot = (): MessagingWorkspaceState => this.current() ? this.state : initialEmpty;
  hasUnfinished(): boolean { return this.current() && (this.sends.hasUnfinished() || this.uploads.hasUnfinished() || !!this.commands.snapshot() && this.commands.snapshot()?.phase !== 'rejected'); }
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  async start(): Promise<void> {
    if (this.started || !this.current()) return; this.started = true;
    try {
      const capabilities = await this.source.capabilities(); if (!this.current()) return;
      if (!capabilities.enabled) { this.set({ status: 'disabled' }); return; }
      this.set({ status: 'ready', capabilities });
      this.watchList(0);
    } catch (error) { if (this.current()) this.set({ status: messagingErrorStatus(error) === 404 ? 'disabled' : 'error', error: 'Messaging could not be loaded. Please retry.' }); }
  }
  async moreConversations(): Promise<void> {
    if (!this.current() || !this.state.conversationsCursor || this.state.loadingConversations) return;
    const page = this.state.conversationPage + 1; this.cursors[page] = this.state.conversationsCursor; this.watchList(page);
  }
  previousConversations(): void { if (this.current() && this.state.conversationPage > 0 && !this.state.loadingConversations) this.watchList(this.state.conversationPage - 1); }
  latestConversations(archived = this.state.showArchived): void { if (this.current()) { this.cursors.splice(1); this.set({ showArchived: archived }); this.watchList(0); } }
  async select(id: string | null): Promise<void> {
    if (!this.current() || id === this.state.selectedId && !this.selectedAbort?.signal.aborted) return;
    const epoch = ++this.selection; this.selectedAbort?.abort(); this.stopHead?.(); this.transcript?.close(); this.transcript = null; this.reading = null;
    const abort = this.selectedAbort = new AbortController(), signal = AbortSignal.any([this.abort.signal, abort.signal]);
    const current = () => this.current() && epoch === this.selection && !signal.aborted;
    this.following = true;
    this.set({ selectedId: id, conversation: null, people: {}, messages: [], loading: !!id, loadingOlder: false, hasOlder: false, hasNewer: false,
      error: null, readError: null, visibility: 'conversation', draft: id ? this.sends.draft(id) : initialEmpty.draft, uploads: id ? this.uploads.snapshot(id) : [], live: 'connecting' });
    if (!id) return;
    try {
      const [conversation, people, page] = await Promise.all([this.source.conversations.get(id, { signal }), this.source.conversations.people(id, { signal }), this.source.messages.list(id, { limit: 50 }, { signal })]);
      if (!current()) return;
      this.set({ conversation, people: Object.fromEntries(people.items.map(row => [row.id, row])) });
      const onError = (error: unknown) => { if (!current()) return; if (error instanceof MessagingLiveError && !error.retryable) this.denySelection(); else this.set({ live: 'unavailable' }); };
      this.transcript = new MessagingWorkspaceTranscript(this.source, id, current, { signal, onError }, () => this.state.messages,
        (messages, hasOlder, hasNewer) => { if (current()) this.set({ messages, ...(hasOlder === undefined ? {} : { hasOlder }), ...(hasNewer === undefined ? {} : { hasNewer }) }); }, () => this.following, this.maximum);
      this.transcript.receive(page);
      this.stopHead = this.source.watchMessages(id, value => { if (current()) this.transcript?.receive(value); }, { signal, query: { limit: 50 }, onError, onConnection: live => { if (current()) this.set({ live }); } });
      if (current()) this.set({ loading: false });
    } catch { if (current()) this.denySelection(); }
  }
  async older(): Promise<void> {
    const id = this.state.selectedId, first = this.state.messages[0], epoch = this.selection;
    if (!id || !first || !this.current() || this.state.loadingOlder || !this.state.hasOlder) return;
    this.following = false;
    this.set({ loadingOlder: true });
    try { const page = await this.source.messages.list(id, { before: first.sequence, limit: Math.min(50, Math.floor(this.maximum / 2)) }, { signal: this.selectedAbort?.signal });
      if (this.current() && epoch === this.selection && this.transcript) {
        this.transcript.backfill(page);
      }
    } catch { if (this.current() && epoch === this.selection) this.set({ error: 'Earlier messages could not be loaded.' }); }
    finally { if (epoch === this.selection) this.set({ loadingOlder: false }); }
  }
  setFollowing(value: boolean, id = this.state.selectedId): void { if (this.current() && id === this.state.selectedId) this.following = value; }
  observeVisible(sequence: number, id = this.state.selectedId): void { if (this.current() && id === this.state.selectedId) this.transcript?.observe(sequence); }
  latest(expectedId = this.state.selectedId): void { if (!this.current() || expectedId !== this.state.selectedId) return; this.following = true; this.transcript?.reset(); }
  edit(text: string, id = this.state.selectedId, visibility = this.state.visibility): void {
    if (!id || id !== this.state.selectedId || visibility !== this.state.visibility || !this.state.conversation) return;
    try { this.sends.edit(id, text, this.state.capabilities?.maxMessageLength ?? 20000, this.state.visibility); }
    catch { this.set({ error: 'This draft could not be updated. Check the character limit, or finish one of the 32 retained drafts first.' }); }
  }
  setVisibility(visibility: 'conversation' | 'staff', expectedId = this.state.selectedId): void {
    if (!this.current() || expectedId !== this.state.selectedId || !this.state.conversation || !this.canEdit() || this.state.uploads.length
      || visibility === 'staff' && this.state.conversation.participants.find(row => row.id === this.userId)?.role !== 'staff') return;
    this.set({ visibility }); this.draftChanged();
  }
  send(retry = false, visibility: 'conversation' | 'staff' = 'conversation', expectedId = this.state.selectedId): Promise<void> {
    const id = this.state.selectedId, conversation = this.state.conversation;
    if (!id || id !== expectedId || visibility !== this.state.visibility || !conversation || !this.current() || this.state.uploads.some(row => row.state !== 'ready')) return Promise.resolve();
    return this.sends.send(id, this.state.uploads.flatMap(row => row.attachmentId ? [row.attachmentId] : []), retry, { visibility, expectedOwnerEpoch: conversation.ownerEpoch });
  }
  reconcileSend(expectedId = this.state.selectedId): Promise<void> { return this.state.selectedId && expectedId === this.state.selectedId ? this.sends.reconcile(this.state.selectedId, this.state.visibility) : Promise.resolve(); }
  addFiles(files: readonly File[], visibility: 'conversation' | 'staff' = 'conversation', expectedId = this.state.selectedId): void {
    if (!this.canEdit() || !this.state.selectedId || expectedId !== this.state.selectedId || visibility !== this.state.visibility) return;
    try { this.uploads.add(this.state.selectedId, files, this.state.capabilities!.maxUploadBytes, visibility); }
    catch { this.set({ error: 'Choose up to ten supported files within the upload limit. Retained draft files are also bounded to 256 MiB.' }); }
  }
  retryFile(id: string): Promise<void> { return this.canEdit() && this.state.uploads.some(row => row.id === id) ? this.uploads.retry(id) : Promise.resolve(); }
  removeFile(id: string): Promise<void> { return this.canEdit() && this.state.uploads.some(row => row.id === id) ? this.uploads.remove(id).catch(() => { this.set({ error: 'The file was removed from this draft; server cleanup is not yet confirmed.' }); }) : Promise.resolve(); }
  async attachment(id: string): Promise<Blob> {
    const conversation = this.state.selectedId, epoch = this.selection; if (!conversation || !this.current()) throw new DOMException('Messaging selection changed.', 'AbortError');
    const file = await this.source.attachments.download(conversation, id, { signal: this.selectedAbort?.signal });
    if (!this.current() || epoch !== this.selection) throw new DOMException('Messaging selection changed.', 'AbortError'); return file;
  }
  markPresented(sequence: number, expectedId = this.state.selectedId): Promise<void> {
    const id = this.state.selectedId; if (!id || id !== expectedId || !this.current() || !this.state.messages.some(row => row.sequence === sequence) || sequence <= (this.readPositions.get(id) ?? 0)) return Promise.resolve();
    if (this.reading) return this.reading;
    const epoch = this.selection, requestId = crypto.randomUUID();
    let work!: Promise<void>; work = (async () => { try {
      const result = await this.source.conversations.markRead(id, sequence, { requestId, signal: this.selectedAbort?.signal });
      if (this.current() && epoch === this.selection) { if (!this.readPositions.has(id) && this.readPositions.size >= 256) this.readPositions.delete(this.readPositions.keys().next().value!);
        this.readPositions.set(id, result.throughSequence); this.set({ readError: null,
        conversations: this.state.conversations.map(row => row.id === id ? { ...row, unreadCount: result.unreadCount } : row),
        conversation: this.state.conversation ? { ...this.state.conversation, unreadCount: result.unreadCount } : null }); }
    } catch { if (this.current() && epoch === this.selection) this.set({ readError: 'Read position was not confirmed. New-message counts have not been cleared locally.' }); }
    finally { if (this.reading === work) this.reading = null; } })(); this.reading = work; return work;
  }
  async retry(): Promise<void> {
    if (!this.current() || this.state.status === 'loading' && this.started) return;
    const id = this.state.selectedId, clearing = this.select(null), epoch = this.selection; await clearing;
    if (this.state.status !== 'ready') { this.started = false; this.set({ status: 'loading', error: null }); await this.start(); }
    if (id && this.current() && epoch === this.selection && this.state.status === 'ready') await this.select(id);
  }
  create(input: { kind?: 'direct' | 'group'; title?: string; userIds: readonly string[] }): Promise<void> {
    const intent = structuredClone(input); return this.conversationCommand('Start conversation', 'conversation.create', options => this.source.conversations.create(intent, options));
  }
  openAssistant(id: string): Promise<void> { return this.conversationCommand('Open assistant', 'assistant.open', options => this.source.assistants.open(id, {}, options)); }
  openSupport(mode?: 'assistant' | 'human'): Promise<void> {
    return this.conversationCommand('Contact support', 'support.open', options => this.source.support.open(mode ? { mode } : {}, options));
  }
  claimSupport(id: string, expectedEpoch: number): Promise<void> {
    return this.conversationCommand('Take support ownership', 'support.claim', options => this.source.support.claim(id, expectedEpoch, options), id);
  }
  requestHuman(): Promise<void> {
    const conversation = this.state.conversation;
    if (!conversation || !this.current() || conversation.kind !== 'support') return Promise.resolve();
    return this.conversationCommand('Request human support', 'support.request-human', options => this.source.support.requestHuman(conversation.id, conversation.ownerEpoch, options), conversation.id);
  }
  manage(action: 'rename' | 'archive' | 'add' | 'remove' | 'transfer' | 'takeover' | 'hand-back', value?: string): Promise<void> {
    const conversation = this.state.conversation; if (!conversation || !this.current()) return Promise.resolve();
    const id = conversation.id, revision = conversation.revision, epoch = conversation.ownerEpoch, selection = this.selection;
    if (action === 'remove') return this.commands.execute('Remove participant', options => this.source.conversations.removeParticipant(id, revision, value!, options),
      async receipt => { if (receipt.operation !== 'remove' || receipt.resourceId !== id) throw new Error(); return { removed: true }; }, () => {
        this.latestConversations(); if (value === this.userId && this.selection === selection) void this.select(null); else void this.refreshSelected(selection);
      });
    const run = (options: MessagingMutationOptions) => action === 'rename' ? this.source.conversations.rename(id, revision, value ?? '', options)
      : action === 'archive' ? this.source.conversations.archive(id, revision, !conversation.archived, options)
      : action === 'add' ? this.source.conversations.addParticipant(id, revision, value!, options)
      : action === 'transfer' ? this.source.conversations.transferOwnership(id, revision, value!, options)
      : action === 'takeover' ? this.source.conversations.takeover(id, epoch, options)
      : this.source.conversations.handBack(id, epoch, value === 'assistant' ? 'assistant' : 'triage', options);
    return this.conversationCommand('Update conversation', action === 'takeover' || action === 'hand-back' ? 'ownership' : action, run, id);
  }
  changeMessage(message: DurableMessage, action: 'edit' | 'remove' | 'reaction', value: string, selected = false): Promise<void> {
    if (!this.current() || this.state.selectedId !== message.conversationId || !this.state.conversation) return Promise.resolve();
    const epoch = this.selection, conversationId = message.conversationId;
    const run = (options: MessagingMutationOptions) => action === 'edit' ? this.source.messages.edit(conversationId, message.id, message.revision, value, options)
      : action === 'remove' ? this.source.messages.remove(conversationId, message.id, message.revision, options) : this.source.messages.react(conversationId, message.id, value, selected, options);
    return this.commands.execute(action === 'reaction' ? 'Update reaction' : action === 'edit' ? 'Edit message' : 'Remove message', run, async receipt => {
      if (receipt.operation !== action || receipt.resourceId !== message.id) throw new Error();
      return this.source.messages.get(conversationId, message.id, { signal: this.abort.signal });
    }, value => { if (epoch === this.selection && value.id === message.id && value.conversationId === conversationId) this.transcript?.accepted(value); });
  }
  requestContact(id: string): Promise<void> { return this.commands.execute('Request contact', options => this.source.contacts.request(id, options),
      async receipt => { if (receipt.operation !== 'contact') throw new Error(); return null; }, () => {}); }
  respondContact(id: string, revision: number, accept: boolean): Promise<void> { return this.commands.execute('Respond to contact request', options => this.source.contacts.respond(id, revision, accept, options),
    async receipt => { if (receipt.operation !== 'contact') throw new Error(); return null; }, () => {}); }
  checkCommand(): Promise<void> { return this.commands.check(); }
  retryCommand(): Promise<void> { return this.commands.retry(); }
  dispose(): void { this.abort.abort(); this.selectedAbort?.abort(); this.stopList?.(); this.stopHead?.(); this.transcript?.close(); this.uploads.clear(); this.sends.clear(); this.commands.clear(); this.listeners.clear(); this.state = initialEmpty; }
  private canEdit(): boolean { return this.current() && !!this.state.conversation && !['sending', 'unknown'].includes(this.state.draft.phase); }
  private draftChanged(): void { const id = this.state.selectedId; if (id) this.set({ draft: this.sends.draft(id, this.state.visibility), uploads: this.uploads.snapshot(id, this.state.visibility) }); }
  private denySelection(): void {
    this.selectedAbort?.abort(); this.stopHead?.(); this.transcript?.close();
    this.set({ conversation: null, people: {}, messages: [], loading: false, live: 'unavailable', error: 'This conversation is unavailable. Recheck your access before retrying.', draft: initialEmpty.draft, uploads: [] });
  }
  private listFailure(error: unknown): void { if (!this.current()) return; if (error instanceof MessagingLiveError && !error.retryable) { this.denySelection(); this.set({ conversations: [], status: 'error' }); } }
  private watchList(page: number): void {
    const epoch = ++this.listEpoch; this.stopList?.(); this.set({ loadingConversations: true, conversationPage: page });
    this.stopList = this.source.watchConversations(value => {
      if (!this.current() || epoch !== this.listEpoch) return;
      this.set({ conversations: value.items, conversationsCursor: value.nextCursor, loadingConversations: false, listError: null });
      const selected = value.items.find(row => row.id === this.state.selectedId); if (selected) {
        const before = this.state.conversation;
        if (before && !this.selectedAbort?.signal.aborted && selected.revision >= before.revision) this.set({ conversation: selected });
        if (before && (before.participants.length !== selected.participants.length || before.participants.some((row, index) => row.id !== selected.participants[index]?.id || row.role !== selected.participants[index]?.role))) void this.refreshSelected(this.selection);
      }
      else if (this.state.conversation) void this.refreshSelected(this.selection);
    }, { signal: this.abort.signal, query: { limit: 25, after: this.cursors[page], archived: this.state.showArchived }, onError: error => {
      if (epoch === this.listEpoch) { this.set({ loadingConversations: false, listError: 'Conversation updates are unavailable. Reconnecting; the retained page is not a fresh empty result.' }); this.listFailure(error); }
    } });
  }
  private refreshSelected(epoch: number): Promise<void> {
    const id = this.state.selectedId; if (!id || !this.current() || epoch !== this.selection) return Promise.resolve();
    if (this.refreshing?.epoch === epoch) { this.refreshing.again = true; return this.refreshing.task; }
    const owner = { epoch, again: false, task: Promise.resolve() };
    owner.task = Promise.resolve().then(async () => {
      try { const [conversation, people] = await Promise.all([this.source.conversations.get(id, { signal: this.selectedAbort?.signal }), this.source.conversations.people(id, { signal: this.selectedAbort?.signal })]);
        if (this.current() && epoch === this.selection && conversation.revision >= (this.state.conversation?.revision ?? 0)) this.set({ conversation, people: Object.fromEntries(people.items.map(row => [row.id, row])) });
      } catch { if (this.current() && epoch === this.selection) this.denySelection(); }
      finally { if (this.refreshing === owner) this.refreshing = null; if (owner.again && this.current() && epoch === this.selection && !this.selectedAbort?.signal.aborted) void this.refreshSelected(epoch); }
    }); this.refreshing = owner; return owner.task;
  }
  private conversationCommand(label: string, operation: string, run: (options: MessagingMutationOptions) => Promise<ConversationRecord>, expectedId?: string): Promise<void> {
    const epoch = this.selection;
    return this.commands.execute(label, run, async (receipt: MessagingReceipt) => {
      if (receipt.operation !== operation || !receipt.resourceId || expectedId && receipt.resourceId !== expectedId) throw new Error();
      return this.source.conversations.get(receipt.resourceId, { signal: this.abort.signal });
    }, (value: ConversationRecord) => {
      if (!value || expectedId && value.id !== expectedId) throw new Error(); this.latestConversations(expectedId ? this.state.showArchived : false);
      if (epoch !== this.selection) return;
      if (this.state.selectedId === value.id) { this.set({ conversation: value }); void this.refreshSelected(epoch); }
      else void this.select(value.id);
    });
  }
  private set(patch: Partial<MessagingWorkspaceState>): void { if (!this.current()) return; this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
}
const initialEmpty = Object.freeze(initialMessagingWorkspaceState());
