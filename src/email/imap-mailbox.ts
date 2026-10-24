/** Bounded, app-local IMAP facade. No sockets open until a method or live watch is used. */
import { ImapFlow, type FetchMessageObject } from 'imapflow';
import PostalMime, { type Address } from 'postal-mime';
import MailComposer from 'nodemailer/lib/mail-composer';
import { EmailError } from './email-error';
import { inspectMailConnection } from './mail-connection-config';
import { snapshotEmailMessage } from './email-message';
import type { EmailMessage, ImapMailboxConfig } from './types';
import type { MailAddress, MailFolder, MailListOptions, MailMessage, MailMessagePage, MailMessageRef, MailMessageSummary, MailWatchOptions, MailboxChange } from './mailbox-types';
import { watchImapMailbox } from './imap-mailbox-watch';

export class ImapMailbox {
  private readonly resolved;
  private readonly maxBytes: number;
  private readonly stop = new AbortController();
  private readonly active = new Set<ImapFlow>();
  private readonly pending = new Set<Promise<unknown>>();

  constructor(config: ImapMailboxConfig = {}) {
    const { maxMessageBytes = 25 * 1024 * 1024, sentFolder: _sentFolder, ...connection } = config;
    this.resolved = inspectMailConnection('imap', connection);
    if (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes < 1 || maxMessageBytes > 100 * 1024 * 1024) {
      this.resolved.issues.push({ field: 'maxMessageBytes', message: 'Must be between 1 byte and 100 MiB.' });
    }
    this.maxBytes = maxMessageBytes;
  }
  isConfigured(): boolean { return !this.stop.signal.aborted && this.resolved.issues.length === 0; }

  verify(options: { signal?: AbortSignal } = {}): Promise<void> {
    return this.use(options.signal, async () => {});
  }
  folders(options: { signal?: AbortSignal; counts?: boolean } = {}): Promise<MailFolder[]> {
    return this.use(options.signal, async client => (await client.list(options.counts ? { statusQuery: { messages: true, unseen: true } } : undefined)).map(folder => ({
      path: folder.path, name: folder.name, specialUse: folder.specialUse, flags: [...folder.flags],
      ...(folder.status ? { total: folder.status.messages, unread: folder.status.unseen } : {}),
    })));
  }

  /** User-facing mailbox search/paging, distinct from the original bounded UID-window ingestion API. */
  browse(options: { folder?: string; limit?: number; beforeUid?: number; search?: string; seen?: boolean; flagged?: boolean; signal?: AbortSignal } = {}): Promise<MailMessagePage> {
    options = { ...options };
    const folder = validateFolder(options.folder ?? 'INBOX'), limit = options.limit ?? 40;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw invalid('Message limit must be between 1 and 100');
    if (options.beforeUid !== undefined) validateUid(options.beforeUid);
    if (options.search !== undefined && (typeof options.search !== 'string' || options.search.length > 1000)) throw invalid('Search must contain at most 1000 characters');
    return this.use(options.signal, async client => {
      const lock = await client.getMailboxLock(folder, { readOnly: true });
      try {
        const box = requireMailbox(client);
        const query = { ...(options.search ? { text: options.search } : { all: true }),
          ...(options.seen !== undefined ? { seen: options.seen } : {}), ...(options.flagged !== undefined ? { flagged: options.flagged } : {}) };
        const found = box.exists ? await client.search(query, { uid: true }) : [];
        if (!Array.isArray(found)) throw new EmailError('Mailbox search could not be completed.', 'EMAIL_MAILBOX_FAILED', 502);
        if (found.length > 250_000) throw new EmailError('Narrow this mailbox search to fewer than 250,000 messages.', 'EMAIL_SEARCH_TOO_LARGE', 413);
        const candidates = found.filter(uid => options.beforeUid === undefined || uid < options.beforeUid).sort((a, b) => b - a);
        const selected = candidates.slice(0, limit);
        const records = selected.length ? await client.fetchAll(selected.join(','), { uid: true, envelope: true, flags: true, size: true, internalDate: true }, { uid: true }) : [];
        const messages = records.map(record => summary(folder, box.uidValidity.toString(), record)).sort((a, b) => b.uid - a.uid);
        return { folder, uidValidity: box.uidValidity.toString(), uidNext: box.uidNext, total: found.length, messages,
          hasMore: candidates.length > selected.length,
          ...(candidates.length > selected.length ? { nextBeforeUid: selected.at(-1) } : {}),
        };
      } finally { lock.release(); }
    });
  }

