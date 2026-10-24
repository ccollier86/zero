'use client';

import * as React from 'react';
import { MessageSquare, Search } from 'lucide-react';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { AvatarPresenceIndicator } from '../avatar-group/avatar-presence-indicator';
import type { AvatarPresence } from '../avatar-group/avatar-group-types';
import { Input } from '../ui/input';
import { MenuActiveHighlight } from '../overlays/menu-active-highlight';
import { cn } from '../../lib/utils';
import type { MessagingConversationSummary, MessagingParticipant } from '../../messaging/presentation';
import './messaging.css';

/** Shared avatar decoration; presence must come from an admitted, current observation. */
function ConversationAvatar({ participant, presence }: { participant: MessagingParticipant; presence?: AvatarPresence }) {
  return <span className="zero-messaging-conversation-avatar" aria-hidden="true">
    {participant.avatar ?? <Avatar><AvatarFallback>{participant.label.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>}
    <AvatarPresenceIndicator enabled={!!presence} presence={presence && { ...presence, variant: 'dot' }} />
  </span>;
}

export interface ConversationListProps {
  conversations: readonly MessagingConversationSummary[];
  activeId?: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
  emptyLabel?: string;
  className?: string;
}

/** Controlled list: keeps existing keyed rows during reactivity and never marks messages read. */
export function ConversationList({ conversations, activeId, onSelect, loading, emptyLabel = 'No conversations yet', className }: ConversationListProps) {
  const [container, setContainer] = React.useState<HTMLUListElement | null>(null);
  return <ul ref={setContainer} data-slot="conversation-list" className={cn('zero-messaging-conversations', className)} aria-label="Conversation list" aria-busy={!!loading}
    onKeyDown={event => {
      if (event.altKey || event.ctrlKey || event.metaKey || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
        || !(event.target instanceof HTMLElement) || !event.target.matches('[data-conversation-open]')) return;
      const choices = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-conversation-open]')];
      const index = choices.indexOf(event.target as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : Math.max(0, Math.min(choices.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
      event.preventDefault(); choices[next]?.focus();
    }}>
    <MenuActiveHighlight container={container} activeSelector="[data-active]" hoverSelector="[data-conversation-open]" preserveSelectionFill={false} />
    {conversations.map(conversation => {
      const unread = Number.isSafeInteger(conversation.unreadCount) && conversation.unreadCount! > 0 ? conversation.unreadCount! : 0;
      return <li key={conversation.id}>
        <button type="button" data-conversation-open="" data-conversation-id={conversation.id} data-active={activeId === conversation.id || undefined}
          aria-pressed={activeId === conversation.id} className="zero-messaging-conversation" onClick={() => onSelect(conversation.id)}>
          <ConversationAvatar participant={conversation.participant} presence={conversation.presence} />
          <span className="zero-messaging-conversation-detail">
            <span className="zero-messaging-conversation-title"><b>{conversation.participant.label}</b><small>{conversation.updatedAtLabel}</small></span>
            <span className={cn('zero-messaging-conversation-preview', conversation.activityLabel && 'is-active')}>{conversation.activityLabel || conversation.preview}</span>
            <span className="zero-messaging-conversation-bottom"><small>{conversation.channelLabel}</small>{unread > 0 && <span className="zero-messaging-unread" aria-label={`${unread} unread messages`}>{unread > 99 ? '99+' : unread}</span>}</span>
          </span>
          {conversation.presence && <span className="sr-only">{conversation.presence.label}</span>}
        </button>
      </li>;
    })}
    {!conversations.length && <li className="zero-messaging-list-empty" role="status"><MessageSquare aria-hidden="true" className="size-5" /><span>{loading ? 'Loading conversations…' : emptyLabel}</span></li>}
  </ul>;
}

export interface ConversationListHeadingProps {
  title?: string;
  count?: number;
  action?: React.ReactNode;
  query?: string;
  onQueryChange?: (query: string) => void;
}
/** Search is controlled: the authorized source, not this heading, determines matching conversations. */
export function ConversationListHeading({ title = 'Messages', count, action, query = '', onQueryChange }: ConversationListHeadingProps) {
  return <div className="zero-messaging-list-heading">
    <div><h2>{title}</h2>{count !== undefined && Number.isSafeInteger(count) && count >= 0 && <span className="zero-messaging-counter">{count}</span>}<span className="zero-messaging-list-action">{action}</span></div>
    {onQueryChange && <label className="zero-messaging-search"><Search aria-hidden="true" className="size-3.5" /><Input aria-label="Search conversations" placeholder="Search conversations…" value={query} onChange={event => onQueryChange(event.target.value)} /></label>}
  </div>;
}

export interface ConversationHeaderProps {
  participant: MessagingParticipant;
  subtitle?: React.ReactNode;
  presence?: AvatarPresence;
  actions?: React.ReactNode;
}
/** Capability-dependent calls, profile, menus and takeover controls are explicit action slots. */
export function ConversationHeader({ participant, subtitle, presence, actions }: ConversationHeaderProps) {
  return <div data-slot="conversation-header" className="zero-messaging-conversation-header">
    <ConversationAvatar participant={participant} presence={presence} />
    <div className="zero-messaging-header-identity"><h2>{participant.label}{participant.kind === 'assistant' && <span className="zero-messaging-assistant-tag">AI</span>}</h2><div>{subtitle}</div></div>
    {presence && <span className="zero-messaging-presence-label">{presence.label}</span>}
    <div className="zero-messaging-header-actions">{actions}</div>
  </div>;
}

export function ConversationSeparator({ children }: { children: string }) {
  return <div className="zero-messaging-separator" role="separator" aria-label={children}><span aria-hidden="true">{children}</span></div>;
}
