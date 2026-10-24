'use client';

import * as React from 'react';
import { Bot, Mic, Upload } from 'lucide-react';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { cn } from '../../lib/utils';
import { conversationActivityLabel, type ConversationActivityMember } from '../../messaging/activity';
import type { MessagingAssistantActivity, MessagingParticipant } from '../../messaging/presentation';
import './messaging.css';

export interface ConversationTypingIndicatorProps {
  participants: readonly ConversationActivityMember[];
  participantFor?: (id: string) => MessagingParticipant | undefined;
  variant?: 'inline' | 'bubble';
  avatars?: boolean;
  className?: string;
}

/** Does not create activity; renders only the admitted ephemeral participants supplied by the hook. */
export function ConversationTypingIndicator({ participants, participantFor, variant = 'bubble', avatars = true, className }: ConversationTypingIndicatorProps) {
  if (!participants.length) return null;
  const label = conversationActivityLabel(participants, id => participantFor?.(id)?.label);
  const kind = participants.every(member => member.activity === participants[0]!.activity) ? participants[0]!.activity : 'mixed';
  return <div data-slot="conversation-typing" data-variant={variant} data-activity={kind} className={cn('zero-messaging-typing', className)} role="status" aria-live="polite" aria-atomic="true">
    {avatars && <span className="zero-messaging-typing-avatars" aria-hidden="true">{participants.slice(0, 3).map(member => {
      const participant = participantFor?.(member.userId), name = participant?.label || member.label;
      return participant?.avatar ? <span key={member.userId}>{participant.avatar}</span> : <Avatar key={member.userId}><AvatarFallback>{name.slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>;
    })}</span>}
    <span className="zero-messaging-typing-body">
      <span aria-hidden="true" className="zero-messaging-typing-visual">{kind === 'recording' ? <Mic className="size-3.5" /> : kind === 'uploading' ? <Upload className="size-3.5" /> : <span className="zero-messaging-typing-dots"><i /><i /><i /></span>}</span>
      <span>{label}</span>
    </span>
  </div>;
}

/** Assistant work is not misrepresented as a human typing or as a delivered message. */
export function ConversationAssistantActivity({ activity, className }: { activity: MessagingAssistantActivity | null; className?: string }) {
  if (!activity) return null;
  const label = { queued: 'is queued', thinking: 'is thinking', searching: 'is searching', responding: 'is responding', 'awaiting-human': 'is waiting for a team member' }[activity.state];
  return <div data-slot="conversation-assistant-activity" data-run-id={activity.runId} className={cn('zero-messaging-assistant-activity', className)} role="status" aria-live="polite"><Bot aria-hidden="true" className="size-3.5" /><span>{activity.label} {label}…</span></div>;
}
