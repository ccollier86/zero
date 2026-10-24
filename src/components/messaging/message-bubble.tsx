'use client';

import * as React from 'react';
import { Check, CheckCheck, Clock3, CircleAlert, File, LoaderCircle } from 'lucide-react';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { cn } from '../../lib/utils';
import type { MessageDeliveryState, MessagingAttachment, MessagingMessage } from '../../messaging/presentation';
import './messaging.css';

const DELIVERY_LABELS: Record<MessageDeliveryState, string> = { queued: 'Queued', sending: 'Sending', accepted: 'Saved by server', delivered: 'Delivered', read: 'Read', failed: 'Failed', unknown: 'Delivery not confirmed' };
export function MessageDeliveryIndicator({ state }: { state: MessageDeliveryState }) {
  const Icon = state === 'read' || state === 'delivered' ? CheckCheck : state === 'accepted' ? Check : state === 'sending' ? LoaderCircle : state === 'failed' || state === 'unknown' ? CircleAlert : Clock3;
  return <span data-slot="message-delivery" data-state={state} className="zero-messaging-delivery"><Icon aria-hidden="true" className="size-3" /><span>{DELIVERY_LABELS[state]}</span></span>;
}
export function MessageBubble({ message, own = false, onAttachment, onReaction, formatTime, className }: {
  message: MessagingMessage; own?: boolean; onAttachment?: (attachment: MessagingAttachment) => void;
  onReaction?: (emoji: string) => void;
  /** Defaults to stable UTC HH:mm for identical server/browser hydration. */
  formatTime?: (timestamp: number) => React.ReactNode;
  className?: string;
}) {
  const date = new Date(message.createdAt), validDate = Number.isFinite(date.getTime());
  return <article data-slot="message-bubble" data-message-id={message.id} data-own={own || undefined} className={cn('zero-messaging-message', className)} aria-label={`Message from ${message.author.label}`}>
    {!own && <span className="zero-messaging-message-avatar" aria-hidden="true">{message.author.avatar ?? <Avatar><AvatarFallback>{message.author.label.slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>}</span>}
    <div className="zero-messaging-message-content"><div className="zero-messaging-message-meta"><span>{own ? 'You' : message.author.label}{message.author.kind === 'assistant' && <span className="zero-messaging-assistant-tag">AI</span>}</span>{validDate && <time dateTime={date.toISOString()} title={date.toISOString()}>{formatTime ? formatTime(message.createdAt) : date.toISOString().slice(11, 16) + ' UTC'}</time>}</div>
      {message.text && <div className="zero-messaging-message-text" dir="auto">{message.text}</div>}
      {!!message.attachments?.length && <div className="zero-messaging-message-files">{message.attachments.map(file => <button type="button" key={file.id} className="zero-messaging-message-file" disabled={!onAttachment} onClick={() => onAttachment?.(file)}><File aria-hidden="true" className="size-5" /><span><b>{file.name}</b><small>{file.sizeBytes < 1024 ? `${file.sizeBytes} B` : `${Math.round(file.sizeBytes / 1024)} KB`}</small></span></button>)}</div>}
      {!!message.reactions?.length && <div className="zero-messaging-reactions" aria-label="Reactions">{message.reactions.map(reaction => <button type="button" key={reaction.emoji} disabled={!onReaction} aria-pressed={!!reaction.selected} aria-label={`${reaction.emoji}, ${reaction.count} reaction${reaction.count === 1 ? '' : 's'}`} onClick={() => onReaction?.(reaction.emoji)}>{reaction.emoji} <span>{reaction.count}</span></button>)}</div>}
      <div className="zero-messaging-message-foot">{message.edited && <span>Edited</span>}{own && message.delivery && <MessageDeliveryIndicator state={message.delivery} />}</div>
    </div>
  </article>;
}
