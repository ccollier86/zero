/** In-memory hook contract tests only; no browser, database, runner, or production fixture. */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import type { JobControlOptions, JobOccurrenceView, JobScheduleDetail, JobScheduleSummary, JobScheduleView } from '../../jobs/contracts';
import { ClientProvider } from '../../frontend/client/client-context';
import { createJobsClient, type JobsClient } from '../../frontend/client/jobs-client';
import { JobsMutationError } from '../../frontend/client/jobs-mutation';
import type { Client } from '../../frontend/client/sdk';
import { createHookContainer, installMinimalHookDom } from '../../frontend/client/test-fixtures/react-hook-dom';
import { useJobsWorkspace, type JobsWorkspaceAction, type UseJobsWorkspaceResult } from './use-jobs-workspace';

const roots = new Set<Root>();
let restoreDom: () => void;
beforeEach(() => { restoreDom = installMinimalHookDom(); });
afterEach(async () => {
  try { for (const root of roots) await act(async () => root.unmount()); }
  finally { roots.clear(); restoreDom(); }
});

describe('native jobs workspace controller', () => {
  test('no-ops without ready intent and synchronously admits only one writer, retaining accepted intent until close', async () => {
    const receipt = deferred<JobScheduleView>();
    const fixture = jobsFixture({ command: () => receipt.promise });
    const rendered = await renderWorkspace(fixture.client);
    expect(await rendered.current.confirm()).toBe(false);
    expect(await rendered.current.reconcile()).toBe(false);
    expect(rendered.current.closeConfirmation()).toBe(false);
    const row = summary();
    await act(async () => {
      expect(rendered.current.prepare('pause', { ...row, actions: { ...row.actions,
        pause: { allowed: false, reason: 'owner-required' } } })).toBe(false);
      expect(rendered.current.prepare('pause', row)).toBe(true);
      expect(rendered.current.prepare('cancel', row)).toBe(false);
    });
    const snapshot = rendered.current.pending!.snapshot;
    (row as { revision: number }).revision = 99;
    let first!: Promise<boolean>, duplicate!: Promise<boolean>;
    await act(async () => {
      first = rendered.current.confirm();
      duplicate = rendered.current.confirm();
      expect(rendered.current.closeConfirmation()).toBe(false);
    });
    expect(await duplicate).toBe(false);
    expect(fixture.writes).toHaveLength(1);
    expect(fixture.writes[0]).toMatchObject({ action: 'pause', id: snapshot.id,
      options: { expectedRevision: 1, idempotencyKey: snapshot.idempotencyKey } });
    expect(rendered.current.pending?.status).toBe('busy');
    await act(async () => { receipt.resolve(view(snapshot.id, 2)); expect(await first).toBe(true); });
    expect(rendered.current.pending).toMatchObject({ status: 'accepted', snapshot, receipt: { id: snapshot.id } });
    expect(await rendered.current.confirm()).toBe(false);
    expect(fixture.writes).toHaveLength(1);
    await act(async () => { expect(rendered.current.closeConfirmation()).toBe(true); });
    expect(rendered.current.pending).toBeNull();
  });

  test('runNow accepts its independent one-off acknowledgment while keeping the original source snapshot', async () => {
    const fixture = jobsFixture({ command: async () => view('job-one-off') });
    const rendered = await renderWorkspace(fixture.client);
    const readsBefore = fixture.detailIds.length;
    await act(async () => { expect(rendered.current.prepare('runNow', summary())).toBe(true); });
    const original = rendered.current.pending!.snapshot;
    await act(async () => { expect(await rendered.current.confirm()).toBe(true); });
    expect(rendered.current.pending).toMatchObject({ status: 'accepted', snapshot: original,
      receipt: { id: 'job-one-off', revision: 1, generation: 1 } });
    expect(original.id).toBe('job-source');
    expect(fixture.writes[0]).toMatchObject({ action: 'runNow', id: 'job-source',
      options: { expectedRevision: 1, idempotencyKey: original.idempotencyKey } });
    expect(fixture.detailIds.length).toBeGreaterThan(readsBefore);
  });

  test('unknown runNow is never retried/discarded; only its original key can reconcile a new one-off receipt', async () => {
    let lookups = 0;
    const fixture = jobsFixture({
      command: async (_action, _id, options) => { throw new JobsMutationError(options.idempotencyKey, 'unknown', 'JOBS_OUTCOME_UNKNOWN', 503); },
      receipt: async () => ++lookups === 1 ? null : view('job-one-off'),
    });
    const rendered = await renderWorkspace(fixture.client);
    await act(async () => { rendered.current.prepare('runNow', summary()); });
    const key = rendered.current.pending!.snapshot.idempotencyKey;
    await act(async () => { expect(await rendered.current.confirm()).toBe(false); });
    expect(rendered.current.pending?.status).toBe('unknown');
    expect(rendered.current.closeConfirmation()).toBe(false);
    expect(rendered.current.prepare('runNow', summary())).toBe(false);
    expect(await rendered.current.confirm()).toBe(false);
    await act(async () => { expect(await rendered.current.reconcile()).toBe(false); });
    expect(rendered.current.pending).toMatchObject({ status: 'unknown', snapshot: { idempotencyKey: key } });
    await act(async () => { expect(await rendered.current.reconcile()).toBe(true); });
    expect(rendered.current.pending).toMatchObject({ status: 'accepted', receipt: { id: 'job-one-off' } });
    expect(fixture.receiptKeys).toEqual([key, key]);
    expect(fixture.writes).toHaveLength(1);
  });

  test('same-ID controls do not accept an unrelated acknowledgment, and receipt reconciliation is single-reader guarded', async () => {
    const receipt = deferred<JobScheduleView | null>();
    const fixture = jobsFixture({ command: async () => view('job-unrelated'), receipt: () => receipt.promise });
    const rendered = await renderWorkspace(fixture.client);
    await act(async () => { rendered.current.prepare('pause', summary()); });
    await act(async () => { expect(await rendered.current.confirm()).toBe(false); });
    expect(rendered.current.pending?.status).toBe('unknown');
    let first!: Promise<boolean>;
    await act(async () => { first = rendered.current.reconcile(); expect(await rendered.current.reconcile()).toBe(false); });
    expect(rendered.current.closeConfirmation()).toBe(false);
    expect(fixture.receiptKeys).toHaveLength(1);
    await act(async () => { receipt.resolve(view('job-source', 2)); expect(await first).toBe(true); });
    expect(rendered.current.pending?.status).toBe('accepted');
    expect(fixture.writes).toHaveLength(1);
  });

  test('known rejection refreshes authorized reads without an optimistic rollback or retry', async () => {
    const fixture = jobsFixture({ command: async (_action, _id, options) => {
      throw new JobsMutationError(options.idempotencyKey, 'not-committed', 'JOBS_REVISION_CONFLICT', 409);
    } });
    const rendered = await renderWorkspace(fixture.client);
    const detailReads = fixture.detailIds.length, occurrenceReads = fixture.occurrenceQueries.length;
    await act(async () => { rendered.current.prepare('pause', summary()); });
    const key = rendered.current.pending!.snapshot.idempotencyKey;
    await act(async () => { expect(await rendered.current.confirm()).toBe(false); });
    expect(rendered.current.pending?.status).toBe('rejected');
    expect(rendered.current.detail.data?.control).toBe('active');
    expect(fixture.detailIds.length).toBeGreaterThan(detailReads);
    expect(fixture.occurrenceQueries.length).toBeGreaterThan(occurrenceReads);
    expect(await rendered.current.confirm()).toBe(false);
    expect(await rendered.current.reconcile()).toBe(false);
    expect(fixture.writes).toHaveLength(1);
    await act(async () => { expect(rendered.current.closeConfirmation()).toBe(true); rendered.current.prepare('pause', summary()); });
    expect(rendered.current.pending!.snapshot.idempotencyKey).not.toBe(key);
  });

  test('pre-aborted confirmation never dispatches; unrecognized errors remain unknown without exposing provider text', async () => {
    const fixture = jobsFixture({ command: async () => { throw new Error('PRIVATE_INPUT_PROMPT_TOKEN'); } });
    const rendered = await renderWorkspace(fixture.client);
    await act(async () => { rendered.current.prepare('pause', summary()); });
    const abort = new AbortController(); abort.abort();
    await act(async () => { expect(await rendered.current.confirm(abort.signal)).toBe(false); });
    expect(rendered.current.pending?.status).toBe('rejected');
    expect(fixture.writes).toHaveLength(0);
    await act(async () => { rendered.current.closeConfirmation(); rendered.current.prepare('pause', summary()); });
    await act(async () => { expect(await rendered.current.confirm()).toBe(false); });
    expect(rendered.current.pending?.status).toBe('unknown');
    expect(JSON.stringify(rendered.current.pending)).not.toContain('PRIVATE_');
    expect(fixture.writes).toHaveLength(1);
  });

  test('detail and occurrence pages load independently, mask replaced selection, and ignore late old reads', async () => {
    const oldDetail = deferred<JobScheduleDetail>();
    const fixture = jobsFixture({ detail: id => id === 'job-old' ? oldDetail.promise : Promise.resolve(detail(id)),
      occurrences: async id => { if (id === 'job-old') throw new Error('PRIVATE_OCCURRENCE'); return { items: [occurrence(id)], total: 41 }; } });
    const rendered = await renderWorkspace(fixture.client);
    expect(rendered.current.detail.data?.id).toBe('job-source');
    expect(rendered.current.occurrences.page?.items[0]?.id).toBe('occurrence-job-source');
    await rendered.update({ selectedId: 'job-old' });
    expect(rendered.renders.find(render => render.id === 'job-old')?.result.detail.data).toBeNull();
    expect(rendered.renders.find(render => render.id === 'job-old')?.result.occurrences.page).toBeNull();
    expect(rendered.current.detail.status).toBe('loading');
    expect(rendered.current.occurrences.status).toBe('error');
    expect(rendered.current.occurrences.error).not.toContain('PRIVATE_');
    const oldCallbacks = rendered.current;
    await rendered.update({ selectedId: 'job-new' });
    expect(rendered.renders.find(render => render.id === 'job-new')?.result.detail.data).toBeNull();
    expect(rendered.renders.find(render => render.id === 'job-new')?.result.occurrences.page).toBeNull();
    expect(rendered.current.detail.data?.id).toBe('job-new');
    await act(async () => { oldDetail.resolve(detail('job-old')); });
    expect(rendered.current.detail.data?.id).toBe('job-new');
    const detailReads = fixture.detailIds.length;
    await act(async () => { rendered.current.setOccurrenceOffset(20); oldCallbacks.refresh(); oldCallbacks.setOccurrenceOffset(80); });
    expect(rendered.current.occurrences.offset).toBe(20);
    expect(fixture.occurrenceQueries.at(-1)).toEqual({ id: 'job-new', limit: 20, offset: 20 });
    expect(fixture.detailIds).toHaveLength(detailReads);
    await rendered.update({ changeKey: 1 });
    expect(fixture.detailIds.length).toBeGreaterThan(detailReads);
    await rendered.update({ selectedId: 'job-other' });
    expect(rendered.current.occurrences.offset).toBe(0);
  });

  for (const replacement of ['lifetime', 'client'] as const) {
    test(`${replacement} replacement retires pending callbacks and cannot acknowledge into a new intent`, async () => {
      const receipt = deferred<JobScheduleView>();
      const original = jobsFixture({ command: () => receipt.promise }), replacementJobs = jobsFixture();
      const rendered = await renderWorkspace(original.client);
      await act(async () => { rendered.current.prepare('pause', summary()); });
      const old = rendered.current;
      let pending!: Promise<boolean>;
      await act(async () => { pending = old.confirm(); });
      await rendered.update(replacement === 'lifetime' ? { lifetimeKey: 'replacement' } : { client: replacementJobs.client });
      expect(original.writes[0]!.options.signal!.aborted).toBe(true);
      expect(rendered.current.pending).toBeNull();
      expect(old.prepare('cancel', summary())).toBe(false);
      expect(await old.confirm()).toBe(false);
      expect(await old.reconcile()).toBe(false);
      expect(old.closeConfirmation()).toBe(false);
      await act(async () => { expect(rendered.current.prepare('resume', summary())).toBe(true); });
      const newKey = rendered.current.pending!.snapshot.idempotencyKey;
      await act(async () => { receipt.resolve(view('job-source', 2)); expect(await pending).toBe(false); });
      expect(rendered.current.pending).toMatchObject({ status: 'ready', snapshot: { idempotencyKey: newKey, action: 'resume' } });
      expect(original.writes).toHaveLength(1);
    });
  }

  test('unmount retires an in-flight wait without reporting server rollback or invoking a retained callback', async () => {
    const receipt = deferred<JobScheduleView>();
    const fixture = jobsFixture({ command: () => receipt.promise });
    const rendered = await renderWorkspace(fixture.client);
    await act(async () => { rendered.current.prepare('pause', summary()); });
    const old = rendered.current;
    let pending!: Promise<boolean>;
    await act(async () => { pending = old.confirm(); });
    await rendered.unmount();
    expect(fixture.writes[0]!.options.signal!.aborted).toBe(true);
    expect(old.prepare('pause', summary())).toBe(false);
    expect(await old.confirm()).toBe(false);
    receipt.resolve(view('job-source', 2));
    expect(await pending).toBe(false);
    expect(fixture.writes).toHaveLength(1);
  });

  test('a live authority change freezes captured callbacks before React receives its boundary notification', async () => {
    const authority = syntheticAuthority(), fixture = jobsFixture();
    const rendered = await renderWorkspace(fixture.client, { provider: authority.provider });
    await act(async () => { rendered.current.prepare('pause', summary()); });
    const old = rendered.current;
    authority.auth.authorizationScopeKey = 'replacement-actor-session';
    expect(await old.confirm()).toBe(false);
    expect(old.closeConfirmation()).toBe(false);
    expect(old.prepare('cancel', summary())).toBe(false);
    expect(fixture.writes).toHaveLength(0);
    await act(async () => { authority.notify(); });
    expect(rendered.current.pending).toBeNull();
    expect(old.prepare('pause', summary())).toBe(false);
  });
});

