/** Browser-safe presentation records. These do not grant conversation or file access. */
import type { ReactNode } from 'react';
import type { AvatarPresence, AvatarGroupShape } from '../components/avatar-group/avatar-group-types';

export type MessagingActivity = 'typing' | 'recording' | 'uploading';
export type MessageDeliveryState = 'queued' | 'sending' | 'accepted' | 'delivered' | 'read' | 'failed' | 'unknown';
export interface MessagingParticipant {
  id: string;
  label: string;
  kind: 'user' | 'external' | 'assistant' | 'group';
  avatar?: ReactNode;
  /** Shared image/fallback/presence corners. Defaults to the messaging avatar radius token (circle). */
  avatarShape?: AvatarGroupShape;
}
/** Display data supplied by an authorized directory/conversation projection. */
export interface MessagingConversationSummary {
  id: string;
  participant: MessagingParticipant;
  preview: string;
  unreadCount?: number;
  updatedAtLabel?: string;
  channelLabel?: string;
  /** Omit unknown presence; no observation must not mean "offline". */
  presence?: AvatarPresence;
  activityLabel?: string;
}
/** Minimum file presentation. Metadata is not a grant, URL or assertion that bytes exist. */
export interface MessagingAttachmentDisplay {
  id: string;
  name: string;
  sizeBytes: number;
  mimeType: string | null;
}
/** Retained generic Storage presentation; native durable messaging uses its domain facade instead. */
export interface MessagingAttachment extends MessagingAttachmentDisplay {
  storage: { driveId: string; path: string; checksum: string | null };
}
/** A native conversation attachment never fabricates a generic Storage drive/path for presentation. */
export interface NativeMessagingAttachmentDisplay extends MessagingAttachmentDisplay { conversationId: string }
export interface MessagingMessageDisplay<Attachment extends MessagingAttachmentDisplay = MessagingAttachment> {
  id: string;
  author: MessagingParticipant;
  text: string;
  createdAt: number;
  delivery?: MessageDeliveryState;
  edited?: boolean;
  attachments?: readonly Attachment[];
  reactions?: readonly { emoji: string; count: number; selected?: boolean }[];
}
/** Original presentation contract retained for existing callers. */
export interface MessagingMessage extends MessagingMessageDisplay<MessagingAttachment> {}
export interface MessagingAssistantActivity {
  /** A real server run identity, never a timer-created pretend assistant. */
  runId: string;
  label: string;
  state: 'queued' | 'thinking' | 'searching' | 'responding' | 'awaiting-human';
}
