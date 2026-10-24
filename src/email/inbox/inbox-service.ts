import { createHash } from 'node:crypto';
import type { ZeroLifecycleContext } from '../../frontend/server/server-extensions';
import { createAuthorityRevalidators } from '../../frontend/server/server-request-services/request-authority';
import type { EmailRuntime } from '../types';
import type { MailMessageRef, MailMessageSummary } from '../mailbox-types';
import { EmailError } from '../email-error';
import { isEmailDeliveryReady } from '../runtime';
import { EMAIL_DRAFT_FOLDER, emailMessageKey, type EmailComposeValue, type EmailInboxAccount, type EmailInboxDraft,
  type EmailInboxFolder, type EmailInboxMessage, type EmailInboxPage, type EmailInboxQuery, type EmailInboxSendResult } from './contracts';
import { validateCompose, validateInboxId } from './compose-validation';
import { EmailInboxStateStore } from './inbox-state-store';
import { EmailInboxLive } from './inbox-live';
import type { EmailInboxConfig, EmailInboxServerAccount } from './server-types';

export class EmailInboxService {
  readonly store: EmailInboxStateStore;
  readonly live = new EmailInboxLive();
  private readonly stop = new AbortController();
  private readonly requests = new Set<Promise<unknown>>();
  private closing: Promise<void> | undefined;
  get signal(): AbortSignal { return this.stop.signal; }
  constructor(readonly config: EmailInboxConfig, private readonly runtime: EmailRuntime) { this.store = new EmailInboxStateStore(config.statePath); }

  /** Managed HTTP admission. Shutdown waits for accepted send receipts before closing SQLite. */
  async perform<T>(run: () => Promise<T>): Promise<T> {
    if (this.signal.aborted) throw new EmailError('Email inbox is stopping.', 'EMAIL_INBOX_UNAVAILABLE', 503);
    const task = run(); this.requests.add(task);
    try { return await task; } finally { this.requests.delete(task); }
  }

