/** Browser-safe presentation records. These do not grant conversation or file access. */
import type { ReactNode } from 'react';
import type { AvatarPresence } from '../components/avatar-group/avatar-group-types';

export type MessagingActivity = 'typing' | 'recording' | 'uploading';
export type MessageDeliveryState = 'queued' | 'sending' | 'accepted' | 'delivered' | 'read' | 'failed' | 'unknown';
export interface MessagingParticipant {
  id: string;
  label: string;
  kind: 'user' | 'external' | 'assistant';
  avatar?: ReactNode;
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
/** Reference only: bytes and authorization stay in Zero Storage. No public download URL. */
export interface MessagingAttachment {
  id: string;
  name: string;
  sizeBytes: number;
  mimeType: string | null;
  storage: { driveId: string; path: string; checksum: string | null };
}
export interface MessagingMessage {
  id: string;
  author: MessagingParticipant;
  text: string;
  createdAt: number;
  delivery?: MessageDeliveryState;
  edited?: boolean;
  attachments?: readonly MessagingAttachment[];
  reactions?: readonly { emoji: string; count: number; selected?: boolean }[];
}
export interface MessagingAssistantActivity {
  /** A real server run identity, never a timer-created pretend assistant. */
  runId: string;
  label: string;
  state: 'queued' | 'thinking' | 'searching' | 'responding' | 'awaiting-human';
}