  list(options: MailListOptions = {}): Promise<MailMessagePage> {
    options = { ...options, query: options.query ? { ...options.query } : undefined };
    const folder = validateFolder(options.folder ?? 'INBOX');
    const limit = options.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw invalid('Message limit must be between 1 and 200');
    if (options.beforeUid !== undefined) validateUid(options.beforeUid);
    if (options.afterUid !== undefined && options.afterUid !== 0) validateUid(options.afterUid);
    if (options.beforeUid !== undefined && options.afterUid !== undefined) throw invalid('Choose beforeUid or afterUid, not both');
    const query = options.query ?? {};
    for (const [key, value] of Object.entries(query)) {
      if (['from', 'to', 'subject', 'text'].includes(key)) {
        if (typeof value !== 'string' || value.length > 1000) throw invalid('Search strings must be at most 1000 characters');
      } else if (['seen', 'flagged'].includes(key)) {
        if (typeof value !== 'boolean') throw invalid('Search flags must be boolean');
      } else throw invalid('Unsupported mailbox search field');
    }
    return this.use(options.signal, async client => {
      const lock = await client.getMailboxLock(folder, { readOnly: true });
      try {
        const box = requireMailbox(client, options.uidValidity);
        const last = box.uidNext - 1;
        const incremental = options.afterUid !== undefined;
        const upper = incremental ? Math.min(last, options.afterUid! + limit) : Math.min(last, (options.beforeUid ?? box.uidNext) - 1);
        const lower = incremental ? options.afterUid! + 1 : Math.max(1, upper - limit + 1);
        const messages: MailMessageSummary[] = [];
        if (upper >= lower && box.exists > 0) {
          const range = `${lower}:${upper}`;
          const records = await client.fetchAll(Object.keys(query).length ? { ...query, uid: range } : range,
            { uid: true, envelope: true, flags: true, size: true, internalDate: true }, { uid: true });
          for (const record of records) messages.push(summary(folder, box.uidValidity.toString(), record));
          messages.sort((a, b) => incremental ? a.uid - b.uid : b.uid - a.uid);
        }
        return { folder, uidValidity: box.uidValidity.toString(), uidNext: box.uidNext, total: box.exists,
          messages, hasMore: incremental ? upper < last : lower > 1,
          ...(incremental ? { nextAfterUid: Math.max(options.afterUid!, upper) } : lower > 1 ? { nextBeforeUid: lower } : {}),
        };
      } finally { lock.release(); }
    });
  }

