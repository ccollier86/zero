'use client';
import { useEffect, useState } from 'react';
import { Plus } from '../animate-ui/icons/plus';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Popover, PopoverContent, PopoverTrigger, PopoverViewport } from '../popover';
import { ScrollArea } from '../ui/scroll-area';
import { MenuActiveHighlight } from '../overlays/menu-active-highlight';
import type { MessagingAssistant, MessagingContact, MessagingDirectoryEntry } from '../../messaging/contracts';
import type { MessagingWorkspaceController } from './messaging-workspace-controller';
import type { MessagingWorkspaceState } from './workspace-state';
import { MessagingAvatar } from './messaging-avatar';
import type { AvatarGroupShape } from '../avatar-group/avatar-group-types';
export function WorkspaceStart({ controller, state, shape }: { controller: MessagingWorkspaceController; state: MessagingWorkspaceState; shape?: AvatarGroupShape }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [title, setTitle] = useState(''), [selected, setSelected] = useState<string[]>([]);
  const [people, setPeople] = useState<readonly MessagingDirectoryEntry[]>([]), [bots, setBots] = useState<readonly MessagingAssistant[]>([]), [contacts, setContacts] = useState<readonly MessagingContact[]>([]);
  const [cursor, setCursor] = useState<string | null>(null), [contactCursor, setContactCursor] = useState<string | null>(null), [after, setAfter] = useState<string | undefined>(), [contactAfter, setContactAfter] = useState<string | undefined>();
  const [contactLoading, setContactLoading] = useState(false), [botError, setBotError] = useState(false);
  const [container, setContainer] = useState<HTMLDivElement | null>(null), [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(false);
  const locked = !!state.command && state.command.phase !== 'rejected';
  useEffect(() => {
    if (!open) return; const abort = new AbortController(); setLoading(true); setError(null);
    const timer = setTimeout(() => { void controller.source.directory({ search: query, after, limit: 50 }, { signal: abort.signal }).then(page => {
      if (abort.signal.aborted || !controller.current()) return; setPeople(page.items); setCursor(page.nextCursor); setLoading(false);
    }).catch(() => { if (!abort.signal.aborted && controller.current()) { setLoading(false); setError('The current directory could not be loaded.'); } }); }, 180);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [controller, open, query, after]);
  useEffect(() => {
    if (!open) return; const abort = new AbortController();
    setBotError(false);
    void controller.source.assistants.list({ signal: abort.signal }).then(page => { if (!abort.signal.aborted && controller.current()) setBots(page.items); }).catch(() => { if (!abort.signal.aborted && controller.current()) { setBots([]); setBotError(true); } });
    return () => abort.abort();
  }, [controller, open]);
  useEffect(() => {
    if (!open) return; const abort = new AbortController(); setContactLoading(true);
    const stop = controller.source.watchContacts(page => { if (!abort.signal.aborted && controller.current()) { setContacts(page.items); setContactCursor(page.nextCursor); } },
      { signal: abort.signal, query: { after: contactAfter, limit: 50 }, onConnection: value => { if (!abort.signal.aborted && controller.current()) setContactLoading(value !== 'connected'); },
        onError: () => { if (!abort.signal.aborted && controller.current()) { setContactLoading(false); setError('Contact updates are unavailable; recheck access before starting a conversation.'); } } });
    return () => { abort.abort(); stop(); };
  }, [controller, open, contactAfter]);
  const start = async () => {
    await controller.create({ kind: selected.length > 1 ? 'group' : 'direct', title, userIds: [...selected] });
    if (controller.current() && controller.getSnapshot().command === null) { setOpen(false); setSelected([]); setTitle(''); }
  };
  const accepted = (id: string) => contacts.some(row => row.userId === id && row.state === 'accepted');
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button size="icon-sm" variant="outline" aria-label="New conversation"><Plus /></Button></PopoverTrigger>
    <PopoverContent align="end" className="zero-messaging-start" aria-label="Start a conversation">
      <h3>New conversation</h3><PopoverViewport className="zero-messaging-start-body" style={{ maxHeight: 'min(36rem, calc(var(--radix-popover-content-available-height, 100dvh) - 4rem))' }}><Input aria-label="Find people" placeholder="Find people…" value={query} disabled={locked} onChange={event => { setQuery(event.target.value); setAfter(undefined); }} />
      <ScrollArea className="zero-messaging-start-scroll" style={{ height: Math.min(240, Math.max(1, people.length) * 44) }}><div ref={setContainer} className="zero-messaging-start-choices">
        <MenuActiveHighlight container={container} activeSelector="[aria-pressed=true]" hoverSelector="[data-start-person]" preserveSelectionFill />
        {people.map(person => <div key={person.id} className="zero-messaging-start-person"><button data-start-person type="button" disabled={locked} aria-pressed={selected.includes(person.id)}
          onClick={() => setSelected(value => value.includes(person.id) ? value.filter(id => id !== person.id) : value.length < (state.capabilities?.maxParticipants ?? 100) - 1 ? [...value, person.id] : value)}>
          <MessagingAvatar participant={{ id: person.id, label: person.name, kind: 'user', avatarShape: shape }} /><span>{person.name}</span></button>
          {state.capabilities?.directory === 'contacts' && !accepted(person.id) && <Button size="xs" variant="ghost" disabled={locked || contacts.some(row => row.userId === person.id && row.state === 'pending')}
            onClick={() => { void controller.requestContact(person.id); }}>{contacts.some(row => row.userId === person.id && row.state === 'pending') ? 'Pending' : 'Request contact'}</Button>}
        </div>)}
        {!loading && !people.length && <p className="zero-messaging-workspace-hint">No matching people.</p>}
      </div></ScrollArea>
      <div className="zero-messaging-workspace-tools"><Button size="xs" variant="ghost" disabled={!after || loading} onClick={() => setAfter(undefined)}>First page</Button>
        <Button size="xs" variant="ghost" disabled={!cursor || loading} onClick={() => setAfter(cursor!)}>More people</Button></div>
      {selected.length > 1 && <Input aria-label="Group name" placeholder="Group name (optional)" value={title} maxLength={200} disabled={locked} onChange={event => setTitle(event.target.value)} />}
      <Button size="sm" disabled={!selected.length || locked} onClick={() => { void start(); }}>
        {selected.length > 1 ? `Start group (${selected.length})` : 'Start conversation'}</Button>
      {state.capabilities?.directory === 'contacts' && <p className="zero-messaging-workspace-hint">Contact requests must be accepted. The server checks current contact and block policy when starting a conversation.</p>}
      {bots.length > 0 && <div className="zero-messaging-start-section"><h4>Assistants</h4>{bots.map(bot => <Button key={bot.id} size="sm" variant="ghost" disabled={locked} onClick={() => {
        void controller.openAssistant(bot.id).then(() => { if (controller.current() && !controller.getSnapshot().command) setOpen(false); });
      }}>{bot.name}</Button>)}</div>}
      {state.capabilities?.support && <div className="zero-messaging-start-section"><h4>Support</h4>
        {state.capabilities.supportAssistant && <Button size="sm" variant="ghost" disabled={locked} onClick={() => { void controller.openSupport('assistant').then(() => { if (controller.current() && !controller.getSnapshot().command) setOpen(false); }); }}>Ask the support assistant</Button>}
        <Button size="sm" variant="outline" disabled={locked} onClick={() => { void controller.openSupport('human').then(() => { if (controller.current() && !controller.getSnapshot().command) setOpen(false); }); }}>Talk to a person</Button>
      </div>}
      {contacts.filter(row => row.state === 'pending' && row.direction === 'incoming').map(row => <div key={row.id} className="zero-messaging-start-section"><span>{row.name ?? 'Contact request'}</span><div>
        <Button size="xs" variant="outline" disabled={locked} onClick={() => { void controller.respondContact(row.userId, row.revision, true); }}>Accept {row.name ?? 'contact'}</Button>
        <Button size="xs" variant="ghost" disabled={locked} onClick={() => { void controller.respondContact(row.userId, row.revision, false); }}>Decline {row.name ?? 'contact'}</Button></div></div>)}
      {(contactAfter || contactCursor) && <div className="zero-messaging-workspace-tools"><Button size="xs" variant="ghost" disabled={!contactAfter || contactLoading} onClick={() => setContactAfter(undefined)}>First contact page</Button>
        <Button size="xs" variant="ghost" disabled={!contactCursor || contactLoading} onClick={() => setContactAfter(contactCursor!)}>More contacts</Button></div>}
      {botError && state.capabilities?.assistant && <p role="status" className="zero-messaging-workspace-hint">Assistants could not be loaded. Close and reopen to retry.</p>}
      {loading && <p role="status" className="zero-messaging-workspace-hint">Loading directory…</p>}
      {(error || state.command?.error) && <p role="alert" className="zero-messaging-workspace-notice">{error ?? state.command?.error}</p>}
      {state.command?.phase === 'unknown' && <div className="zero-messaging-workspace-tools"><Button size="xs" onClick={() => { void controller.checkCommand(); }}>Check change</Button><Button size="xs" variant="outline" onClick={() => { void controller.retryCommand(); }}>Retry same change</Button></div>}</PopoverViewport>
    </PopoverContent></Popover>;
}
