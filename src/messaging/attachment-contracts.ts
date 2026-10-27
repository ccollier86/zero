/** Browser-safe private attachment contracts. No Storage drive, object path or reusable download capability is exposed. */
import type { MessagingMutationOptions, MessagingReadOptions } from './contracts';
export const MESSAGING_ATTACHMENT_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'text/csv',
  'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm', 'video/mp4', 'video/webm', 'video/quicktime'] as const;
export interface MessagingAttachmentInput {
  readonly fileName: string; readonly mimeType: string; readonly sizeBytes: number; readonly checksum: string;
  readonly visibility?: 'conversation' | 'staff';
}
export interface MessagingAttachment {
  readonly id: string; readonly conversationId: string; readonly fileName: string; readonly mimeType: string;
  readonly sizeBytes: number; readonly checksum: string; readonly visibility: 'conversation' | 'staff';
  readonly state: 'allocated' | 'ready' | 'removing' | 'removed'; readonly createdAt: number; readonly expiresAt: number;
  readonly messageId: string | null;
}
export interface MessagingAttachmentsApi {
  allocate(conversationId: string, input: MessagingAttachmentInput, options: MessagingMutationOptions): Promise<MessagingAttachment>;
  get(conversationId: string, id: string, options?: MessagingReadOptions): Promise<MessagingAttachment>;
  /** First accepted bytes win. Reconcile or retry the same allocation, never silently replace its content. */
  upload(conversationId: string, id: string, body: Blob | Uint8Array | ReadableStream<Uint8Array>, options: MessagingMutationOptions): Promise<MessagingAttachment>;
  /** Only unattached stages can be removed; accepted-message attachments are not mutable staging files. */
  remove(conversationId: string, id: string, options: MessagingMutationOptions): Promise<{ readonly removed: true }>;
}
export interface MessagingAttachmentDownload { readonly attachment: MessagingAttachment; readonly stream: ReadableStream<Uint8Array> }
export interface ServerMessagingAttachmentsApi extends MessagingAttachmentsApi {
  open(conversationId: string, id: string, options?: MessagingReadOptions): Promise<MessagingAttachmentDownload>;
}
export interface BrowserMessagingAttachmentsApi extends MessagingAttachmentsApi {
  download(conversationId: string, id: string, options?: MessagingReadOptions): Promise<Blob>;
}
