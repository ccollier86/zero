/** Server-only additions preserve streamed download without making server byte streams a browser JSON contract. */
import type { MessagingApi } from './contracts';
import type { ServerMessagingAttachmentsApi } from './attachment-contracts';
export interface MessagingServerApi extends MessagingApi { readonly attachments: ServerMessagingAttachmentsApi }
