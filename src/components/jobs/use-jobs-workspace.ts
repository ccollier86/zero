'use client';

/** Native, in-memory operator intent only. No optimistic controls, journals, or write effects. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JobOccurrenceView, JobScheduleDetail, JobScheduleSummary, JobScheduleView } from '../../jobs/contracts';
import { useClientMaybe } from '../../frontend/client/client-context';
import type { Client, InternalClient } from '../../frontend/client/sdk';
import type { JobsClient } from '../../frontend/client/jobs-client';
import { JobsMutationError } from '../../frontend/client/jobs-mutation';
import { isAuthorizationDataReady, isAuthorizationScopeReady, readAuthorizationScopeBoundaryKey,
  useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';

export type JobsWorkspaceAction = 'pause' | 'resume' | 'cancel' | 'runNow';
export interface JobsActionSnapshot {
  readonly action: JobsWorkspaceAction;
  readonly id: string;
  readonly revision: number;
  /** Retain this original identity for manual receipt reconciliation; never replace it on uncertainty. */
  readonly idempotencyKey: string;
}
export interface PendingJobsAction {
  readonly snapshot: JobsActionSnapshot;
  readonly status: 'ready' | 'busy' | 'unknown' | 'rejected' | 'accepted';
  readonly error: string | null;
  readonly receipt?: JobScheduleView;
}
type ReadStatus = 'idle' | 'loading' | 'ready' | 'error';
interface OccurrencePage { readonly items: readonly JobOccurrenceView[]; readonly total: number }
export interface UseJobsWorkspaceResult {
  readonly detail: { readonly status: ReadStatus; readonly data: JobScheduleDetail | null; readonly error: string | null };
  readonly occurrences: {
    readonly status: ReadStatus; readonly page: OccurrencePage | null; readonly error: string | null;
    readonly offset: number; readonly limit: 20;
  };
  readonly pending: PendingJobsAction | null;
  refresh(): void;
  refreshDetail(): void;
  refreshOccurrences(): void;
  setOccurrenceOffset(offset: number): void;
  prepare(action: JobsWorkspaceAction, row: JobScheduleSummary): boolean;
  /** True only after a native accepted acknowledgment; all other outcomes keep the dialog open. */
  confirm(signal?: AbortSignal): Promise<boolean>;
  /** Read only: never retries the original command, even when no receipt exists yet. */
  reconcile(): Promise<boolean>;
  /** Busy/unknown intent cannot be discarded as though the server rolled it back. */
  closeConfirmation(): boolean;
}

interface Scope {
  readonly jobs: JobsClient; readonly provider: Client | null; readonly lifetimeKey: string;
  readonly boundaryKey: string; readonly ready: boolean; readonly controllers: Set<AbortController>;
}
interface Selection { readonly scope: Scope; readonly id: string | null }
interface ReadRequest { readonly selection: Selection; readonly changeKey: string | number; readonly revision: number; readonly offset: number }
interface ReadState<T> { readonly request: ReadRequest; readonly status: 'ready' | 'error'; readonly value: T | null }
interface Intent { readonly scope: Scope; readonly value: PendingJobsAction }

const UNKNOWN = 'The operation may have been accepted. Check its receipt using the original request identity; do not submit a new request.';
const REJECTED = 'The operation was not accepted. Review current job data before preparing a new request.';
const RECEIPT_MISSING = 'No receipt is available yet. The original operation is still unresolved; do not submit a new request.';

