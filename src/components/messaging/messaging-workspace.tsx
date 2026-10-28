'use client';
/** Managed organism over Zero's existing parts and native facade; renders inside, not instead of, AppShell. */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { MessageCircle } from '../animate-ui/icons/message-circle';
import { MessageSquare } from '../animate-ui/icons/message-square';
import { RotateCw } from '../animate-ui/icons/rotate-cw';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { cn } from '../../lib/utils';
import type { MessagingParticipant } from '../../messaging/presentation';
import type { ConversationParticipant } from '../../messaging/contracts';
import type { AvatarGroupShape } from '../avatar-group/avatar-group-types';
import { useMessagingWorkspace, type UseMessagingWorkspaceOptions } from './use-messaging-workspace';
import { useMessagingTranscript } from './use-messaging-transcript';
import { MessagingLayout } from './messaging-layout';
import { ConversationHeader, ConversationList, ConversationListHeading, ConversationSeparator } from './conversation-parts';
import { WorkspaceMessage } from './workspace-message';
import { WorkspaceComposer } from './workspace-composer';
import type { MessagingWorkspaceController } from './messaging-workspace-controller';
import type { MessagingWorkspaceState } from './workspace-state';
import { WorkspaceStart } from './workspace-start';
import { WorkspaceManage } from './workspace-manage';
import { WorkspaceSupportQueue } from './workspace-support-queue';
import { WorkspaceSupportActions } from './workspace-support-actions';
import { WorkspaceReview } from './workspace-review';
import { ConversationAssistantActivity } from './conversation-activity';
import type { MessagingWorkspaceTyping } from './use-support-typing';
import { useNotificationConversation } from '../../frontend/client/notification-feedback-provider';
import { isConversationSurfaceActive } from '../../frontend/client/notification-feedback';

