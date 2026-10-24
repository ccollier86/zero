/** One state/lifecycle owner for a mailbox workspace. Presentation parts open no connections. */
import { EMAIL_DRAFT_FOLDER, emptyEmailCompose, type EmailComposeValue, type EmailInboxAccount, type EmailInboxAttachment,
  type EmailInboxDraft, type EmailInboxFolder, type EmailInboxMessage, type EmailInboxPage, type EmailInboxRow,
  type EmailInboxSendResult, type EmailInboxSource } from '../../email/inbox/contracts';

export interface EmailInboxDraftState extends EmailInboxDraft {
  dirty: boolean; status: 'editing' | 'saving' | 'saved' | 'error' | 'conflict' | 'sending' | 'unknown';
  error?: string; operationId?: string;
}
export interface EmailInboxState {
  status: 'loading' | 'ready' | 'disabled' | 'error'; accounts: readonly EmailInboxAccount[];
  account: EmailInboxAccount | null; folders: readonly EmailInboxFolder[]; folder: string;
  rows: readonly EmailInboxRow[]; total: number | null; cursor?: string; page: number; loading: boolean;
  search: string; filter: 'all' | 'unread' | 'starred'; selectedId: string | null; message: EmailInboxMessage | null;
  reading: boolean; draft: EmailInboxDraftState | null; error: string | null; notice: string | null;
  live: 'connecting' | 'connected' | 'reconnecting' | 'off'; checked: readonly string[]; newMail: boolean;
}
export function initialEmailInboxState(): EmailInboxState {
  return { status: 'loading', accounts: [], account: null, folders: [], folder: 'INBOX', rows: [], total: null, page: 0, loading: false,
    search: '', filter: 'all', selectedId: null, message: null, reading: false, draft: null, error: null, notice: null,
    live: 'off', checked: [], newMail: false };
}
export interface EmailInboxControllerOptions { markSeenOnOpen?: boolean }
export class EmailInboxController {
  private state: EmailInboxState = initialEmailInboxState();
  private readonly listeners = new Set<() => void>();
  private stop = new AbortController(); private epoch = 0; private folderEpoch = 0; private readEpoch = 0;
  private pageStop: AbortController | null = null; private detailStop: AbortController | null = null; private liveStop: AbortController | null = null;
  private cursors: (string | undefined)[] = [undefined]; private refreshing: ReturnType<typeof setTimeout> | undefined;
  private folderCounts: Promise<void> | null = null;
  private save: Promise<void> | null = null; private submitting: Promise<void> | null = null; private mounted = false; private nearTop = true; private validity: string | undefined;
  constructor(readonly source: EmailInboxSource, readonly scopeKey: string, private readonly options: EmailInboxControllerOptions = {}) {}
  readonly getSnapshot = (): EmailInboxState => this.state;
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(next: Partial<EmailInboxState>): void { if (this.stop.signal.aborted) return; this.state = { ...this.state, ...next }; for (const listener of this.listeners) listener(); }
  private current(epoch: number): boolean { return this.epoch === epoch && !this.stop.signal.aborted; }
  private signal(extra?: AbortSignal): AbortSignal { return extra ? AbortSignal.any([extra, this.stop.signal]) : this.stop.signal; }

