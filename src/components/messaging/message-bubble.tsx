'use client';

import * as React from 'react';
// Double-check delivery, indeterminate warning and generic file glyphs are not
// present in Zero's current catalog. Do not add covered icons to this fallback.
import { CheckCheck, CircleAlert, File } from 'lucide-react';
import { Check } from '../animate-ui/icons/check';
import { Clock } from '../animate-ui/icons/clock';
import { Loader } from '../animate-ui/icons/loader';
import { MessagingAvatar } from './messaging-avatar';
import { cn } from '../../lib/utils';
import type { MessageDeliveryState, MessagingAttachment, MessagingAttachmentDisplay, MessagingMessageDisplay, NativeMessagingAttachmentDisplay } from '../../messaging/presentation';
import './messaging.css';

const DELIVERY_LABELS: Record<MessageDeliveryState, string> = { queued: 'Queued', sending: 'Sending', accepted: 'Saved by server', delivered: 'Delivered', read: 'Read', failed: 'Failed', unknown: 'Delivery not confirmed' };
export interface MessageDeliveryIndicatorProps { state: MessageDeliveryState }
export function MessageDeliveryIndicator({ state }: MessageDeliveryIndicatorProps) {
  const Icon = state === 'read' || state === 'delivered' ? CheckCheck : state === 'accepted' ? Check : state === 'sending' ? Loader : state === 'failed' || state === 'unknown' ? CircleAlert : Clock;
  return <span data-slot="message-delivery" data-state={state} className="zero-messaging-delivery"><Icon aria-hidden="true" className="size-3" /><span>{DELIVERY_LABELS[state]}</span></span>;
}
interface MessageBubbleDisplayProps<Attachment extends MessagingAttachmentDisplay> {
  message: MessagingMessageDisplay<Attachment>; own?: boolean; onAttachment?: (attachment: Attachment) => void;
  onReaction?: (emoji: string) => void;
  /** Composable native actions; the controller owns permissions and mutation receipts. */
  actions?: React.ReactNode;
  /** Native visible ordinal, used only for bounded viewport observation. */
  sequence?: number;
  /** Defaults to stable UTC HH:mm for identical server/browser hydration. */
  formatTime?: (timestamp: number) => React.ReactNode;
  className?: string;
}
/** Existing generic-Storage bubble contract remains source/type compatible. */
export interface MessageBubbleProps extends MessageBubbleDisplayProps<MessagingAttachment> {}
/** Native private attachments use the conversation facade, not generic Storage coordinates. */
export interface NativeMessageBubbleProps extends MessageBubbleDisplayProps<NativeMessagingAttachmentDisplay> {}
export function MessageBubble(props: MessageBubbleProps) { return <MessageBubbleDisplay {...props} />; }
export function NativeMessageBubble(props: NativeMessageBubbleProps) { return <MessageBubbleDisplay {...props} />; }
function MessageBubbleDisplay<Attachment extends MessagingAttachmentDisplay>({ message, own = false, onAttachment, onReaction, actions, sequence, formatTime, className }: MessageBubbleDisplayProps<Attachment>) {
  const date = new Date(message.createdAt), validDate = Number.isFinite(date.getTime());
  return <article data-slot="message-bubble" data-message-id={message.id} data-message-sequence={sequence} data-own={own || undefined} className={cn('zero-messaging-message', className)} aria-label={`Message from ${message.author.label}`}>
    {!own && <MessagingAvatar participant={message.author} className="zero-messaging-message-avatar" />}
    <div className="zero-messaging-message-content"><div className="zero-messaging-message-meta"><span>{own ? 'You' : message.author.label}{message.author.kind === 'assistant' && <span className="zero-messaging-assistant-tag">AI</span>}</span>{validDate && <time dateTime={date.toISOString()} title={date.toISOString()}>{formatTime ? formatTime(message.createdAt) : date.toISOString().slice(11, 16) + ' UTC'}</time>}</div>
      {message.text && <div className="zero-messaging-message-text" dir="auto">{message.text}</div>}
      {!!message.attachments?.length && <div className="zero-messaging-message-files">{message.attachments.map(file => <button type="button" key={file.id} className="zero-messaging-message-file" disabled={!onAttachment} onClick={() => onAttachment?.(file)}><File aria-hidden="true" className="size-5" /><span><b>{file.name}</b><small>{file.sizeBytes < 1024 ? `${file.sizeBytes} B` : `${Math.round(file.sizeBytes / 1024)} KB`}</small></span></button>)}</div>}
      {!!message.reactions?.length && <div className="zero-messaging-reactions" aria-label="Reactions">{message.reactions.map(reaction => <button type="button" key={reaction.emoji} disabled={!onReaction} aria-pressed={!!reaction.selected} aria-label={`${reaction.emoji}, ${reaction.count} reaction${reaction.count === 1 ? '' : 's'}`} onClick={() => onReaction?.(reaction.emoji)}>{reaction.emoji} <span>{reaction.count}</span></button>)}</div>}
      <div className="zero-messaging-message-foot">{message.edited && <span>Edited</span>}{own && message.delivery && <MessageDeliveryIndicator state={message.delivery} />}{actions}</div>
    </div>
  </article>;
}
