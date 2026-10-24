/** Browser-safe email contracts. No credentials, server providers or attachment bytes in message DTOs. */
import type { MailAddress, MailFolder, MailMessageRef, MailboxChange } from '../mailbox-types';

export const EMAIL_INBOX_API = '/api/_zero/email-inbox';
export const EMAIL_DRAFT_FOLDER = '@drafts';
export interface EmailInboxIdentity { id: string; address: string; name?: string }
export interface EmailInboxAccount {
  id: string; label: string; address: string; sendAs: EmailInboxIdentity[];
  capabilities: { send: boolean; flags: boolean; move: boolean; drafts: boolean; live: boolean };
}
export interface EmailInboxFolder extends MailFolder { total?: number; unread?: number }
export interface EmailInboxRow {
  id: string; ref?: MailMessageRef; draftId?: string;
  subject: string; from: MailAddress[]; to: MailAddress[]; date?: string;
  flags: string[]; preview?: string; attachmentCount?: number; size: number;
}
export interface EmailInboxAttachment { id: string; filename: string; contentType: string; size: number; contentId?: string }
export interface EmailInboxMessage extends EmailInboxRow {
  ref: MailMessageRef; text: string; html?: string; cc: MailAddress[]; bcc: MailAddress[]; replyTo: MailAddress[];
  messageId?: string; inReplyTo?: string; references?: string; attachments: EmailInboxAttachment[];
}
export interface EmailInboxQuery { folder: string; cursor?: string; search?: string; filter?: 'all' | 'unread' | 'starred'; limit?: number }
export interface EmailInboxPage { folder: string; uidValidity: string; messages: EmailInboxRow[]; total: number; cursor?: string }
export interface EmailComposeAttachment { id: string; filename: string; contentType: string; size: number; base64: string; contentId?: string }
export interface EmailComposeValue {
  from: string; to: string[]; cc: string[]; bcc: string[]; subject: string; text: string; html?: string;
  /** Uncommitted recipient input is saved with a draft, never sent as an SMTP header. */
  recipientDrafts?: { to?: string; cc?: string; bcc?: string };
  inReplyTo?: string; references?: string; attachments: EmailComposeAttachment[];
}
export interface EmailInboxDraft {
  id: string; revision: number; updatedAt: string; value: EmailComposeValue;
  /** Persisted recovery fence. Never retry this draft with a fresh operation ID. */
  pendingSend?: { operationId: string; status: 'sending' | 'unknown' };
}
export interface EmailInboxSendResult {
  operationId: string; status: 'accepted' | 'partial'; accepted: string[]; rejected: string[];
  sentCopy?: 'saved' | 'failed' | 'not-requested'; messageId?: string;
}
export type EmailInboxLiveEvent = MailboxChange | { type: 'connected' };
export interface EmailInboxRequestOptions { signal?: AbortSignal }

/** A custom adapter has exactly the same capabilities and lifecycle as the managed Zero adapter. */
export interface EmailInboxSource {
  accounts(options?: EmailInboxRequestOptions): Promise<EmailInboxAccount[]>;
  folders(accountId: string, options?: EmailInboxRequestOptions): Promise<EmailInboxFolder[]>;
  list(accountId: string, query: EmailInboxQuery, options?: EmailInboxRequestOptions): Promise<EmailInboxPage>;
  read(accountId: string, ref: MailMessageRef, options?: EmailInboxRequestOptions): Promise<EmailInboxMessage>;
  attachment(accountId: string, ref: MailMessageRef, id: string, options?: EmailInboxRequestOptions): Promise<Blob>;
  setFlags(accountId: string, ref: MailMessageRef, flags: { seen?: boolean; flagged?: boolean }, options?: EmailInboxRequestOptions): Promise<void>;
  move(accountId: string, ref: MailMessageRef, destination: string, options?: EmailInboxRequestOptions): Promise<MailMessageRef>;
  getDraft(accountId: string, id: string, options?: EmailInboxRequestOptions): Promise<EmailInboxDraft>;
  saveDraft(accountId: string, input: { id: string; revision: number; value: EmailComposeValue }, options?: EmailInboxRequestOptions): Promise<EmailInboxDraft>;
  deleteDraft(accountId: string, input: { id: string; revision: number }, options?: EmailInboxRequestOptions): Promise<void>;
  send(accountId: string, input: { operationId: string; value: EmailComposeValue; draft?: { id: string; revision: number } }, options?: EmailInboxRequestOptions): Promise<EmailInboxSendResult>;
  watch(accountId: string, folder: string, options?: EmailInboxRequestOptions): AsyncIterable<EmailInboxLiveEvent>;
}

export function emailMessageKey(ref: MailMessageRef): string { return JSON.stringify([ref.folder, ref.uidValidity, ref.uid]); }
export function emptyEmailCompose(from = ''): EmailComposeValue { return { from, to: [], cc: [], bcc: [], subject: '', text: '', html: '', attachments: [] }; }
