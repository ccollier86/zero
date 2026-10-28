'use client';
/** Native retained-work review. Unknown commands retain their request identity in the workspace controller. */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Eye } from '../animate-ui/icons/eye';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger, PopoverViewport } from '../popover';
import { modals } from '../../modals';
import { MessagingLiveError } from '../../messaging/live-error';
import type { MessagingPage } from '../../messaging/contracts';
import type { MessagingReviewDetail, MessagingReviewItem } from '../../messaging/review-contracts';
import type { MessagingWorkspaceController } from './messaging-workspace-controller';
import type { MessagingWorkspaceState } from './workspace-state';
import { useClientMaybe } from '../../frontend/client/client-context';
import { useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';

export function WorkspaceReview({ controller, state }: { controller: MessagingWorkspaceController; state: MessagingWorkspaceState }) {
  const id = state.conversation!.id, count = state.conversation!.reviewCount;
  const [open, setOpen] = useState(false), [cursor, setCursor] = useState<string | undefined>(), [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; page: MessagingPage<MessagingReviewItem> | null; error: string | null } | null>(null);
  const key = JSON.stringify([id, cursor, retry]), latest = useRef(key); latest.current = key;
  const value = result?.key === key ? result : null;
  useEffect(() => {
    if (!open || count === undefined) return;
    const abort = new AbortController();
    const current = () => !abort.signal.aborted && controller.current() && latest.current === key;
    const stop = controller.source.watchReview(id, page => { if (current()) setResult({ key, page, error: null }); }, {
      signal: abort.signal, query: { limit: 25, ...(cursor ? { after: cursor } : {}) },
      onError(error) { if (current()) setResult(prior => ({ key, page: error instanceof MessagingLiveError && !error.retryable ? null : prior?.key === key ? prior.page : null,
        error: 'Review updates are unavailable. Retained entries may be stale; recheck access before acting.' })); },
    });
    return () => { abort.abort(); stop(); };
  }, [controller, id, key, open, count === undefined]);
  if (count === undefined) return null;
  const inspect = (job: MessagingReviewItem, trigger: HTMLElement) => modals.show({ title: 'Review messaging work', description: 'Retained attempts are preserved. A later retry never rewrites an earlier failure.', size: 'lg', trigger,
    body: <ReviewDetail controller={controller} conversationId={id} jobId={job.id} /> });
  return <Popover open={open} onOpenChange={value => { setOpen(value); if (!value) setCursor(undefined); }}><PopoverTrigger asChild><Button size="sm" variant="ghost" aria-label={`Review messaging work (${count})`}><Eye aria-hidden="true" />Review{count ? ` (${count})` : ''}</Button></PopoverTrigger>
    <PopoverContent align="end" className="zero-messaging-start" aria-label="Messaging work requiring review"><h3>Work requiring review</h3><PopoverViewport className="zero-messaging-start-body">
      <p className="zero-messaging-workspace-hint">Uncertain provider outcomes are not automatically resent. Only the current owner can resolve them.</p>
      {value?.error && <p role="alert">{value.error}<Button size="xs" variant="ghost" onClick={() => setRetry(n => n + 1)}>Retry review updates</Button></p>}
      {!value && <p role="status">Loading retained work…</p>}
      {value?.page?.items.map(job => <div key={job.id} className="zero-messaging-member-row"><span>{job.kind === 'assistant' ? 'Assistant response' : job.kind === 'notification' ? 'Notification' : 'Delivery'}<small>{job.reason?.replaceAll('_', ' ').toLowerCase() ?? 'Manual review required'} · {job.attempts} attempt{job.attempts === 1 ? '' : 's'}</small></span><Button size="xs" variant="outline" onClick={event => inspect(job, event.currentTarget)}>Inspect</Button></div>)}
      {value?.page && !value.page.items.length && !value.error && <p role="status">No unresolved work on this page.</p>}
      <div className="zero-messaging-workspace-tools"><Button size="xs" variant="ghost" disabled={!cursor} onClick={() => setCursor(undefined)}>First work</Button><Button size="xs" variant="ghost" disabled={!value?.page?.nextCursor} onClick={() => setCursor(value?.page?.nextCursor ?? undefined)}>Next work</Button></div>
    </PopoverViewport></PopoverContent></Popover>;
}
function ReviewDetail({ controller, conversationId, jobId }: { controller: MessagingWorkspaceController; conversationId: string; jobId: string }) {
  const boundary = useAuthorizationScopeBoundary(useClientMaybe());
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [detail, setDetail] = useState<MessagingReviewDetail | null>(null), [error, setError] = useState<string | null>(null), [revision, setRevision] = useState(0), [busy, setBusy] = useState(false);
  const active = () => boundary.ready && controller.current() && controller.getSnapshot().selectedId === conversationId && controller.getSnapshot().conversation?.reviewCount !== undefined;
  useEffect(() => {
    const abort = new AbortController();
    void controller.source.review.get(conversationId, jobId, { signal: abort.signal }).then(value => { if (!abort.signal.aborted && active()) { setDetail(value); setError(null); } }, () => { if (!abort.signal.aborted) { setDetail(null); setError('This review is unavailable. Recheck your conversation access.'); } });
    const stop = controller.subscribe(() => { if (!active()) { setDetail(null); setError('The conversation changed. Close this review and open it from the current conversation.'); } });
    return () => { abort.abort(); stop(); };
  }, [controller, conversationId, jobId, revision]);
  const resolve = async (action: 'retry' | 'dismiss', trigger: HTMLElement) => {
    if (busy || !active()) return;
    const confirmed = await modals.confirm({ title: action === 'retry' ? 'Retry this work?' : 'Dismiss this work?', confirmLabel: action === 'retry' ? 'Acknowledge risk and retry' : 'Dismiss work', trigger,
      description: action === 'retry' ? 'The prior provider outcome may be unknown. Retrying can incur another charge or produce a duplicate effect. A new fenced job is created; the old attempt remains unchanged.' : 'This records an explicit dismissal without resending or pretending the old attempt succeeded.' });
    if (!confirmed || !active()) return; setBusy(true);
    try { await controller.resolveReview(jobId, action); if (active()) setRevision(n => n + 1); } finally { setBusy(false); }
  };
  const conversation = state.conversation, owner = conversation?.kind === 'assistant' || conversation?.owner === 'human' && conversation.ownerId === controller.userId;
  if (!active()) return <p role="alert">This review is no longer admitted. Close it and recheck the current conversation.</p>;
  return <div className="zero-messaging-start-body">{error && <p role="alert">{error}<Button size="sm" variant="ghost" onClick={() => setRevision(n => n + 1)}>Recheck review</Button></p>}
    {!detail && !error && <p role="status">Loading review evidence…</p>}
    {detail && <><p>{detail.reason?.replaceAll('_', ' ').toLowerCase() ?? 'Manual review required'}</p>
      <p className="zero-messaging-workspace-hint">{detail.attempts} retained attempt{detail.attempts === 1 ? '' : 's'}. No attempt means no claim that a provider was contacted.</p>
      <ScrollArea style={{ height: Math.min(320, (detail.draftText ? 180 : 0) + detail.history.length * 36 + 32), maxHeight: '40dvh' }}><div className="space-y-3">{detail.draftText && <section><h4>Saved provider draft · not a sent reply</h4><p className="whitespace-pre-wrap break-words">{detail.draftText}</p></section>}
        <ol>{detail.history.map((attempt, index) => <li key={`${attempt.startedAt}:${index}`}>{new Date(attempt.startedAt).toISOString()} · {attempt.outcome}{attempt.code ? ` · ${attempt.code}` : ''}</li>)}</ol>
        {detail.historyTruncated && <p className="zero-messaging-workspace-hint">Only the latest 25 attempt records are shown.</p>}</div></ScrollArea>
      {detail.resolution ? <p role="status">Resolved: {detail.resolution.action === 'retry' ? 'a new attempt was requested' : 'dismissed'}. The original evidence is retained.</p> : <div className="zero-messaging-workspace-tools"><Button size="sm" variant="outline" disabled={busy || !owner || !!conversation?.archived} onClick={event => { void resolve('dismiss', event.currentTarget); }}>Dismiss</Button>
        {detail.kind === 'assistant' && <Button size="sm" disabled={busy || !owner || !!conversation?.archived} onClick={event => { void resolve('retry', event.currentTarget); }}>Review and retry</Button>}</div>}
      {!owner && !detail.resolution && <p className="zero-messaging-workspace-hint">Take ownership in the conversation before resolving work.</p>}</>}
  </div>;
}