  read(ref: MailMessageRef, options: { signal?: AbortSignal } = {}): Promise<MailMessage> {
    ref = { ...ref };
    validateRef(ref);
    return this.use(options.signal, async client => {
      const lock = await client.getMailboxLock(ref.folder, { readOnly: true });
      try {
        requireMailbox(client, ref.uidValidity);
        const metadata = await client.fetchOne(String(ref.uid), { uid: true, envelope: true, flags: true, size: true, internalDate: true }, { uid: true });
        if (!metadata) throw new EmailError('Message no longer exists', 'EMAIL_MESSAGE_NOT_FOUND', 404);
        if ((metadata.size ?? 0) > this.maxBytes) throw new EmailError('Message exceeds the configured size limit', 'EMAIL_MESSAGE_TOO_LARGE', 413);
        const download = await client.download(String(ref.uid), undefined, { uid: true, maxBytes: this.maxBytes + 1 });
        if (!download.content) throw new EmailError('Message no longer exists', 'EMAIL_MESSAGE_NOT_FOUND', 404);
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of download.content) {
          const bytes = Buffer.from(chunk); size += bytes.length;
          if (size > this.maxBytes) { download.content.destroy(); throw new EmailError('Message exceeds the configured size limit', 'EMAIL_MESSAGE_TOO_LARGE', 413); }
          chunks.push(bytes);
        }
        const parsed = await PostalMime.parse(Buffer.concat(chunks), { maxNestingDepth: 32, maxHeadersSize: 256 * 1024, maxPartCount: 1000, maxRfc822NestingDepth: 4 });
        return { ...summary(ref.folder, ref.uidValidity, metadata),
          subject: parsed.subject ?? '', from: addresses(parsed.from ? [parsed.from] : []), to: addresses(parsed.to),
          cc: addresses(parsed.cc), bcc: addresses(parsed.bcc), replyTo: addresses(parsed.replyTo), text: parsed.text ?? '', html: parsed.html,
          messageId: parsed.messageId, inReplyTo: parsed.inReplyTo, references: parsed.references,
          attachments: parsed.attachments.map(attachment => ({ filename: attachment.filename, contentType: attachment.mimeType,
            contentId: attachment.contentId, content: new Uint8Array(attachment.content as ArrayBuffer) })),
        };
      } finally { lock.release(); }
    });
  }

  setFlags(ref: MailMessageRef, flags: { seen?: boolean; flagged?: boolean; answered?: boolean }, options: { signal?: AbortSignal } = {}): Promise<void> {
    ref = { ...ref };
    validateRef(ref);
    const add: string[] = [], remove: string[] = [];
    for (const [key, value] of Object.entries(flags)) {
      if (!['seen', 'flagged', 'answered'].includes(key)) throw invalid('Unsupported message flag');
      const flag = { seen: '\\Seen', flagged: '\\Flagged', answered: '\\Answered' }[key];
      if (!flag || typeof value !== 'boolean') throw invalid('Only seen, flagged and answered boolean flags are supported');
      (value ? add : remove).push(flag);
    }
    return this.use(options.signal, async client => {
      const lock = await client.getMailboxLock(ref.folder);
      try {
        requireMailbox(client, ref.uidValidity);
        if (!await client.fetchOne(String(ref.uid), { uid: true }, { uid: true })) throw new EmailError('Message no longer exists', 'EMAIL_MESSAGE_NOT_FOUND', 404);
        if (add.length && !await client.messageFlagsAdd(String(ref.uid), add, { uid: true })) throw new EmailError('Mailbox flag update was rejected', 'EMAIL_MAILBOX_FAILED', 502);
        if (remove.length && !await client.messageFlagsRemove(String(ref.uid), remove, { uid: true })) throw new EmailError('Mailbox flag update was rejected', 'EMAIL_MAILBOX_FAILED', 502);
      } finally { lock.release(); }
    });
  }

  move(ref: MailMessageRef, destination: string, options: { signal?: AbortSignal } = {}): Promise<MailMessageRef> {
    ref = { ...ref };
    validateRef(ref); validateFolder(destination);
    return this.use(options.signal, async client => {
      const lock = await client.getMailboxLock(ref.folder);
      try {
        requireMailbox(client, ref.uidValidity);
        // Never invoke the library's COPY/EXPUNGE fallback: it can expunge unrelated deleted mail.
        if (!client.capabilities.has('MOVE')) throw new EmailError('Server does not support safe message moves', 'EMAIL_MAILBOX_UNSUPPORTED', 409);
        const moved = await client.messageMove(String(ref.uid), destination, { uid: true });
        const uid = moved && moved.uidMap?.get(ref.uid);
        if (!moved || !uid || !moved.uidValidity) throw new EmailError('Move could not return a stable destination identifier; resync the folders', 'EMAIL_MAILBOX_RESYNC_REQUIRED', 409);
        return { folder: destination, uid, uidValidity: moved.uidValidity.toString() };
      } finally { lock.release(); }
    });
  }

  /** Save a draft or sent copy without exposing MIME construction to application code. */
  async append(message: EmailMessage, options: { folder: string; draft?: boolean; messageId?: string; signal?: AbortSignal }): Promise<MailMessageRef | null> {
    message = snapshotEmailMessage(message); options = { ...options };
    const folder = validateFolder(options.folder);
    if (options.messageId !== undefined && (typeof options.messageId !== 'string' || /[\x00\r\n]/.test(options.messageId))) throw invalid('A valid Message-ID is required');
    const composed = new MailComposer({ from: message.from, to: message.to, cc: message.cc, bcc: message.bcc,
      subject: message.subject, text: message.text, html: message.html, replyTo: message.replyTo,
      inReplyTo: message.inReplyTo, references: message.references, messageId: options.messageId,
      attachments: message.attachments?.map(value => ({ filename: value.filename, content: Buffer.from(value.content), contentType: value.contentType, cid: value.contentId })),
      disableFileAccess: true, disableUrlAccess: true,
    }).compile();
    // Private drafts/sent copies retain Bcc for their owner; transmitted SMTP MIME never does.
    composed.keepBcc = true;
    const source = await composed.build();
    if (source.length > this.maxBytes) throw new EmailError('Message exceeds the configured size limit', 'EMAIL_MESSAGE_TOO_LARGE', 413);
    return this.use(options.signal, async client => {
      const appended = await client.append(folder, source, options.draft ? ['\\Draft'] : ['\\Seen']);
      if (!appended) throw new EmailError('Mailbox append was rejected', 'EMAIL_MAILBOX_FAILED', 502);
      return appended && appended.uid && appended.uidValidity ? { folder, uid: appended.uid, uidValidity: appended.uidValidity.toString() } : null;
    });
  }

  /** Server push through IMAP IDLE, with bounded queues and reconnect/resync notifications. */
  watch(options: MailWatchOptions = {}): AsyncIterable<MailboxChange> {
    validateFolder(options.folder ?? 'INBOX');
    return watchImapMailbox(() => this.makeClient(), () => this.isConfigured(), this.stop.signal, options, this.resolved.settings.timeoutMs);
  }
  async close(): Promise<void> {
    this.stop.abort();
    for (const client of this.active) client.close();
    this.active.clear();
    await Promise.allSettled([...this.pending]);
  }

  private makeClient(watch = true): { client: ImapFlow; release: () => void } {
    if (!this.isConfigured()) throw new EmailError('IMAP configuration is incomplete, invalid or closed', 'EMAIL_PROVIDER_MISCONFIGURED', 500);
    if (this.active.size >= 8) throw new EmailError('Mailbox connection limit reached', 'EMAIL_MAILBOX_BUSY', 503);
    const c = this.resolved.settings;
    const client = new ImapFlow({ host: c.host, port: c.port, secure: c.secure, auth: c.auth,
      tls: c.tls, doSTARTTLS: c.secure ? undefined : c.requireTLS,
      logger: false, logRaw: false, emitLogs: false, disableCompression: true,
      connectionTimeout: c.timeoutMs, greetingTimeout: c.timeoutMs,
      socketTimeout: watch ? 31 * 60_000 : c.timeoutMs, disableAutoIdle: true,
      qresync: true, maxIdleTime: 25 * 60_000,
    });
    client.on('error', () => {}); // Protocol errors are surfaced by the owned operation/watch, never an unhandled emitter.
    this.active.add(client);
    client.once('close', () => this.active.delete(client));
    return { client, release: () => { client.close(); this.active.delete(client); } };
  }

  private use<T>(signal: AbortSignal | undefined, work: (client: ImapFlow) => Promise<T>): Promise<T> {
    if (signal?.aborted || this.stop.signal.aborted) return Promise.reject(new EmailError('Mailbox operation was aborted', 'EMAIL_DELIVERY_ABORTED', 503));
    const owned = this.makeClient(false);
    const combined = AbortSignal.any([...(signal ? [signal] : []), this.stop.signal]);
    let timedOut = false;
    const promise = new Promise<T>((resolve, reject) => {
      const abort = () => { owned.client.close(); reject(new EmailError('Mailbox operation was aborted', 'EMAIL_DELIVERY_ABORTED', 503)); };
      const timer = setTimeout(() => { timedOut = true; owned.client.close(); reject(new EmailError('Mailbox operation timed out', 'EMAIL_DELIVERY_TIMEOUT', 504)); }, this.resolved.settings.timeoutMs);
      combined.addEventListener('abort', abort, { once: true });
      void (async () => {
        await owned.client.connect();
        if (combined.aborted) throw new EmailError('Mailbox operation was aborted', 'EMAIL_DELIVERY_ABORTED', 503);
        return work(owned.client);
      })().then(resolve, error => reject(timedOut ? new EmailError('Mailbox operation timed out', 'EMAIL_DELIVERY_TIMEOUT', 504) : normalizeImapError(error)))
        .finally(() => { clearTimeout(timer); combined.removeEventListener('abort', abort); owned.release(); });
    });
    this.pending.add(promise);
    void promise.then(() => this.pending.delete(promise), () => this.pending.delete(promise));
    return promise;
  }
}

