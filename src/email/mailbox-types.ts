/** Provider-neutral, JSON-safe mailbox identifiers and live change contracts. */
export interface MailMessageRef { folder: string; uidValidity: string; uid: number }
export interface MailAddress { name?: string; address: string }
export interface MailFolder { path: string; name: string; specialUse?: string; flags: string[]; total?: number; unread?: number }
export interface MailMessageSummary extends MailMessageRef {
  messageId?: string; subject: string; from: MailAddress[]; to: MailAddress[];
  date?: string; size: number; flags: string[];
}
export interface MailAttachment { filename: string | null; contentType: string; contentId?: string; content: Uint8Array }
export interface MailMessage extends MailMessageSummary {
  text: string; html?: string; cc: MailAddress[]; bcc: MailAddress[]; replyTo: MailAddress[];
  inReplyTo?: string; references?: string; attachments: MailAttachment[];
}
export interface MailboxSearch { from?: string; to?: string; subject?: string; text?: string; seen?: boolean; flagged?: boolean }
export interface MailListOptions {
  folder?: string; limit?: number; beforeUid?: number; afterUid?: number;
  uidValidity?: string; query?: MailboxSearch; signal?: AbortSignal;
}
export interface MailMessagePage {
  folder: string; uidValidity: string; uidNext: number; total: number;
  messages: MailMessageSummary[]; hasMore: boolean;
  /** Continue older pages without missing sparse UID ranges. */
  nextBeforeUid?: number;
  /** Commit this incremental cursor only after persisting the entire returned page. */
  nextAfterUid?: number;
}
export type MailboxChange = {
  folder: string; uidValidity: string;
} & (
  | { type: 'resync'; reason: 'connected' | 'reconnected' | 'overflow' | 'sequence-expunge' | 'unidentified-flags'; total: number; uidNext: number }
  | { type: 'arrival'; total: number; previousTotal: number }
  | { type: 'flags'; uid: number; flags: string[] }
  | { type: 'removed'; uid: number }
);
export interface MailWatchOptions { folder?: string; signal?: AbortSignal }