export interface MessagingWorkspaceProps extends UseMessagingWorkspaceOptions {
  className?: string; avatarShape?: AvatarGroupShape;
  conversationId?: string;
  layout?: 'workspace' | 'conversation';
  /** Anonymous support must not publish with a surrounding signed-in user's Sync identity. */
  nativeTyping?: boolean;
  conversationOptions?: boolean;
  externalTyping?: MessagingWorkspaceTyping;
  /** Override admitted identity presentation, never membership or access checks. */
  participantFor?: (id: string) => MessagingParticipant | undefined;
  /** Visible-end acknowledges the displayed latest sequence only after focus/visibility/dwell checks. */
  readPolicy?: 'visible-end' | 'manual';
  publishTyping?: boolean;
  sidebarAction?: ReactNode;
  headerActions?: (conversation: NonNullable<MessagingWorkspaceState['conversation']>, controller: MessagingWorkspaceController) => ReactNode;
}
export function MessagingWorkspace(props: MessagingWorkspaceProps) {
  const { controller, state } = useMessagingWorkspace(props);
  if (!controller || state.status === 'loading') return <div role="status" className="zero-messaging-workspace-empty">Connecting to messages…</div>;
  if (state.status === 'disabled') return <div role="status" className="zero-messaging-workspace-empty">Messaging is not enabled for this application.</div>;
  if (state.status === 'error') return <div role="alert" className="zero-messaging-workspace-empty"><p>{state.error ?? 'Messaging is unavailable.'}</p><Button onClick={() => { void controller.retry(); }}><RotateCw aria-hidden="true" />Retry messaging</Button></div>;
  return <ReadyWorkspace {...props} controller={controller} state={state} />;
}
function ReadyWorkspace({ controller, state, avatarShape, participantFor, readPolicy = 'visible-end', publishTyping = true, sidebarAction, headerActions, className, conversationId, layout = 'workspace', nativeTyping = true, conversationOptions = true, externalTyping, source }: MessagingWorkspaceProps & { controller: MessagingWorkspaceController; state: MessagingWorkspaceState }) {
  const [mobileView, setMobileView] = useState<'list' | 'conversation'>('list'), [query, setQuery] = useState(''), [supportQueue, setSupportQueue] = useState(false);
  useEffect(() => { if (state.selectedId) setMobileView('conversation'); }, [state.selectedId]);
  useEffect(() => { if (conversationId && controller.current()) void controller.select(conversationId); }, [controller, conversationId]);
  const transcript = useMessagingTranscript(controller, state, readPolicy);
  useNotificationConversation(!source && state.conversation && !state.loading ? state.selectedId : null,
    () => controller.current() && isConversationSurfaceActive(transcript.viewport));
  const baseline = useRef({ id: null as string | null, last: 0, ready: false }), previous = baseline.current;
  useLayoutEffect(() => { baseline.current = { id: state.selectedId, last: state.messages.at(-1)?.sequence ?? 0, ready: !!state.conversation && !state.loading }; },
    [state.selectedId, state.messages, state.loading, state.conversation?.id]);
  const person = (id: string, display?: ConversationParticipant): MessagingParticipant => {
    const custom = participantFor?.(id); if (custom) return custom;
    const profile = state.people[id] ?? (display?.name ? { ...display, name: display.name, avatarUrl: display.avatarUrl ?? null } : undefined), kind = profile?.kind ?? (id.startsWith('assistant:') ? 'assistant' : 'user');
    const label = profile?.name ?? (id === controller.userId ? 'You' : kind === 'assistant' ? state.conversation?.assistantName ?? 'Assistant' : 'Member');
    return { id, kind, label, avatarShape, ...(profile?.avatarUrl ? { avatar: <Avatar><AvatarImage src={profile.avatarUrl} alt="" /><AvatarFallback>{label.slice(0, 1)}</AvatarFallback></Avatar> } : {}) };
  };
  const title = (conversation: NonNullable<MessagingWorkspaceState['conversation']>): MessagingParticipant => {
    const peer = conversation.participants.find(row => row.id !== controller.userId);
    return conversation.kind === 'direct' && peer ? person(peer.id, peer) : { id: conversation.id, kind: conversation.kind === 'group' ? 'group' : conversation.kind === 'assistant' ? 'assistant' : 'external',
      label: conversation.title || (conversation.kind === 'group' ? 'Group conversation' : conversation.kind === 'assistant' ? 'Assistant' : 'Support'), avatarShape };
  };
  const ownRole = state.conversation?.participants.find(row => row.id === controller.userId)?.role;
  const staff = ownRole === 'staff', visibility = state.visibility;
  const needsClaim = staff && visibility === 'conversation' && (state.conversation?.owner !== 'human' || state.conversation.ownerId !== controller.userId);
  const busy = state.draft.phase === 'sending' || state.draft.phase === 'unknown';
  const selected = state.conversation;
  const queue = supportQueue && state.capabilities?.canSupport === true;
  return <MessagingLayout className={cn('zero-messaging-workspace', className)} viewportRef={transcript.viewportRef}
    hideSidebar={layout === 'conversation'} mobileView={mobileView} onBack={layout === 'conversation' ? undefined : () => setMobileView('list')}
    sidebarHeader={<ConversationListHeading title={queue ? 'Support queue' : 'Messages'} action={<span className="zero-messaging-workspace-tools">
      {state.capabilities?.canSupport && <Button size="icon-sm" variant={queue ? 'secondary' : 'ghost'} aria-label={queue ? 'Back to messages' : 'Open support queue'} aria-pressed={queue} onClick={() => setSupportQueue(value => !value)}>{queue ? <MessageSquare aria-hidden="true" /> : <MessageCircle aria-hidden="true" />}</Button>}
      {!queue && (sidebarAction ?? <WorkspaceStart controller={controller} state={state} shape={avatarShape} />)}</span>} query={queue ? undefined : query} onQueryChange={queue ? undefined : setQuery} />}
    sidebar={queue ? <WorkspaceSupportQueue controller={controller} state={state} onOpen={() => setMobileView('conversation')} /> : <><ConversationList loading={state.loadingConversations} activeId={state.selectedId} onSelect={id => { setMobileView('conversation'); void controller.select(id); }}
      conversations={state.conversations.map(conversation => ({ id: conversation.id, participant: title(conversation), unreadCount: conversation.unreadCount,
        preview: conversation.lastMessage?.deleted ? 'Message removed' : conversation.lastMessage?.text || 'No messages yet',
        channelLabel: conversation.kind === 'assistant' ? 'AI assistant' : conversation.kind === 'group' ? 'Group' : conversation.kind === 'support' ? 'Support' : undefined,
        updatedAtLabel: new Date(conversation.updatedAt).toISOString().slice(0, 10),
      })).filter(row => !query || `${row.participant.label} ${row.preview}`.toLowerCase().includes(query.toLowerCase()))} />
      {query && <p className="zero-messaging-workspace-hint">Filters the current conversation page.</p>}</>}
    sidebarFooter={queue ? undefined : <>{state.listError && <p role="status" className="zero-messaging-workspace-hint">{state.listError}<Button size="xs" variant="ghost" onClick={() => controller.latestConversations()}>Retry conversation list</Button></p>}<Button size="xs" variant="ghost" onClick={() => controller.latestConversations(!state.showArchived)}>{state.showArchived ? 'Active conversations' : 'Archived conversations'}</Button><div className="zero-messaging-workspace-tools"><Button size="xs" variant="ghost" disabled={!state.conversationPage || state.loadingConversations} onClick={() => controller.previousConversations()}>Previous</Button>
      <span className="zero-messaging-workspace-hint">Page {state.conversationPage + 1}</span><Button size="xs" variant="ghost" disabled={!state.conversationsCursor || state.loadingConversations} onClick={() => { void controller.moreConversations(); }}>Next</Button></div></>}
    header={selected ? <ConversationHeader participant={title(selected)} subtitle={selected.archived ? 'Archived conversation' : state.live === 'connected' ? 'Private conversation' : state.live === 'unavailable' ? 'Live updates unavailable' : 'Connecting live updates…'} actions={<><WorkspaceSupportActions controller={controller} state={state} />{conversationOptions && <><WorkspaceReview key={selected.id} controller={controller} state={state} /><WorkspaceManage controller={controller} state={state} /></>}{headerActions?.(selected, controller)}</>} /> : <span>{state.loading ? 'Loading conversation…' : 'Messages'}</span>}
    composer={selected ? <>{staff && <label className="zero-messaging-workspace-note"><Checkbox checked={visibility === 'staff'} disabled={busy || !!state.uploads.length} onCheckedChange={checked => controller.setVisibility(checked === true ? 'staff' : 'conversation', selected.id)} />Private team note</label>}
      {needsClaim && <p className="zero-messaging-workspace-notice" role="status">Take ownership before sending a public support reply. Private notes remain separate.</p>}
      {visibility === 'conversation' && <ConversationAssistantActivity activity={selected.assistantActivity ? { ...selected.assistantActivity, label: selected.assistantName ?? 'Assistant' } : null} />}
      <WorkspaceComposer key={`${selected.id}:${visibility}`} controller={controller} state={state} visibility={visibility} disabled={selected.archived || needsClaim}
        nativeTyping={nativeTyping} externalTyping={externalTyping} publish={publishTyping && (layout === 'conversation' || mobileView === 'conversation')} participantFor={person} /></> : undefined}>
    {state.error && <div role="alert" className="zero-messaging-workspace-notice">{state.error}<Button size="sm" variant="ghost" onClick={() => { void controller.retry(); }}>Retry conversation</Button></div>}
    {state.command && <div role={state.command.error ? 'alert' : 'status'} className="zero-messaging-workspace-notice">
      {state.command.phase === 'running' ? `${state.command.label}…` : state.command.error}
      {state.command.phase === 'unknown' && <><Button size="xs" variant="ghost" onClick={() => { void controller.checkCommand(); }}>Check pending change</Button><Button size="xs" variant="outline" onClick={() => { void controller.retryCommand(); }}>Retry original change</Button></>}
    </div>}
    {!selected && !state.loading && <div className="zero-messaging-workspace-empty"><MessageSquare aria-hidden="true" /><p>Select a conversation</p></div>}
    {state.loading && <p role="status">Loading messages…</p>}
    {state.hasOlder && <Button size="sm" variant="ghost" disabled={state.loadingOlder} onClick={() => { void controller.older(); }}>{state.loadingOlder ? 'Loading earlier messages…' : 'Load earlier messages'}</Button>}
    {state.messages.map((message, index) => <div key={message.id}>
      {(index === 0 || new Date(state.messages[index - 1]!.createdAt).toISOString().slice(0, 10) !== new Date(message.createdAt).toISOString().slice(0, 10))
        && <ConversationSeparator>{new Date(message.createdAt).toISOString().slice(0, 10)}</ConversationSeparator>}
      <WorkspaceMessage message={message} controller={controller} participant={person(message.authorId)} enter={previous.ready && previous.id === message.conversationId && message.sequence > previous.last} />
    </div>)}
    <div ref={transcript.endRef} className="zero-messaging-workspace-end" />
    {selected && (state.hasNewer || !transcript.following) && <Button size="sm" variant="outline" className="zero-messaging-jump-latest" onClick={transcript.latest}>{state.hasNewer ? 'New messages · Jump to latest' : 'Jump to latest'}</Button>}
    {state.readError && <p role="status" className="zero-messaging-workspace-notice">{state.readError}<Button size="xs" variant="ghost" onClick={transcript.retryRead}>Retry read confirmation</Button></p>}
  </MessagingLayout>;
}
