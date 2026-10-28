'use client';
/** Staff discovery is content-free. Only an explicit native claim admits a transcript. */
import { useEffect, useRef, useState } from 'react';
import { MessageCircle } from '../animate-ui/icons/message-circle';
import { Button } from '../ui/button';
import { MenuActiveHighlight } from '../overlays/menu-active-highlight';
import { modals } from '../../modals';
import { MessagingLiveError } from '../../messaging/live-error';
import type { ConversationOwner, MessagingPage, MessagingSupportQueueItem } from '../../messaging/contracts';
import type { MessagingWorkspaceController } from './messaging-workspace-controller';
import type { MessagingWorkspaceState } from './workspace-state';

type Filter = ConversationOwner | 'all';
interface View { page: MessagingPage<MessagingSupportQueueItem> | null; loading: boolean; error: string | null }
const EMPTY: View = { page: null, loading: true, error: null };
const FILTERS = [['triage', 'Waiting'], ['assistant', 'AI'], ['human', 'Assigned'], ['all', 'All']] as const;
export function WorkspaceSupportQueue({ controller, state, onOpen }: { controller: MessagingWorkspaceController; state: MessagingWorkspaceState; onOpen(): void }) {
  const [filter, setFilter] = useState<Filter>('triage'), [cursors, setCursors] = useState<Array<string | undefined>>([undefined]), [index, setIndex] = useState(0), [retry, setRetry] = useState(0);
  const [owner, setOwner] = useState<{ controller: MessagingWorkspaceController; key: string; view: View } | null>(null);
  const [container, setContainer] = useState<HTMLUListElement | null>(null);
  const key = JSON.stringify([filter, cursors[index] ?? null, retry]), latest = useRef({ controller, key }); latest.current = { controller, key };
  const view = owner?.controller === controller && owner.key === key ? owner.view : EMPTY;
  const locked = !!state.command && state.command.phase !== 'rejected';
  useEffect(() => {
    const abort = new AbortController(); let stop: (() => void) | undefined;
    const current = () => !abort.signal.aborted && controller.current() && latest.current.controller === controller && latest.current.key === key;
    const update = (change: (prior: View) => View) => { if (current()) setOwner(prior => current() ? ({ controller, key, view: change(prior?.controller === controller && prior.key === key ? prior.view : EMPTY) }) : prior); };
    try {
      stop = controller.source.watchSupportQueue(page => update(() => ({ page, loading: false, error: null })), {
        signal: abort.signal, query: { limit: 25, ...(cursors[index] ? { after: cursors[index] } : {}), ...(filter === 'all' ? {} : { owner: filter }) },
        onError(error) { const denied = error instanceof MessagingLiveError && !error.retryable;
          update(prior => ({ page: denied ? null : prior.page, loading: false, error: denied ? 'This support queue is unavailable. Recheck your current access before retrying.' : 'Queue updates are interrupted. Retained requests may be stale; reconnecting.' })); },
      });
    } catch { update(() => ({ page: null, loading: false, error: 'The support queue could not be opened. Retry after checking your access.' })); }
    return () => { abort.abort(); stop?.(); };
  }, [controller, key, filter, cursors, index]);
  const claim = async (item: MessagingSupportQueueItem, trigger: HTMLElement) => {
    if (item.owner === 'human' && !await modals.confirm({ title: 'Take over this support request?', description: 'A person already owns this request. Taking ownership prevents the previous owner from sending another public reply under their old ownership state.', confirmLabel: 'Take ownership', trigger })) return;
    if (!controller.current() || latest.current.controller !== controller) return;
    await controller.claimSupport(item.id, item.ownerEpoch);
    if (controller.current() && !controller.getSnapshot().command && controller.getSnapshot().selectedId === item.id) onOpen();
  };
  return <section aria-label="Support queue" className="zero-messaging-support-queue">
    <div className="zero-messaging-support-filters" role="group" aria-label="Support queue filter">{FILTERS.map(([value, label]) => <Button key={value} size="xs" variant={filter === value ? 'secondary' : 'ghost'} aria-pressed={filter === value}
      onClick={() => { setFilter(value); setCursors([undefined]); setIndex(0); }}>{label}</Button>)}</div>
    <p className="zero-messaging-workspace-hint">Claim a request to join its conversation. Queue entries do not expose message contents.</p>
    {view.error && <div role="alert" className="zero-messaging-workspace-notice">{view.error}<Button size="xs" variant="ghost" onClick={() => setRetry(value => value + 1)}>Retry support queue</Button></div>}
    <ul ref={setContainer} className="zero-messaging-conversations" aria-label="Support requests" aria-busy={view.loading}>
      <MenuActiveHighlight container={container} activeSelector="[aria-pressed=true]" hoverSelector="[data-support-request]" preserveSelectionFill={false} />
      {view.page?.items.map(item => <li key={item.id}><button type="button" data-support-request data-support-id={item.id} className="zero-messaging-conversation" disabled={locked}
        aria-label={`${item.owner === 'human' ? 'Take over' : 'Claim'} support request ${item.id.slice(-8)}`} onClick={event => { void claim(item, event.currentTarget); }}>
        <MessageCircle aria-hidden="true" className="size-5" /><span className="zero-messaging-conversation-detail"><span className="zero-messaging-conversation-title"><b>Request {item.id.slice(-8)}</b><small>{new Date(item.createdAt).toISOString().slice(0, 10)}</small></span>
          <span className="zero-messaging-conversation-preview">{item.owner === 'triage' ? 'Waiting for a person' : item.owner === 'assistant' ? 'With the assistant' : 'Assigned to support'}</span>
          <span className="zero-messaging-conversation-bottom"><small>{item.owner === 'human' ? 'Take ownership' : 'Claim request'}</small></span></span>
      </button></li>)}
      {view.loading && <li role="status" className="zero-messaging-list-empty">Loading support requests…</li>}
      {!view.loading && !view.error && !view.page?.items.length && <li role="status" className="zero-messaging-list-empty">{filter === 'triage' ? 'No requests waiting on this page.' : 'No matching requests on this page.'}</li>}
    </ul>
    <div className="zero-messaging-workspace-tools"><Button size="xs" variant="ghost" disabled={!index || view.loading} onClick={() => setIndex(value => value - 1)}>Previous requests</Button><span className="zero-messaging-workspace-hint">Page {index + 1}</span>
      <Button size="xs" variant="ghost" disabled={!view.page?.nextCursor || view.loading} onClick={() => { const next = view.page?.nextCursor; if (next) { setCursors(value => [...value.slice(0, index + 1), next]); setIndex(value => value + 1); } }}>Next requests</Button>
      <Button size="xs" variant="ghost" onClick={() => { setCursors([undefined]); setIndex(0); setRetry(value => value + 1); }}>First requests</Button></div>
  </section>;
}