interface HarnessOptions { client: JobsClient; lifetimeKey: string; selectedId: string | null; changeKey: string | number; provider?: Client }
async function renderWorkspace(client: JobsClient, input: Partial<HarnessOptions> = {}) {
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(createHookContainer()); roots.add(root);
  let options: HarnessOptions = { client, lifetimeKey: 'synthetic-owner', selectedId: 'job-source', changeKey: 0, ...input };
  let current!: UseJobsWorkspaceResult;
  const renders: { id: string | null; result: UseJobsWorkspaceResult }[] = [];
  function Capture() {
    current = useJobsWorkspace(options.client, options.lifetimeKey, options.selectedId, options.changeKey);
    renders.push({ id: options.selectedId, result: current });
    return null;
  }
  const render = () => root.render(options.provider
    ? createElement(ClientProvider, { client: options.provider, children: createElement(Capture) }) : createElement(Capture));
  await act(async () => { render(); });
  return { get current() { return current; }, renders,
    async update(patch: Partial<HarnessOptions>) { options = { ...options, ...patch }; await act(async () => { render(); }); },
    async unmount() { await act(async () => root.unmount()); roots.delete(root); },
  };
}

function jobsFixture(handlers: {
  command?: (action: JobsWorkspaceAction, id: string, options: JobControlOptions) => Promise<JobScheduleView>;
  receipt?: (key: string) => Promise<JobScheduleView | null>;
  detail?: (id: string) => Promise<JobScheduleDetail>;
  occurrences?: (id: string) => Promise<{ items: readonly JobOccurrenceView[]; total: number }>;
} = {}) {
  const writes: { action: JobsWorkspaceAction; id: string; options: JobControlOptions }[] = [];
  const detailIds: string[] = [], occurrenceQueries: { id: string; limit: number; offset: number }[] = [], receiptKeys: string[] = [];
  const base = createJobsClient(async () => { throw new Error('Unexpected synthetic request.'); });
  const command = (action: JobsWorkspaceAction) => async (id: string, options: JobControlOptions) => {
    writes.push({ action, id, options });
    return handlers.command ? handlers.command(action, id, options) : view(action === 'runNow' ? 'job-one-off' : id, 2);
  };
  const client: JobsClient = { ...base, receipts: { async get(key) { receiptKeys.push(key); return handlers.receipt?.(key) ?? null; } },
    schedules: { ...base.schedules,
      async get(id) { detailIds.push(id); return handlers.detail ? handlers.detail(id) : detail(id); },
      async occurrences(id, options) {
        occurrenceQueries.push({ id, limit: options?.limit ?? 20, offset: options?.offset ?? 0 });
        return handlers.occurrences ? handlers.occurrences(id) : { items: [], total: 0 };
      },
      pause: command('pause'), resume: command('resume'), cancel: command('cancel'), runNow: command('runNow'),
    } };
  return { client, writes, detailIds, occurrenceQueries, receiptKeys };
}
function view(id = 'job-source', revision = 1): JobScheduleView {
  return { id, definition: 'synthetic.job', definitionVersion: '1', ownerId: 'synthetic-owner', runAs: 'actor',
    control: 'active', revision, generation: 1, createdAt: 1, updatedAt: 1 };
}
function summary(id = 'job-source'): JobScheduleSummary {
  const allowed = { allowed: true, reason: null } as const;
  return { ...view(id), nextDueAt: 100, skipped: false, blockedCode: null, latestOccurrence: null, activeOccurrence: null,
    actions: { pause: allowed, resume: allowed, cancel: allowed, update: allowed, runNow: allowed } };
}
function detail(id: string): JobScheduleDetail {
  return { ...summary(id), timing: { kind: 'once', at: '1970-01-01T00:00:00.100Z', maxLatenessMs: 1 }, overlap: 'skip' };
}
function occurrence(id: string): JobOccurrenceView {
  return { id: 'occurrence-' + id, generation: 1, scheduledAt: 1, state: 'pending', workflowId: null, terminalStatus: null,
    errorCode: null, createdAt: 1, updatedAt: 1 };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
function syntheticAuthority() {
  const listeners = new Set<() => void>(), subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };
  const auth = { authorizationScopeKey: 'original-actor-session', user: { userId: 'synthetic-owner' }, activeTenant: { tenantId: 'synthetic-tenant' },
    isLoading: false, isRestoring: false, isAuthenticated: true, authorizationState: { status: 'ready' },
    sessionTransition: { phase: 'idle', revision: 0 }, subscribe, subscribeAuthorization: subscribe };
  return { auth, provider: { auth } as unknown as Client, notify() { for (const listener of listeners) listener(); } };
}
