/** Browser-only view state. No token, image bytes or private Storage coordinate is stored here. */
import type { MessagingClient, MessagingConnectionState } from '../../messaging/client-contracts';
import type { ConversationRecord, DurableMessage, MessagingCapabilities, MessagingPerson } from '../../messaging/contracts';
import type { MessagingWorkspaceCommand } from './workspace-command';
export interface MessagingWorkspaceDraft { readonly text: string; readonly phase: 'editing' | 'sending' | 'unknown' | 'rejected'; readonly requestId: string | null; readonly error: string | null }
export interface MessagingWorkspaceState {
  readonly status: 'loading' | 'ready' | 'disabled' | 'error'; readonly capabilities: MessagingCapabilities | null;
  readonly conversations: readonly ConversationRecord[]; readonly conversationsCursor: string | null; readonly loadingConversations: boolean;
  readonly conversationPage: number;
  readonly showArchived: boolean;
  readonly listError: string | null;
  readonly selectedId: string | null; readonly conversation: ConversationRecord | null; readonly people: Readonly<Record<string, MessagingPerson>>;
  readonly messages: readonly DurableMessage[]; readonly loading: boolean; readonly loadingOlder: boolean; readonly hasOlder: boolean;
  readonly hasNewer: boolean; readonly live: MessagingConnectionState; readonly error: string | null; readonly draft: MessagingWorkspaceDraft;
  readonly readError: string | null;
  readonly uploads: readonly MessagingWorkspaceUpload[];
  readonly command: MessagingWorkspaceCommand | null;
  readonly visibility: 'conversation' | 'staff';
}
export interface MessagingWorkspaceUpload { readonly id: string; readonly name: string; readonly state: 'uploading' | 'ready' | 'failed'; readonly attachmentId: string | null }
export const EMPTY_MESSAGING_DRAFT: MessagingWorkspaceDraft = Object.freeze({ text: '', phase: 'editing', requestId: null, error: null });
export function initialMessagingWorkspaceState(): MessagingWorkspaceState {
  return { status: 'loading', capabilities: null, conversations: [], conversationsCursor: null, loadingConversations: false, conversationPage: 0, showArchived: false, listError: null,
    selectedId: null, conversation: null, people: {}, messages: [], loading: false, loadingOlder: false, hasOlder: false,
    hasNewer: false, live: 'connecting', error: null, draft: EMPTY_MESSAGING_DRAFT, readError: null, uploads: [], command: null, visibility: 'conversation' };
}
export interface MessagingWorkspaceControllerOptions {
  readonly isCurrent?: () => boolean;
  /** Bounded retained transcript. Older history remains server-owned; no unseen gap is merged. */
  readonly maxMessages?: number;
}
export function messagingErrorStatus(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : undefined;
}
export function messagingErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return;
  const value = 'body' in error && error.body && typeof error.body === 'object' ? error.body : error;
  return 'code' in value && typeof value.code === 'string' ? value.code : undefined;
}
export function messagingWriteWasRejected(error: unknown): boolean {
  const code = messagingErrorCode(error);
  if (code === 'MESSAGING_OUTCOME_UNKNOWN' || code === 'DATABASE_OUTCOME_UNKNOWN') return false;
  return ['MESSAGING_INPUT_INVALID', 'MESSAGING_FORBIDDEN', 'MESSAGING_NOT_FOUND', 'MESSAGING_INTENT_CONFLICT', 'MESSAGING_ARCHIVED',
    'MESSAGING_OWNER_CONFLICT', 'MESSAGING_REVISION_CONFLICT', 'MESSAGING_CONTACT_REQUIRED', 'MESSAGING_BLOCKED', 'MESSAGING_ATTACHMENT_UNAVAILABLE',
    'MESSAGING_NOT_READY', 'MESSAGING_STAGE_CONFLICT', 'MESSAGING_CAPACITY'].includes(code ?? '')
    || [401, 403, 404, 422].includes(messagingErrorStatus(error) ?? 0);
}
export type WorkspaceSource = MessagingClient;