export function useJobsWorkspace(
  client: JobsClient,
  lifetimeKey: string,
  selectedId: string | null,
  changeKey: string | number,
): UseJobsWorkspaceResult {
  const provider = useClientMaybe(), boundary = useAuthorizationScopeBoundary(provider);
  const scopeRef = useRef<Scope | null>(null);
  if (!scopeRef.current || scopeRef.current.jobs !== client || scopeRef.current.provider !== provider
    || scopeRef.current.lifetimeKey !== lifetimeKey || scopeRef.current.boundaryKey !== boundary.key
    || scopeRef.current.ready !== boundary.ready) {
    scopeRef.current = { jobs: client, provider, lifetimeKey, boundaryKey: boundary.key, ready: boundary.ready, controllers: new Set() };
  }
  const scope = scopeRef.current;
  const selectionRef = useRef<Selection | null>(null);
  if (!selectionRef.current || selectionRef.current.scope !== scope || selectionRef.current.id !== selectedId) {
    selectionRef.current = { scope, id: selectedId };
  }
  const selection = selectionRef.current;
  const mounted = useRef({ active: false, generation: 0 });
  const [detailRevision, setDetailRevision] = useState(0), [occurrenceRevision, setOccurrenceRevision] = useState(0);
  const [offsetState, setOffsetState] = useState<{ selection: Selection | null; value: number }>({ selection: null, value: 0 });
  const offset = offsetState.selection === selection ? offsetState.value : 0;
  const detailRequestRef = useRef<ReadRequest | null>(null), occurrenceRequestRef = useRef<ReadRequest | null>(null);
  const detailRequest = readRequest(detailRequestRef, selection, changeKey, detailRevision, 0);
  const occurrenceRequest = readRequest(occurrenceRequestRef, selection, changeKey, occurrenceRevision, offset);
  const [detailState, setDetailState] = useState<ReadState<JobScheduleDetail> | null>(null);
  const [occurrenceState, setOccurrenceState] = useState<ReadState<OccurrencePage> | null>(null);
  const intentRef = useRef<Intent | null>(null), [intent, setIntent] = useState<Intent | null>(null);

  const current = useCallback((captured: Scope, generation = mounted.current.generation) =>
    mounted.current.active && mounted.current.generation === generation && scopeRef.current === captured
      && readable(captured), []);
  useEffect(() => {
    mounted.current.active = true;
    return () => { mounted.current.active = false; mounted.current.generation++; };
  }, []);
  useEffect(() => () => {
    // Cancelling a local wait does not undo, or establish the outcome of, a dispatched server command.
    for (const controller of scope.controllers) controller.abort();
    scope.controllers.clear();
  }, [scope]);

  useEffect(() => {
    if (!selectedId || !scope.ready) return;
    let active = true;
    const generation = mounted.current.generation;
    const isCurrent = () => active && current(scope, generation) && detailRequestRef.current === detailRequest;
    void Promise.resolve().then(() => {
      if (isCurrent()) return client.schedules.get(selectedId);
    }).then(value => {
      if (value && isCurrent()) setDetailState({ request: detailRequest, status: 'ready', value });
    }).catch(() => {
      if (isCurrent()) setDetailState({ request: detailRequest, status: 'error', value: null });
    });
    return () => { active = false; };
  }, [client, scope, selectedId, detailRequest, current]);
  useEffect(() => {
    if (!selectedId || !scope.ready) return;
    let active = true;
    const generation = mounted.current.generation;
    const isCurrent = () => active && current(scope, generation) && occurrenceRequestRef.current === occurrenceRequest;
    void Promise.resolve().then(() => {
      if (isCurrent()) return client.schedules.occurrences(selectedId, { limit: 20, offset });
    }).then(value => {
      if (value && isCurrent()) setOccurrenceState({ request: occurrenceRequest, status: 'ready', value });
    }).catch(() => {
      if (isCurrent()) setOccurrenceState({ request: occurrenceRequest, status: 'error', value: null });
    });
    return () => { active = false; };
  }, [client, scope, selectedId, occurrenceRequest, offset, current]);

  const refreshDetail = useCallback(() => {
    if (current(scope) && selectionRef.current === selection) setDetailRevision(value => value + 1);
  }, [scope, selection, current]);
  const refreshOccurrences = useCallback(() => {
    if (current(scope) && selectionRef.current === selection) setOccurrenceRevision(value => value + 1);
  }, [scope, selection, current]);
  const refresh = useCallback(() => { refreshDetail(); refreshOccurrences(); }, [refreshDetail, refreshOccurrences]);
  const setOccurrenceOffset = useCallback((value: number) => {
    if (current(scope) && selectionRef.current === selection && Number.isSafeInteger(value) && value >= 0 && value <= 100_000) {
      setOffsetState({ selection, value: Math.floor(value / 20) * 20 });
    }
  }, [scope, selection, current]);
  const prepare = useCallback((action: JobsWorkspaceAction, row: JobScheduleSummary) => {
    if (!current(scope) || intentRef.current?.scope === scope
      || !['pause', 'resume', 'cancel', 'runNow'].includes(action) || !row.actions[action]?.allowed
      || !Number.isSafeInteger(row.revision) || row.revision < 1) return false;
    const value: PendingJobsAction = { snapshot: Object.freeze({ action, id: row.id, revision: row.revision,
      idempotencyKey: 'jobs-ui:' + crypto.randomUUID() }), status: 'ready', error: null };
    const next = { scope, value };
    intentRef.current = next;
    setIntent(next);
    return true;
  }, [scope, current]);

  const confirm = useCallback(async (signal?: AbortSignal): Promise<boolean> => {
    const original = intentRef.current;
    if (!current(scope) || original?.scope !== scope || original.value.status !== 'ready') return false;
    const generation = mounted.current.generation, snapshot = original.value.snapshot;
    const busy: Intent = { scope, value: { snapshot, status: 'busy', error: null } };
    // This ref is the synchronous single-writer guard, including two clicks before React renders.
    intentRef.current = busy;
    setIntent(busy);
    const controller = new AbortController();
    scope.controllers.add(controller);
    const isCurrent = () => current(scope, generation) && intentRef.current === busy;
    const finish = (value: PendingJobsAction, refreshReads: boolean) => {
      if (!isCurrent()) return false;
      const next = { scope, value };
      intentRef.current = next;
      setIntent(next);
      if (refreshReads) { setDetailRevision(value => value + 1); setOccurrenceRevision(value => value + 1); }
      return value.status === 'accepted';
    };
    try {
      if (signal?.aborted) return finish({ snapshot, status: 'rejected', error: 'The operation was not sent.' }, true);
      const receipt = await client.schedules[snapshot.action](snapshot.id, { expectedRevision: snapshot.revision,
        idempotencyKey: snapshot.idempotencyKey,
        signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal });
      if (!acknowledges(snapshot, receipt)) return finish({ snapshot, status: 'unknown', error: UNKNOWN }, false);
      return finish({ snapshot, status: 'accepted', error: null, receipt }, true);
    } catch (cause) {
      const rejected = cause instanceof JobsMutationError && cause.idempotencyKey === snapshot.idempotencyKey && cause.outcome !== 'unknown';
      return finish({ snapshot, status: rejected ? 'rejected' : 'unknown', error: rejected ? REJECTED : UNKNOWN }, rejected);
    } finally { scope.controllers.delete(controller); }
  }, [client, scope, current]);

  const reconcile = useCallback(async (): Promise<boolean> => {
    const original = intentRef.current;
    if (!current(scope) || original?.scope !== scope || original.value.status !== 'unknown') return false;
    const generation = mounted.current.generation, snapshot = original.value.snapshot;
    const busy: Intent = { scope, value: { snapshot, status: 'busy', error: null } };
    intentRef.current = busy;
    setIntent(busy);
    let receipt: JobScheduleView | null = null, failed = false;
    try { receipt = await client.receipts.get(snapshot.idempotencyKey); } catch { failed = true; }
    if (!current(scope, generation) || intentRef.current !== busy) return false;
    const accepted = receipt !== null && acknowledges(snapshot, receipt);
    const next: Intent = { scope, value: accepted ? { snapshot, status: 'accepted', error: null, receipt: receipt! }
      : { snapshot, status: 'unknown', error: failed || receipt !== null ? UNKNOWN : RECEIPT_MISSING } };
    intentRef.current = next;
    setIntent(next);
    if (accepted) { setDetailRevision(value => value + 1); setOccurrenceRevision(value => value + 1); }
    return accepted;
  }, [client, scope, current]);
  const closeConfirmation = useCallback(() => {
    const original = intentRef.current;
    if (!current(scope) || original?.scope !== scope) return false;
    if (original.value.status === 'busy' || original.value.status === 'unknown') return false;
    intentRef.current = null;
    setIntent(null);
    return true;
  }, [scope, current]);

  // Selection/request identities mask old protected content in render, before effect cleanup runs.
  const enabled = scope.ready && selectedId !== null;
  const detail = enabled && detailState?.request === detailRequest ? detailState : null;
  const occurrences = enabled && occurrenceState?.request === occurrenceRequest ? occurrenceState : null;
  const detailStatus: ReadStatus = !enabled ? 'idle' : detail?.status ?? 'loading';
  const occurrenceStatus: ReadStatus = !enabled ? 'idle' : occurrences?.status ?? 'loading';
  return {
    detail: { status: detailStatus, data: detail?.value ?? null,
      error: detailStatus === 'error' ? 'Job details could not be loaded. Reauthorize or retry the read.' : null },
    occurrences: { status: occurrenceStatus, page: occurrences?.value ?? null, offset, limit: 20,
      error: occurrenceStatus === 'error' ? 'Job occurrences could not be loaded. Reauthorize or retry the read.' : null },
    pending: scope.ready && intent?.scope === scope ? intent.value : null,
    refresh, refreshDetail, refreshOccurrences, setOccurrenceOffset, prepare, confirm, reconcile, closeConfirmation,
  };
}

