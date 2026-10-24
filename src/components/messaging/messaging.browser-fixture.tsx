/** Synthetic presentation/hook lifecycle fixture. No message server, uploads, AI or external channel. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Button } from '../ui/button';
import { ClientProvider } from '../../frontend/client/client-context';
import type { Client } from '../../frontend/client/sdk';
import { SyncContext } from '../../sync/client/hooks';
import type { SyncClient } from '../../sync/client/sync-client';
import { EphemeralClient } from '../../sync/client/ephemeral-client';
import { createEphemeralStore } from '../../sync/client/ephemeral-store';
import type { EphemeralErrorMessage } from '../../sync/ephemeral-policy';
import {
  MessagingLayout, ConversationHeader, ConversationList, ConversationListHeading,
  ConversationSeparator, MessageBubble, ConversationTypingIndicator, MessagingComposer,
  useConversationTyping, type MessagingComposerFile, type MessagingMessage, type MessagingParticipant,
} from './index';

const staff: MessagingParticipant = { id: 'staff', label: 'Morgan Lee', kind: 'user' };
const customer: MessagingParticipant = { id: 'customer', label: 'Alex Rivera', kind: 'external' };
const sent: object[] = [], listeners = new Set<() => void>();
let connected = true, scope = 'fixture-tenant-a';
let authState = { user: { userId: staff.id, username: staff.label }, activeTenant: null, isLoading: false,
  isRestoring: false, error: null, authenticationContinuation: null,
  sessionTransition: { phase: 'idle', revision: 0, operation: null, recoverable: false, error: null } };
const authSnapshot = () => ({ context: authState });
let cachedSnapshot = authSnapshot();
const auth = {
  get user() { return authState.user; }, get activeTenant() { return null; },
  get authorizationScopeKey() { return scope; }, get isLoading() { return false; },
  get isAuthenticated() { return true; }, get isRestoring() { return false; },
  get sessionTransition() { return authState.sessionTransition; },
  authorizationState: { status: 'ready' },
  subscribe(callback: () => void) { listeners.add(callback); return () => { listeners.delete(callback); }; },
  subscribeAuthorization(callback: () => void) { listeners.add(callback); return () => { listeners.delete(callback); }; },
  store: { getSnapshot: () => cachedSnapshot },
};
const store = createEphemeralStore();
const ephemeral = new EphemeralClient(message => sent.push(message), store, message => {
  if (!connected) return false;
  sent.push(message); return true;
});
// This fixture deliberately does not forge a real credential or connect a socket.
const client = { auth, ephemeral } as unknown as Client;
const sync = { syncClient: {} as SyncClient, stateClient: null, ephemeralClient: ephemeral };
type TypingHook = ReturnType<typeof useConversationTyping>;
const hooks = new Map<string, TypingHook>();
let oldMark: (() => void) | undefined;
let setRoom: React.Dispatch<React.SetStateAction<string>>, setPublish: React.Dispatch<React.SetStateAction<boolean>>;
let setFiles: React.Dispatch<React.SetStateAction<MessagingComposerFile[]>>, setSecond: React.Dispatch<React.SetStateAction<boolean>>;
let submissions = 0;

function SecondSession({ room }: { room: string }) {
  const typing = useConversationTyping(room); hooks.set('second', typing);
  React.useEffect(() => () => { hooks.delete('second'); }, []);
  return null;
}
function Fixture() {
  const [room, changeRoom] = React.useState('room-a'), [publish, changePublish] = React.useState(true);
  const [files, changeFiles] = React.useState<MessagingComposerFile[]>([]), [second, changeSecond] = React.useState(true);
  setRoom = changeRoom; setPublish = changePublish; setFiles = changeFiles; setSecond = changeSecond;
  const [query, setQuery] = React.useState(''), [selected, setSelected] = React.useState('c1');
  const [mobileView, setMobileView] = React.useState<'list' | 'conversation'>('list');
  const [value, setValue] = React.useState('');
  const [messages, setMessages] = React.useState<MessagingMessage[]>(Array.from({ length: 18 }, (_, i) => ({
    id: 'm' + i, author: i % 3 ? customer : staff, createdAt: 1792843200000 + i * 60_000,
    text: i === 17 ? 'Thanks, I have everything I need. Could a team member confirm the next steps?' : i % 3 ? 'Here is some context about my request. I would appreciate your help with the next step.' : 'Absolutely. Let me check the details for you.',
    delivery: i % 3 ? undefined : 'read',
  })));
  const typing = useConversationTyping(room, { publish }); hooks.set('main', typing);
  const conversations = Array.from({ length: 32 }, (_, i) => ({ id: 'c' + (i + 1), participant: i === 0 ? customer : { id: 'fixture-' + i, label: ['Taylor Brooks', 'Jordan Chen', 'Casey Patel'][i % 3]!, kind: 'user' as const },
    preview: i === 0 ? 'Could a team member confirm the next steps?' : 'Thanks for the update. I will take a look and get back to you.',
    updatedAtLabel: `${i + 1}m`, unreadCount: i % 4 === 0 ? 2 : 0, channelLabel: i === 0 ? 'Web portal' : 'Team',
    ...(i === 0 ? { presence: { label: 'Online', tone: 'success' as const, variant: 'dot' as const } } : {}) }));
  return <>
    {second && <SecondSession room={room} />}
    <div className="fixture-toolbar"><span>Messaging preview · synthetic data, not connected</span><Button size="xs" variant="ghost" onClick={() => document.documentElement.classList.toggle('dark')}>Toggle theme</Button><output data-testid="typing-state" data-room={room} data-active={typing.isTyping}>{typing.error?.code ?? 'ready'}</output></div>
    <div className="fixture-workspace"><MessagingLayout
      sidebarHeader={<ConversationListHeading count={32} query={query} onQueryChange={setQuery} />}
      sidebar={<ConversationList activeId={selected} conversations={conversations.filter(item => item.participant.label.toLowerCase().includes(query.toLowerCase()))} onSelect={id => { setSelected(id); setMobileView('conversation'); }} />}
      header={<ConversationHeader participant={customer} subtitle="Customer conversation" presence={{ label: 'Online', tone: 'success' }} actions={<Button size="sm" variant="outline">View profile</Button>} />}
      mobileView={mobileView} onBack={() => setMobileView('list')}
      activity={<ConversationTypingIndicator participants={typing.participants} />}
      composer={<MessagingComposer value={value} onChange={setValue} files={files} onTyping={typing.onTextChange}
        onStopTyping={typing.clearTyping} onCompositionStart={typing.onCompositionStart} onCompositionEnd={typing.onCompositionEnd}
        onRemoveFile={id => changeFiles(current => current.filter(file => file.id !== id))}
        onSubmit={() => { submissions++; setMessages(current => [...current, { id: 'local-' + submissions, author: staff, text: value, createdAt: Date.now(), delivery: 'queued' }]); setValue(''); }} />}>
      <ConversationSeparator>Today</ConversationSeparator>{messages.map(message => <MessageBubble key={message.id} message={message} own={message.author.id === staff.id} />)}
    </MessagingLayout></div>
  </>;
}

const root = createRoot(document.getElementById('root')!);
root.render(<React.StrictMode><ClientProvider client={client}><SyncContext.Provider value={sync}><Fixture /></SyncContext.Provider></ClientProvider></React.StrictMode>);
export interface MessagingFixtureApi {
  sent(): object[]; clearSent(): void; mark(name?: string): void; clear(name?: string): void;
  key(name?: string): string; connected(value: boolean): void;
  selectRoom(room: string): void; publish(value: boolean): void; second(value: boolean): void;
  saveMark(): void; invokeOldMark(): void; unmount(): void; scope(): void;
  files(value: MessagingComposerFile[]): void; submissions(): number;
  peer(): void; reject(): void; retry(): void;
}
declare global { interface Window { __messagingFixture: MessagingFixtureApi } }
window.__messagingFixture = {
  sent: () => [...sent], clearSent: () => { sent.length = 0; },
  mark: (name = 'main') => hooks.get(name)!.markTyping(), clear: (name = 'main') => hooks.get(name)!.clearTyping(),
  key: (name = 'main') => hooks.get(name)!.key, connected: value => { connected = value; },
  selectRoom: room => flushSync(() => setRoom(room)), publish: value => flushSync(() => setPublish(value)),
  second: value => flushSync(() => setSecond(value)), saveMark: () => { oldMark = hooks.get('main')!.markTyping; },
  invokeOldMark: () => oldMark?.(), unmount: () => flushSync(() => root.unmount()),
  scope() { scope = scope === 'fixture-tenant-a' ? 'fixture-tenant-b' : 'fixture-tenant-a'; authState = { ...authState }; cachedSnapshot = authSnapshot(); flushSync(() => { for (const listener of listeners) listener(); }); },
  files: value => flushSync(() => setFiles(value)), submissions: () => submissions,
  peer() {
    const now = Date.now(); store.send({ type: 'ephemeral.snapshot', topic: 'typing:room-a', entries: {
      'user:alex:session:fixture-1': { userId: 'alex', value: { label: customer.label, since: now, updatedAt: now } },
      'user:alex:session:fixture-2': { userId: 'alex', value: { label: customer.label, since: now, updatedAt: now } },
    } });
  },
  reject() {
    store.send({ type: 'ephemeral.clear-topic', topic: 'typing:room-a' });
    ephemeral.handleError({ type: 'ephemeral.error', topic: 'typing:room-a', operation: 'subscribe', code: 'EPHEMERAL_FORBIDDEN', message: 'Fixture membership removed', revoked: true } satisfies EphemeralErrorMessage);
  },
  retry: () => hooks.get('main')!.resetError(),
};