  async start(): Promise<void> {
    if (this.stop.signal.aborted) { this.stop = new AbortController(); this.mounted = false; this.state = initialEmailInboxState(); }
    if (this.mounted) return; this.mounted = true;
    const epoch = this.epoch;
    try { const accounts = await this.source.accounts({ signal: this.stop.signal }); if (!this.current(epoch)) return;
      this.set({ accounts, status: 'ready' });
      if (accounts[0]) await this.selectAccount(accounts[0].id); else this.set({ notice: 'No mailboxes are available for your account.' });
    } catch (error) { if (this.current(epoch)) this.set({ status: 'error', error: message(error) }); }
  }
  clearError(): void { this.set({ error: null }); }
  async retry(): Promise<void> {
    if (this.state.status === 'error' || !this.state.account) { this.mounted = false; this.set({ error: null, status: 'loading' }); await this.start(); }
    else if (!this.state.folders.length) { const id = this.state.account.id; this.set({ account: null }); await this.selectAccount(id); }
    else await this.refresh();
  }
  dispose(): void {
    this.epoch++; this.folderEpoch++; this.readEpoch++; this.stop.abort(); this.pageStop?.abort(); this.detailStop?.abort(); this.liveStop?.abort();
    clearTimeout(this.refreshing); this.listeners.clear(); this.state = initialEmailInboxState();
  }
  async selectAccount(id: string): Promise<void> {
    if (this.state.account?.id === id) return;
    await this.flushDraft();
    const account = this.state.accounts.find(value => value.id === id); if (!account) return;
    const epoch = ++this.epoch;
    this.folderEpoch++; this.readEpoch++; this.pageStop?.abort(); this.detailStop?.abort(); this.liveStop?.abort(); this.cursors = [undefined];
    this.validity = undefined; this.nearTop = true;
    this.set({ ...initialEmailInboxState(), accounts: this.state.accounts, account, status: 'ready', loading: true });
    try { const folders = await this.source.folders(id, { signal: this.stop.signal }); if (!this.current(epoch)) return;
      const folder = folders.find(value => value.path.toUpperCase() === 'INBOX')?.path ?? folders.find(value => value.path !== EMAIL_DRAFT_FOLDER)?.path ?? EMAIL_DRAFT_FOLDER;
      this.set({ folders, folder }); await this.refresh(); this.startLive();
    } catch (error) { if (this.current(epoch)) this.set({ error: message(error), loading: false }); }
  }
  async selectFolder(folder: string): Promise<void> {
    if (this.state.folder === folder) return;
    const epoch = this.epoch; await this.flushDraft(); if (!this.current(epoch)) return;
    this.folderEpoch++; this.readEpoch++; this.detailStop?.abort(); this.cursors = [undefined]; this.nearTop = true;
    this.validity = undefined;
    this.set({ folder, rows: [], message: null, selectedId: null, reading: false, draft: null, search: '', filter: 'all', page: 0, cursor: undefined, total: null, checked: [], newMail: false });
    await this.refresh(); this.startLive();
  }
  setSearch(search: string): void { this.nearTop = true; this.set({ search: search.slice(0, 1000), page: 0, checked: [], newMail: false }); this.cursors = [undefined]; this.scheduleRefresh(); }
  setFilter(filter: EmailInboxState['filter']): void { this.nearTop = true; this.set({ filter, page: 0, checked: [], newMail: false }); this.cursors = [undefined]; void this.refresh(); }
  setNearTop(value: boolean): void { this.nearTop = value; }
  async refresh(): Promise<void> {
    const account = this.state.account; if (!account) return;
    this.pageStop?.abort(); const abort = this.pageStop = new AbortController(), epoch = this.epoch, folderEpoch = this.folderEpoch;
    const query = { folder: this.state.folder, cursor: this.cursors[this.state.page], search: this.state.search, filter: this.state.filter, limit: 40 };
    this.set({ loading: true });
    try { const page = await this.source.list(account.id, query, { signal: this.signal(abort.signal) });
      if (!this.current(epoch) || folderEpoch !== this.folderEpoch || abort.signal.aborted) return;
      if (this.validity && this.validity !== page.uidValidity) {
        this.validity = page.uidValidity; this.readEpoch++; this.detailStop?.abort(); this.cursors = [undefined];
        const reset = this.state.page > 0;
        this.set({ selectedId: null, message: null, reading: false, checked: [], page: 0, cursor: undefined, newMail: false });
        if (reset) { await this.refresh(); return; }
      }
      this.validity = page.uidValidity;
      if (!page.messages.length && this.state.page > 0) { this.set({ page: this.state.page - 1 }); await this.refresh(); return; }
      const newIds = this.state.rows.length > 0 && this.state.page === 0 && page.messages.some(row => !this.state.rows.some(old => old.id === row.id));
      if (newIds && !this.nearTop && !this.state.search && this.state.filter === 'all') this.set({ newMail: true, total: page.total, loading: false });
      else this.acceptPage(page);
    } catch (error) { if (this.current(epoch) && !abort.signal.aborted) this.set({ loading: false, error: message(error) }); }
  }
  private acceptPage(page: EmailInboxPage): void {
    const available = new Set(page.messages.map(row => row.id));
    const selected = page.messages.find(row => row.id === this.state.message?.id);
    this.set({ rows: page.messages, total: page.total, cursor: page.cursor, loading: false, error: null,
      ...(selected && this.state.message ? { message: { ...this.state.message, flags: selected.flags } } : {}),
      checked: this.state.checked.filter(id => available.has(id)) });
  }
  async showLatest(): Promise<void> { this.nearTop = true; this.cursors = [undefined]; this.set({ page: 0, newMail: false }); await this.refresh(); }
  async nextPage(): Promise<void> { if (!this.state.cursor || this.state.loading) return; this.cursors[this.state.page + 1] = this.state.cursor; this.set({ page: this.state.page + 1, checked: [] }); await this.refresh(); }
  async previousPage(): Promise<void> { if (!this.state.page || this.state.loading) return; this.set({ page: this.state.page - 1, checked: [] }); await this.refresh(); }
  async selectRow(row: EmailInboxRow): Promise<void> {
    await this.flushDraft();
    if (row.draftId) { await this.openDraft(row.draftId); return; }
    if (!row.ref || !this.state.account) return;
    const epoch = this.epoch, read = ++this.readEpoch, account = this.state.account.id;
    this.detailStop?.abort(); const abort = this.detailStop = new AbortController();
    this.set({ selectedId: row.id, message: null, reading: true, draft: null, error: null });
    try { const value = await this.source.read(account, row.ref, { signal: this.signal(abort.signal) });
      if (!this.current(epoch) || read !== this.readEpoch || abort.signal.aborted) return;
      this.set({ message: value, reading: false });
      if (this.options.markSeenOnOpen !== false && this.state.account?.capabilities.flags && !value.flags.includes('\\Seen')) await this.setFlags(row, { seen: true });
    } catch (error) { if (this.current(epoch) && read === this.readEpoch && !abort.signal.aborted) this.set({ reading: false, error: message(error) }); }
  }
  clearSelection(): void { this.readEpoch++; this.detailStop?.abort(); this.set({ selectedId: null, message: null, reading: false }); }
  check(id: string, checked: boolean): void { this.set({ checked: checked ? [...new Set([...this.state.checked, id])] : this.state.checked.filter(value => value !== id) }); }
  checkAll(checked: boolean): void { this.set({ checked: checked ? this.state.rows.filter(row => !!row.ref).map(row => row.id) : [] }); }
  async setFlags(row: EmailInboxRow, flags: { seen?: boolean; flagged?: boolean }): Promise<void> {
    if (!row.ref || !this.state.account) return;
    const epoch = this.epoch;
    try { await this.source.setFlags(this.state.account.id, row.ref, flags, { signal: this.stop.signal }); if (!this.current(epoch)) return;
      const apply = (value: EmailInboxRow) => { const next = new Set(value.flags); for (const [key, on] of Object.entries(flags)) { const flag = key === 'seen' ? '\\Seen' : '\\Flagged'; if (on) next.add(flag); else next.delete(flag); } return { ...value, flags: [...next] }; };
      this.set({ rows: this.state.rows.map(value => value.id === row.id ? apply(value) : value),
        ...(this.state.message?.id === row.id ? { message: apply(this.state.message) as EmailInboxMessage } : {}) });
    } catch (error) { if (this.current(epoch)) this.set({ error: message(error) }); throw error; }
  }
  async move(row: EmailInboxRow, destination: string): Promise<void> {
    if (!row.ref || !this.state.account) return;
    const epoch = this.epoch;
    try { await this.source.move(this.state.account.id, row.ref, destination, { signal: this.stop.signal }); if (!this.current(epoch)) return;
      this.set({ rows: this.state.rows.filter(value => value.id !== row.id), checked: this.state.checked.filter(id => id !== row.id) });
      if (this.state.message?.id === row.id) this.clearSelection(); this.scheduleRefresh();
    } catch (error) { if (this.current(epoch)) this.set({ error: message(error) }); throw error; }
  }
  async compose(mode: 'new' | 'reply' | 'reply-all' | 'forward' = 'new'): Promise<void> {
    await this.flushDraft(); if (!this.state.account?.capabilities.send) return;
    const epoch = this.epoch, selected = this.state.selectedId;
    const value = emptyEmailCompose(this.state.account.sendAs[0]?.id), original = this.state.message;
    if (mode !== 'new' && original) {
      const own = new Set(this.state.account.sendAs.map(identity => identity.address.toLowerCase()));
      value.subject = `${mode === 'forward' ? 'Fwd' : 'Re'}: ${original.subject.replace(/^(?:re|fwd?):\s*/i, '')}`;
      if (mode !== 'forward') {
        const authored = original.from.length > 0 && original.from.every(item => own.has(item.address.toLowerCase()));
        value.to = (original.replyTo.length ? original.replyTo : authored ? original.to : original.from).map(item => item.address).filter(address => !own.has(address.toLowerCase()));
        const recipients = new Set([...value.to.map(address => address.toLowerCase()), ...own]);
        if (mode === 'reply-all') value.cc = [...original.to, ...original.cc].map(item => item.address).filter(address => { const key = address.toLowerCase(); if (recipients.has(key)) return false; recipients.add(key); return true; });
        value.inReplyTo = original.messageId; value.references = [original.references, original.messageId].filter(Boolean).join(' ');
      }
      const quote = original.text || (original.html ? (await import('./html/email-quoted-text')).emailQuotedText(original.html) : '');
      if (!this.current(epoch) || selected !== this.state.selectedId) return;
      value.text = `\n\n${mode === 'forward' ? 'Forwarded message' : 'Original message'} — ${original.from.map(item => item.address).join(', ')}\n${quote}`;
      value.html = `<p></p><blockquote><p>${escape(value.text.slice(2)).replace(/\n/g, '<br>')}</p></blockquote>`;
      if (mode === 'forward' && original.attachments.length) {
        if (original.attachments.length > 20 || original.attachments.reduce((total, file) => total + file.size, 0) > 15 * 1024 * 1024 || original.attachments.some(file => file.size > 10 * 1024 * 1024)) throw new Error('This message has more attachments than a new outgoing message can hold. Download the files and choose which to attach.');
        for (const file of original.attachments) {
          const blob = await this.attachment(file, original), bytes = new Uint8Array(await blob.arrayBuffer());
          if (!this.current(epoch) || selected !== this.state.selectedId) return;
          if (bytes.byteLength !== file.size) throw new Error('An attachment changed while preparing the forward. Open the message again before forwarding.');
          let binary = ''; for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
          value.attachments.push({ id: crypto.randomUUID(), filename: file.filename, contentType: file.contentType, size: bytes.length, base64: btoa(binary) });
        }
      }
    }
    this.set({ draft: { id: crypto.randomUUID(), revision: 0, updatedAt: new Date().toISOString(), value, dirty: true, status: 'editing' }, error: null });
  }
  updateDraft(value: EmailComposeValue): void {
    const draft = this.state.draft;
    if (!draft || ['sending', 'unknown', 'conflict'].includes(draft.status)) return;
    this.set({ draft: { ...draft, value, dirty: true, status: draft.status === 'saving' ? 'saving' : 'editing', error: undefined } });
  }
  async openDraft(id: string): Promise<void> {
    if (!this.state.account) return; const epoch = this.epoch, read = ++this.readEpoch;
    this.detailStop?.abort(); const abort = this.detailStop = new AbortController();
    this.set({ reading: true, selectedId: 'draft:' + id, draft: null, message: null });
    try { const draft = await this.source.getDraft(this.state.account.id, id, { signal: this.signal(abort.signal) });
      if (this.current(epoch) && read === this.readEpoch && !abort.signal.aborted) this.set({ draft: { ...draft, dirty: false, status: draft.pendingSend ? 'unknown' : 'saved', operationId: draft.pendingSend?.operationId,
        ...(draft.pendingSend ? { error: 'This message has an unconfirmed send. Check its result or inspect Sent before creating another copy.' } : {}) }, reading: false, error: null });
    } catch (error) { if (this.current(epoch) && read === this.readEpoch && !abort.signal.aborted) { this.set({ reading: false, error: message(error) }); throw error; } }
  }
  saveDraft(): Promise<void> {
    if (this.save) return this.save;
    const draft = this.state.draft, account = this.state.account, epoch = this.epoch;
    if (!draft?.dirty || !account || ['unknown', 'conflict'].includes(draft.status)) return Promise.resolve();
    const snapshot = structuredClone(draft.value); this.set({ draft: { ...draft, status: 'saving', error: undefined } });
    this.save = (async () => {
      try { const saved = await this.source.saveDraft(account.id, { id: draft.id, revision: draft.revision, value: snapshot }, { signal: this.stop.signal });
        if (!this.current(epoch) || this.state.draft?.id !== draft.id) return;
        const current = this.state.draft, dirty = JSON.stringify(current.value) !== JSON.stringify(snapshot);
        this.set({ draft: { ...current, revision: saved.revision, updatedAt: saved.updatedAt, dirty, status: dirty ? 'editing' : 'saved' } }); void this.refreshFolderCounts();
      } catch (error) {
        if (this.current(epoch) && this.state.draft?.id === draft.id) this.set({ draft: { ...this.state.draft, status: code(error) === 'EMAIL_DRAFT_CONFLICT' ? 'conflict' : code(error) === 'EMAIL_SEND_OUTCOME_UNKNOWN' ? 'unknown' : 'error', error: message(error) } });
        throw error;
      } finally { this.save = null; }
    })();
    return this.save;
  }
  private async flushDraft(): Promise<void> {
    if (this.state.draft?.status === 'unknown') return; // Durable server fence preserves recovery while the user inspects Sent.
    if (this.save) await this.save;
    if (this.state.draft?.dirty) await this.saveDraft();
    if (this.state.draft?.dirty) throw new Error('Save or resolve this draft before continuing.');
  }
  async closeDraft(): Promise<void> { await this.flushDraft(); this.set({ draft: null }); }
  copyConflictedDraft(): void {
    if (this.state.draft?.status !== 'conflict') return;
    this.set({ draft: { ...this.state.draft, id: crypto.randomUUID(), revision: 0, dirty: true, status: 'editing', error: undefined } });
  }
  async discardDraft(): Promise<void> {
    const draft = this.state.draft, account = this.state.account; if (!draft || !account) return;
    if (this.save) await this.save;
    const current = this.state.draft; if (!current || current.status === 'unknown') throw new Error('An unconfirmed send cannot be discarded safely.');
    if (current.revision) await this.source.deleteDraft(account.id, { id: current.id, revision: current.revision }, { signal: this.stop.signal });
    if (this.state.account?.id === account.id) { this.set({ draft: null }); this.scheduleRefresh(); }
  }
  sendDraft(): Promise<void> {
    if (this.submitting) return this.submitting;
    const promise = this.submitDraft(); this.submitting = promise;
    void promise.then(() => { if (this.submitting === promise) this.submitting = null; }, () => { if (this.submitting === promise) this.submitting = null; });
    return promise;
  }
  private async submitDraft(): Promise<void> {
    let draft = this.state.draft; if (!draft || !this.state.account) return;
    if (draft.status === 'sending') return;
    const epoch = this.epoch, account = this.state.account.id;
    if (draft.status !== 'unknown') { await this.flushDraft(); draft = this.state.draft; }
    if (!draft || !this.current(epoch)) return;
    const operationId = draft.operationId ?? crypto.randomUUID();
    this.set({ draft: { ...draft, status: 'sending', operationId, error: undefined } });
    try { const result = await this.source.send(account, { operationId, value: draft.value, ...(draft.revision ? { draft: { id: draft.id, revision: draft.revision } } : {}) }, { signal: this.stop.signal });
      if (!this.current(epoch)) return; this.set({ draft: null, notice: sendNotice(result) }); this.scheduleRefresh();
    } catch (error) {
      const uncertain = !['EMAIL_INBOX_INPUT_INVALID', 'EMAIL_INBOX_FORBIDDEN', 'EMAIL_DRAFT_CONFLICT', 'EMAIL_SEND_REJECTED', 'EMAIL_SEND_ID_CONFLICT', 'EMAIL_PROVIDER_REQUEST_REJECTED', 'VALIDATION', 'PARSE'].includes(code(error));
      if (this.current(epoch) && this.state.draft?.id === draft.id) this.set({ draft: { ...this.state.draft,
        status: uncertain ? 'unknown' : code(error) === 'EMAIL_DRAFT_CONFLICT' ? 'conflict' : 'error', error: message(error),
        ...(!uncertain ? { operationId: undefined } : {}) } });
      throw error;
    }
  }
  async attachment(file: EmailInboxAttachment, messageValue = this.state.message, signal?: AbortSignal): Promise<Blob> {
    if (!messageValue || !this.state.account) throw new Error('Select a message first.');
    const epoch = this.epoch, selected = this.state.selectedId;
    const blob = await this.source.attachment(this.state.account.id, messageValue.ref, file.id, { signal: this.signal(signal) });
    if (!this.current(epoch) || selected !== this.state.selectedId) throw new DOMException('Email selection changed.', 'AbortError');
    return blob;
  }
  private scheduleRefresh(): void { clearTimeout(this.refreshing); this.refreshing = setTimeout(() => { void this.refresh(); void this.refreshFolderCounts(); }, 180); }
  private refreshFolderCounts(): Promise<void> {
    if (this.folderCounts) return this.folderCounts;
    const account = this.state.account, epoch = this.epoch; if (!account) return Promise.resolve();
    const work = this.source.folders(account.id, { signal: this.stop.signal }).then(folders => { if (this.current(epoch)) this.set({ folders }); }, () => { /* Keep the last known count hints; message operations report their own errors. */ });
    this.folderCounts = work; void work.finally(() => { if (this.folderCounts === work) this.folderCounts = null; }); return work;
  }
  private startLive(): void {
    this.liveStop?.abort(); const account = this.state.account, folder = this.state.folder, epoch = this.epoch;
    if (!account?.capabilities.live) { this.set({ live: 'off' }); return; }
    const abort = this.liveStop = new AbortController(), signal = this.signal(abort.signal);
    this.set({ live: 'connecting' });
    void (async () => { let retry = 0;
      while (!signal.aborted && this.current(epoch)) {
        try { for await (const event of this.source.watch(account.id, folder, { signal })) {
          if (signal.aborted || !this.current(epoch)) return;
          this.set({ live: 'connected' }); retry = 0;
          if (event.type !== 'connected' || this.state.rows.length) this.scheduleRefresh();
          if (event.type === 'flags') {
            const matches = (row: EmailInboxRow) => row.ref?.uid === event.uid && row.ref.uidValidity === event.uidValidity && row.ref.folder === event.folder;
            this.set({ rows: this.state.rows.map(row => matches(row) ? { ...row, flags: event.flags } : row),
              ...(this.state.message && matches(this.state.message) ? { message: { ...this.state.message, flags: event.flags } } : {}) });
          }
          if (event.type === 'removed' && this.state.message?.ref.uid === event.uid && this.state.message.ref.uidValidity === event.uidValidity) {
            this.clearSelection(); this.set({ notice: 'The selected message was removed from this folder.' });
          }
          if (event.type === 'removed') {
            const removed = this.state.rows.filter(row => row.ref?.uid === event.uid && row.ref.uidValidity === event.uidValidity && row.ref.folder === event.folder).map(row => row.id);
            this.set({ rows: this.state.rows.filter(row => !removed.includes(row.id)), checked: this.state.checked.filter(id => !removed.includes(id)) });
          }
        } } catch { /* Reconnect uses a fresh authenticated stream and preserves current rows. */ }
        if (signal.aborted || !this.current(epoch)) return; this.set({ live: 'reconnecting' });
        await delay(Math.min(15_000, 1000 * 2 ** retry++), signal);
      }
    })();
  }
}
function message(error: unknown): string { return error instanceof Error ? error.message : 'This email operation failed.'; }
function code(error: unknown): string { return error && typeof error === 'object' && 'code' in error ? String(error.code) : ''; }
function escape(value: string) { return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!); }
function sendNotice(result: EmailInboxSendResult): string {
  return result.status === 'partial' ? `Accepted for ${result.accepted.length} recipient(s); rejected: ${result.rejected.join(', ')}. Do not resend the whole message.`
    : result.sentCopy === 'failed' ? 'Accepted for sending. The Sent copy could not be saved; do not send again.' : 'Message accepted for sending.';
}
function delay(ms: number, signal: AbortSignal) { return new Promise<void>(resolve => { if (signal.aborted) return resolve(); const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }; const timer = setTimeout(done, ms); signal.addEventListener('abort', done, { once: true }); }); }