export function normalizeImapError(error: unknown): EmailError {
  if (error instanceof EmailError) return error;
  const value = error && typeof error === 'object' ? error as { authenticationFailed?: boolean; code?: string } : {};
  return value.authenticationFailed
    ? new EmailError('IMAP authentication was rejected', 'EMAIL_PROVIDER_REQUEST_REJECTED', 422)
    : new EmailError('Mailbox request failed', 'EMAIL_MAILBOX_FAILED', 502);
}
export function requireMailbox(client: ImapFlow, validity?: string) {
  if (!client.mailbox) throw new EmailError('Mailbox is not open', 'EMAIL_MAILBOX_FAILED', 502);
  if (validity !== undefined && client.mailbox.uidValidity.toString() !== validity) throw new EmailError('Mailbox identifiers changed; resync before continuing', 'EMAIL_MAILBOX_RESYNC_REQUIRED', 409);
  return client.mailbox;
}
function summary(folder: string, uidValidity: string, message: FetchMessageObject): MailMessageSummary {
  const date = message.envelope?.date ?? message.internalDate;
  return { folder, uidValidity, uid: message.uid, messageId: message.envelope?.messageId,
    subject: message.envelope?.subject ?? '', from: (message.envelope?.from ?? []).filter(item => item.address).map(item => ({ name: item.name, address: item.address! })),
    to: (message.envelope?.to ?? []).filter(item => item.address).map(item => ({ name: item.name, address: item.address! })),
    date: date instanceof Date ? (Number.isFinite(date.getTime()) ? date.toISOString() : undefined) : date, size: message.size ?? 0, flags: [...(message.flags ?? [])],
  };
}
function addresses(values: Address[] = []): MailAddress[] { return values.flatMap(value => value.group ? addresses(value.group) : value.address ? [{ name: value.name, address: value.address }] : []); }
function invalid(message: string) { return new EmailError(message, 'EMAIL_MAILBOX_INPUT_INVALID', 400); }
export function validateFolder(folder: string): string {
  if (typeof folder !== 'string' || !folder || folder.length > 512 || /[\x00\r\n]/.test(folder)) throw invalid('A valid mailbox folder is required');
  return folder;
}
function validateUid(uid: number): void { if (!Number.isInteger(uid) || uid < 1 || uid > 4_294_967_295) throw invalid('A valid positive IMAP UID is required'); }
function validateRef(ref: MailMessageRef): void { validateFolder(ref.folder); validateUid(ref.uid); if (typeof ref.uidValidity !== 'string' || !/^[1-9]\d*$/.test(ref.uidValidity) || Number(ref.uidValidity) > 4_294_967_295) throw invalid('A mailbox UIDVALIDITY value is required'); }