  async accounts(context: ZeroLifecycleContext): Promise<EmailInboxAccount[]> {
    const owned = this.authority(context); owned.check();
    const accounts = await this.resolve(context); owned.check();
    return accounts.map(account => this.describe(account));
  }
  authority(context: ZeroLifecycleContext) {
    const auth = context.access.requireUser();
    context.access.authorize(this.config.access ?? 'admin');
    const guards = createAuthorityRevalidators(context.request, context.access, context.zero.unsafe);
    const owner = JSON.stringify([context.access.authorization?.scopeKind ?? 'application', auth.tenantId ?? '', auth.userId]);
    return { owner, check: guards.synchronous };
  }
  async account(context: ZeroLifecycleContext, id: string): Promise<EmailInboxServerAccount> {
    const owned = this.authority(context); owned.check();
    const account = (await this.resolve(context)).find(value => value.id === id); owned.check();
    if (!account) throw new EmailError('Mailbox is unavailable for the current account.', 'EMAIL_INBOX_FORBIDDEN', 403);
    return account;
  }
  async folders(context: ZeroLifecycleContext, id: string): Promise<EmailInboxFolder[]> {
    const owned = this.authority(context), account = await this.account(context, id);
    const folders = await account.mailbox.folders({ counts: true, signal: context.request.signal }); await this.currentAccount(context, id, account); owned.check();
    const count = this.store.count(owned.owner, id);
    return [{ path: EMAIL_DRAFT_FOLDER, name: 'Drafts', specialUse: '\\Drafts', flags: [], total: count },
      ...folders.filter(folder => !folder.flags.includes('\\Noselect')).map(folder => folder.specialUse === '\\Drafts' ? { ...folder, name: `${folder.name} (server)` } : folder)];
  }
  async list(context: ZeroLifecycleContext, id: string, query: EmailInboxQuery): Promise<EmailInboxPage> {
    query = { ...query };
    const owned = this.authority(context), account = await this.account(context, id);
    if (!query || typeof query.folder !== 'string' || (query.filter && !['all', 'unread', 'starred'].includes(query.filter))) throw inputError();
    if (query.folder === EMAIL_DRAFT_FOLDER) {
      if (query.filter && query.filter !== 'all') return { folder: query.folder, uidValidity: 'drafts', total: 0, messages: [] };
      const page = this.store.browse(owned.owner, id, query);
      return { folder: query.folder, uidValidity: 'drafts', total: page.total, cursor: page.cursor, messages: page.drafts.map(draft => ({ id: 'draft:' + draft.id, draftId: draft.id,
        subject: draft.subject, from: [], to: draft.to.map(address => ({ address })), date: draft.updatedAt, flags: ['\\Draft'],
        preview: draft.preview, attachmentCount: draft.attachmentCount, size: 0 })) };
    }
    const beforeUid = query.cursor === undefined ? undefined : Number(query.cursor);
    if (query.cursor !== undefined && (!/^[1-9]\d*$/.test(query.cursor) || !Number.isSafeInteger(beforeUid))) throw inputError();
    const page = await account.mailbox.browse({ folder: query.folder, search: query.search, beforeUid, limit: query.limit,
      ...(query.filter === 'unread' ? { seen: false } : query.filter === 'starred' ? { flagged: true } : {}), signal: context.request.signal });
    await this.currentAccount(context, id, account); owned.check();
    return { folder: page.folder, uidValidity: page.uidValidity, total: page.total,
      messages: page.messages.map(publicRow),
      ...(page.nextBeforeUid ? { cursor: String(page.nextBeforeUid) } : {}) };
  }
  async read(context: ZeroLifecycleContext, id: string, ref: MailMessageRef): Promise<EmailInboxMessage> {
    ref = { ...ref };
    const owned = this.authority(context), account = await this.account(context, id);
    const message = await account.mailbox.read(ref, { signal: context.request.signal }); await this.currentAccount(context, id, account); owned.check();
    return { ...publicRow(message), ref, text: message.text, html: message.html, cc: message.cc, bcc: message.bcc, replyTo: message.replyTo,
      inReplyTo: message.inReplyTo, references: message.references, attachments: message.attachments.map((file, index) => ({ id: String(index), filename: file.filename || 'Attachment',
      contentType: file.contentType, contentId: file.contentId, size: file.content.byteLength })) };
  }
  async attachment(context: ZeroLifecycleContext, id: string, ref: MailMessageRef, attachmentId: string): Promise<Response> {
    ref = { ...ref };
    const owned = this.authority(context), account = await this.account(context, id);
    if (!/^(0|[1-9]\d{0,3})$/.test(attachmentId)) throw inputError();
    const message = await account.mailbox.read(ref, { signal: context.request.signal }); await this.currentAccount(context, id, account); owned.check();
    const file = message.attachments[Number(attachmentId)];
    if (!file) throw new EmailError('Attachment was not found.', 'EMAIL_ATTACHMENT_NOT_FOUND', 404);
    return new Response(new Uint8Array(file.content), { headers: { 'Content-Type': 'application/octet-stream', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent((file.filename || 'attachment').replace(/[\x00-\x1f\x7f]/g, '_'))}`,
      'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } });
  }
  async flags(context: ZeroLifecycleContext, id: string, ref: MailMessageRef, flags: { seen?: boolean; flagged?: boolean }): Promise<void> {
    ref = { ...ref }; flags = { ...flags };
    const owned = this.authority(context), account = await this.account(context, id); this.writable(account); owned.check();
    await account.mailbox.setFlags(ref, flags, { signal: context.request.signal }); await this.currentAccount(context, id, account); owned.check(); this.live.notify(account.mailbox);
  }
  async move(context: ZeroLifecycleContext, id: string, ref: MailMessageRef, destination: string): Promise<MailMessageRef> {
    ref = { ...ref };
    const owned = this.authority(context), account = await this.account(context, id); this.writable(account); owned.check();
    if (destination === EMAIL_DRAFT_FOLDER) throw inputError();
    const moved = await account.mailbox.move(ref, destination, { signal: context.request.signal }); await this.currentAccount(context, id, account); owned.check(); this.live.notify(account.mailbox); return moved;
  }
  async getDraft(context: ZeroLifecycleContext, id: string, draftId: string): Promise<EmailInboxDraft> {
    const owned = this.authority(context); await this.account(context, id); owned.check(); return this.store.get(owned.owner, id, validateInboxId(draftId));
  }
  async saveDraft(context: ZeroLifecycleContext, id: string, input: { id: string; revision: number; value: EmailComposeValue }): Promise<EmailInboxDraft> {
    input = structuredClone(input);
    const owned = this.authority(context), account = await this.account(context, id); this.writable(account);
    const value = validateCompose(input.value); validateInboxId(input.id); validateRevision(input.revision); owned.check();
    const draft = this.store.save(owned.owner, id, { ...input, value }); this.live.notify(account.mailbox); return draft;
  }
  async deleteDraft(context: ZeroLifecycleContext, id: string, input: { id: string; revision: number }): Promise<void> {
    input = { ...input };
    const owned = this.authority(context), account = await this.account(context, id); this.writable(account);
    validateInboxId(input.id); validateRevision(input.revision); owned.check(); this.store.delete(owned.owner, id, input.id, input.revision); this.live.notify(account.mailbox);
  }
  async send(context: ZeroLifecycleContext, id: string, input: { operationId: string; value: EmailComposeValue; draft?: { id: string; revision: number } }): Promise<EmailInboxSendResult> {
    input = structuredClone(input);
    const value = validateCompose(input.value, true), operationId = validateInboxId(input.operationId);
    const owned = this.authority(context), account = await this.account(context, id); this.writable(account);
    const from = account.sendAs?.find(identity => identity.id === value.from);
    if (!account.sender || !from) throw new EmailError('Sending from this identity is not permitted.', 'EMAIL_INBOX_FORBIDDEN', 403);
    const digest = createHash('sha256').update(JSON.stringify({ value, draft: input.draft })).digest('hex'); owned.check();
    if (input.draft) { validateInboxId(input.draft.id); validateRevision(input.draft.revision); }
    const previous = this.store.reserveSend(owned.owner, id, operationId, digest, input.draft, value); if (previous) return previous;
    let result: EmailInboxSendResult;
    try {
      owned.check();
      const sent = await account.sender.send({ from: from.name ? `${from.name.replace(/[<>"\r\n]/g, '')} <${from.address}>` : from.address,
        to: value.to, cc: value.cc, bcc: value.bcc, subject: value.subject, text: value.text, html: value.html,
        inReplyTo: value.inReplyTo, references: value.references?.match(/<[^<>\r\n]+>/g) ?? undefined,
        idempotencyKey: 'zero-inbox-' + createHash('sha256').update(JSON.stringify([owned.owner, id, operationId])).digest('hex'),
        attachments: value.attachments.map(file => ({ filename: file.filename, contentType: file.contentType, contentId: file.contentId, content: new Uint8Array(Buffer.from(file.base64, 'base64')) })), signal: context.request.signal });
      if (!sent.accepted.length) throw new EmailError('No recipients were accepted.', 'EMAIL_PROVIDER_REQUEST_REJECTED', 422);
      result = { operationId, status: sent.rejected?.length ? 'partial' : 'accepted', accepted: sent.accepted,
        rejected: sent.rejected ?? [], sentCopy: sent.sentCopy ?? 'not-requested', messageId: sent.id };
      this.store.finishSend(owned.owner, id, operationId, 'accepted', result);
      if (input.draft) try { this.store.delete(owned.owner, id, input.draft.id, input.draft.revision); } catch { /* Keep a newer revision. SMTP is already accepted. */ }
    } catch (error) {
      const known = error instanceof EmailError && error.code === 'EMAIL_PROVIDER_REQUEST_REJECTED';
      try { this.store.finishSend(owned.owner, id, operationId, known ? 'rejected' : 'unknown'); }
      catch { throw new EmailError('The send result could not be durably recorded. Check Sent before sending another copy.', 'EMAIL_SEND_OUTCOME_UNKNOWN', 409); }
      if (known) throw error;
      throw new EmailError('Send outcome is not confirmed. Check Sent before sending another copy.', 'EMAIL_SEND_OUTCOME_UNKNOWN', 409);
    }
    // An authority change after SMTP acceptance must not erase the durable accepted receipt.
    try { await this.currentAccount(context, id, account); owned.check(); }
    catch { throw new EmailError('Mailbox access changed after sending. Check Sent before creating another send.', 'EMAIL_SEND_OUTCOME_UNKNOWN', 403); }
    this.live.notify(account.mailbox); return result;
  }
  close(): Promise<void> {
    if (!this.closing) {
      this.stop.abort(); this.live.close();
      this.closing = Promise.allSettled([...this.requests]).then(() => { this.store.close(); });
    }
    return this.closing;
  }
  private describe(account: EmailInboxServerAccount): EmailInboxAccount {
    return { id: account.id, label: account.label, address: account.address, sendAs: account.sendAs ?? [], capabilities: {
      send: !!account.sender && !!account.sendAs?.length && !account.readOnly, flags: !account.readOnly, move: !account.readOnly,
      drafts: !account.readOnly, live: account.live !== false } };
  }
  private async resolve(context: ZeroLifecycleContext): Promise<readonly EmailInboxServerAccount[]> {
    if (this.config.accounts) {
      const accounts = await this.config.accounts(context);
      if (!Array.isArray(accounts) || accounts.length > 50 || accounts.some(account => !validAccount(account)) || new Set(accounts.map(value => value.id)).size !== accounts.length) throw new Error('[email.inbox] Account resolver returned an invalid catalog.');
      return accounts;
    }
    if (context.zero.unsafe.auth.authorizationKernel?.tenancy.mode === 'multi') throw new EmailError('Multi-tenant inboxes require a scoped account resolver.', 'EMAIL_INBOX_NOT_CONFIGURED', 503);
    if (!this.runtime.mailbox) throw new EmailError('Receiving is not configured.', 'EMAIL_INBOX_NOT_CONFIGURED', 503);
    const from = this.runtime.config ? this.runtime.config.from ?? '' : '';
    const address = from.match(/<([^<>]+)>\s*$/)?.[1] ?? from;
    return [{ id: 'default', label: this.config.label ?? this.runtime.app.name ?? 'Mailbox', address, mailbox: this.runtime.mailbox,
      sender: isEmailDeliveryReady(this.runtime) ? this.runtime.service : undefined, sendAs: address ? [{ id: 'default', address }] : [] }];
  }
  private async currentAccount(context: ZeroLifecycleContext, id: string, previous: EmailInboxServerAccount): Promise<void> {
    const current = await this.account(context, id);
    if (current.mailbox !== previous.mailbox) throw new EmailError('Mailbox access changed during this operation.', 'EMAIL_INBOX_FORBIDDEN', 403);
  }
  private writable(account: EmailInboxServerAccount): void { if (account.readOnly) throw new EmailError('This mailbox is read-only.', 'EMAIL_INBOX_FORBIDDEN', 403); }
}
function validateRevision(value: number) { if (!Number.isSafeInteger(value) || value < 0) throw inputError(); }
function inputError() { return new EmailError('Mailbox request fields are invalid.', 'EMAIL_INBOX_INPUT_INVALID', 400); }
function publicRow(message: MailMessageSummary) {
  return { id: emailMessageKey(message), ref: { folder: message.folder, uidValidity: message.uidValidity, uid: message.uid },
    messageId: message.messageId, subject: message.subject, from: message.from, to: message.to, date: message.date, flags: message.flags, size: message.size };
}
function validAccount(value: EmailInboxServerAccount): boolean {
  const text = (input: unknown, max: number) => typeof input === 'string' && input.length > 0 && input.length <= max && !/[\x00-\x1f\x7f]/.test(input);
  return !!value && text(value.id, 160) && text(value.label, 160) && text(value.address, 320)
    && !!value.mailbox && ['folders', 'browse', 'read', 'setFlags', 'move', 'watch'].every(key => typeof (value.mailbox as any)[key] === 'function')
    && (value.sendAs === undefined || Array.isArray(value.sendAs) && value.sendAs.length <= 50 && new Set(value.sendAs.map(identity => identity.id)).size === value.sendAs.length
      && value.sendAs.every(identity => !!identity && text(identity.id, 160) && text(identity.address, 320) && /^[^<>\s@,;]+@[^<>\s@,;]+\.[^<>\s@,;]+$/.test(identity.address) && (identity.name === undefined || text(identity.name, 160))))
    && (value.sender === undefined || typeof value.sender.send === 'function');
}