function readRequest(ref: { current: ReadRequest | null }, selection: Selection, changeKey: string | number, revision: number, offset: number): ReadRequest {
  const old = ref.current;
  if (!old || old.selection !== selection || old.changeKey !== changeKey || old.revision !== revision || old.offset !== offset) {
    ref.current = { selection, changeKey, revision, offset };
  }
  return ref.current!;
}

function acknowledges(snapshot: JobsActionSnapshot, receipt: JobScheduleView): boolean {
  // runNow creates an independent one-off. Its acknowledgment is bound by the original
  // command/key (and receipts.get(key)), not by equality with the source schedule ID.
  return snapshot.action === 'runNow' ? receipt.id !== snapshot.id : receipt.id === snapshot.id;
}

/** Read live authority as well as React's snapshot: a callback can run before a boundary rerender. */
function readable(scope: Scope): boolean {
  if (!scope.ready) return false;
  const internal = scope.provider as InternalClient | null, auth = internal?.auth ?? null;
  const revision = internal?._authorizationDataBoundary?.revision ?? 0;
  return readAuthorizationScopeBoundaryKey(auth, revision) === scope.boundaryKey && (!auth
    || isAuthorizationScopeReady(auth.sessionTransition, auth.isRestoring)
      && isAuthorizationDataReady(revision, auth.authorizationState.status, auth.isAuthenticated));
}
