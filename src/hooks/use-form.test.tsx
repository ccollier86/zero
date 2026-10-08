import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, createElement, Fragment, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';

import { defineSchema, field } from '../schema';
import type { Row } from '../sync/types';
import { ClientProvider } from '../frontend/client/client-context';
import type { Collection } from '../frontend/client/sdk';
import type { AuthClient } from '../frontend/client/auth-client';
import type { Client } from '../frontend/client/sdk';
import { useForm, type UseFormOptions } from './use-form';
import { useReactiveFormRecord } from './use-reactive-form-record';
import { useFormSave, type UseFormSaveReturn } from './use-form-save';
import type { FormRecordSnapshot } from './form-save-types';
import { configureFrontendObservability, type FrontendObservabilityEvent } from '../frontend/client/observability';

type FormRow = Row & { id: string; title: string };

const schema = defineSchema({
  id: field.text({ required: true }),
  title: field.text({ required: true }),
});

const activeRoots = new Set<Root>();
let restoreDom: (() => void) | null = null;
let events: FrontendObservabilityEvent[] = [];

beforeEach(() => {
  restoreDom = installMinimalDom();
  events = [];
  configureFrontendObservability({ sink: { emit(event) { events.push(event); } } });
});

afterEach(async () => {
  for (const root of [...activeRoots]) {
    await act(async () => root.unmount());
    activeRoots.delete(root);
  }
  restoreDom?.();
  restoreDom = null;
  configureFrontendObservability({ http: false, console: false });
});

describe('useForm collection submission', () => {
  test('form record incarnations automatically retire Save/Discard/Stay without duplicate scope configuration', async () => {
    const rendered = await renderForm({ baseline: 'accepted', recordIdentity: 'a', withSave: true });
    await act(async () => { rendered.current.setValue('title', 'Original target draft'); });
    let continued = 0, pending!: Promise<boolean>;
    await act(async () => { pending = rendered.save!.requestLeave(() => { continued++; }); });
    expect(rendered.save!.confirmationOpen).toBe(true); const key = rendered.current.boundaryKey;
    await rendered.update({ recordIdentity: 'b' });
    expect(await pending).toBe(false); expect(rendered.save!.confirmationOpen).toBe(false);
    await rendered.update({ recordIdentity: 'a' });
    expect(rendered.current.boundaryKey).not.toBe(key); expect(continued).toBe(0);
  });
  test('cancelled close admission still accepts an admitted current form save without continuing its close', async () => {
    const receipt = deferred<{ values: Partial<FormRow>; revision: number }>(); let submitSignal!: AbortSignal;
    const rendered = await renderForm({ baseline: 'accepted', initialRevision: 1, withSave: true,
      onSubmit: (_, ctx) => { submitSignal = ctx.signal; return receipt.promise; } });
    const closeSignal = new AbortController(); let continued = 0, leaving!: Promise<boolean>, saving!: Promise<void>;
    await act(async () => { rendered.current.setValue('title', 'Sent');
      leaving = rendered.save!.requestLeave(() => { continued++; }, { signal: closeSignal.signal }); });
    await act(async () => { saving = rendered.save!.chooseLeave('save'); });
    await act(async () => closeSignal.abort());
    expect(await leaving).toBe(false); expect(submitSignal.aborted).toBe(false);
    expect(rendered.save!.confirmationOpen).toBe(false); expect(rendered.save!.isSaving).toBe(true);
    await act(async () => { receipt.resolve({ values: { title: 'Accepted' }, revision: 2 }); await saving; });
    expect(rendered.current.watch('title')).toBe('Accepted'); expect(rendered.current.revision).toBe(2);
    expect(rendered.current.isDirty).toBe(false); expect(continued).toBe(0);
  });
  test('late explicit source hydration loads canonical values/revision atomically and ignores pending local echoes', async () => {
    const rendered = await renderForm({ baseline: 'accepted', recordIdentity: 'row-1',
      source: { identity: 'row-1', status: 'loading' }, onSubmit: async () => {} });
    expect(rendered.current.recordState.status).toBe('loading'); expect(await rendered.current.submit()).toEqual({ kind: 'blocked' });
    await rendered.update({ source: { identity: 'row-1', status: 'ready', origin: 'authoritative',
      values: { id: 'row-1', title: 'Loaded later' }, revision: 8 } });
    expect(rendered.current.watch('title')).toBe('Loaded later'); expect(rendered.current.revision).toBe(8);
    expect(rendered.current.isDirty).toBe(false); expect(rendered.current.recordState.status).toBe('ready');
    await rendered.update({ source: { identity: 'row-1', status: 'ready', origin: 'pending-local',
      values: { id: 'row-1', title: 'Optimistic only' }, revision: 9 } });
    expect(rendered.current.watch('title')).toBe('Loaded later'); expect(rendered.current.revision).toBe(8);
    expect(rendered.current.recordState.changedElsewhere).toBe(false);
  });
  test('re-created unchanged source descriptors never roll an accepted baseline back while reactive data catches up', async () => {
    const rendered = await renderForm({ baseline: 'accepted', recordIdentity: 'row-1', initialRevision: 1,
      source: { identity: 'row-1', status: 'ready', origin: 'authoritative', values: { id: 'row-1', title: 'A title' }, revision: 1 },
      onSubmit: async () => ({ values: { title: 'Canonical accepted' }, revision: 2 }) });
    await act(async () => { rendered.current.setValue('title', 'Submitted'); await rendered.current.submit(); });
    expect(rendered.current.watch('title')).toBe('Canonical accepted'); expect(rendered.current.revision).toBe(2);
    await rendered.update({});
    expect(rendered.current.watch('title')).toBe('Canonical accepted'); expect(rendered.current.revision).toBe(2);
    await rendered.update({ source: { identity: 'row-1', status: 'loading' } });
    await rendered.update({ source: { identity: 'row-1', status: 'ready', origin: 'authoritative',
      values: { id: 'row-1', title: 'A title' }, revision: 1 } });
    expect(rendered.current.watch('title')).toBe('Canonical accepted'); expect(rendered.current.revision).toBe(2);
    expect(rendered.current.recordState.status).toBe('loading');
    await rendered.update({ source: { identity: 'row-1', status: 'ready', origin: 'authoritative',
      values: { id: 'row-1', title: 'A later remote update' }, revision: 3 } });
    expect(rendered.current.watch('title')).toBe('A later remote update'); expect(rendered.current.revision).toBe(3);
  });
  test('dirty remote updates keep the expected revision and deliberate reload replaces the entire baseline', async () => {
    let expected: unknown;
    const rendered = await renderForm({ baseline: 'accepted', recordIdentity: 'row-1', initialRevision: 1,
      onSubmit: async (_, ctx) => { expected = ctx.expectedRevision; throw { code: 'REVISION_CONFLICT' }; } });
    await act(async () => { rendered.current.reconcileRecord({ identity: 'row-1', status: 'ready', origin: 'authoritative',
      values: { id: 'row-1', title: 'A title' }, revision: 1 }); rendered.current.setValue('title', 'My draft'); });
    await act(async () => { rendered.current.reconcileRecord({ identity: 'row-1', status: 'ready', origin: 'authoritative',
      values: { id: 'row-1', title: 'Changed remotely' }, revision: 2 }); });
    expect(rendered.current.watch('title')).toBe('My draft'); expect(rendered.current.revision).toBe(1);
    expect(rendered.current.recordState.changedElsewhere).toBe(true); expect(rendered.current.recordState.incomingRevision).toBe(2);
    expect(rendered.current.reloadRecord()).toEqual({ kind: 'blocked', reason: 'draft' });
    await act(async () => { expect((await rendered.current.submit()).kind).toBe('failed'); });
    expect(expected).toBe(1); expect(rendered.current.hasConflict).toBe(true);
    await act(async () => { expect(rendered.current.reloadRecord({ discardDraft: true }).kind).toBe('adopted'); });
    expect(rendered.current.watch('title')).toBe('Changed remotely'); expect(rendered.current.revision).toBe(2);
    expect(rendered.current.isDirty).toBe(false); expect(rendered.current.hasConflict).toBe(false);
    expect(rendered.current.recordState.changedElsewhere).toBe(false);
  });
  test('a matching authoritative save echo clears awareness without losing edits made during the write', async () => {
    const receipt = deferred<{ values: Partial<FormRow>; revision: number }>();
    const rendered = await renderForm({ baseline: 'accepted', recordIdentity: 'row-1', initialRevision: 1, onSubmit: () => receipt.promise });
    let saving!: ReturnType<typeof rendered.current.submit>;
    await act(async () => { rendered.current.reconcileRecord({ identity: 'row-1', status: 'ready', origin: 'authoritative',
      values: { id: 'row-1', title: 'A title' }, revision: 1 }); rendered.current.setValue('title', 'Sent'); saving = rendered.current.submit(); });
    await act(async () => { rendered.current.setValue('title', 'Newer draft');
      rendered.current.reconcileRecord({ identity: 'row-1', status: 'ready', origin: 'authoritative',
        values: { id: 'row-1', title: 'Canonical' }, revision: 2 }); });
    expect(rendered.current.reloadRecord({ discardDraft: true })).toEqual({ kind: 'blocked', reason: 'saving' });
    await act(async () => { receipt.resolve({ values: { title: 'Canonical' }, revision: 2 }); await saving; });
    expect((await saving).kind).toBe('accepted');
    expect(events).toEqual([]);
    expect(rendered.current.captureValues().expectedRevision).toBe(2);
    expect(rendered.current.watch('title')).toBe('Newer draft'); expect(rendered.current.revision).toBe(2);
    expect(rendered.current.isDirty).toBe(true); expect(rendered.current.recordState.changedElsewhere).toBe(false);
  });
  test('record identity A→B→A retires original callbacks, captures and pending acknowledgments', async () => {
    const receipt = deferred<{ values: Partial<FormRow>; revision: number }>(); let successes = 0;
    const rendered = await renderForm({ baseline: 'accepted', recordIdentity: 'a', initialRevision: 1,
      onSubmit: () => receipt.promise, onSuccess: () => { successes++; } });
    let pending!: ReturnType<typeof rendered.current.submit>;
    await act(async () => { rendered.current.reconcileRecord({ identity: 'a', status: 'ready', origin: 'authoritative',
      values: { id: 'row-1', title: 'A title' }, revision: 1 }); pending = rendered.current.submit(); });
    const old = rendered.current, capture = old.captureValues();
    await rendered.update({ recordIdentity: 'b' }); await rendered.update({ recordIdentity: 'a' });
    await act(async () => { receipt.resolve({ values: { title: 'Old result' }, revision: 9 }); await pending; });
    expect((await pending).kind).toBe('retired'); expect(successes).toBe(0);
    expect(old.reconcileRecord({ identity: 'a', status: 'ready', origin: 'authoritative', values: { title: 'Old source' }, revision: 9 }))
      .toEqual({ kind: 'ignored', reason: 'retired' });
    expect(Object.keys(old.getValues())).toEqual([]); expect(old.watch('title')).toBeUndefined();
    expect(rendered.current.acceptValues({ values: { title: 'Old capture' } }, capture)).toBe(false);
    expect(rendered.current.watch('title')).toBe('A title'); expect(rendered.current.revision).toBe(1);
  });
  test('explicit forbidden record read masks fields and blocks saves instead of guessing from cache absence', async () => {
    const rendered = await renderForm({ baseline: 'accepted', recordIdentity: 'row-1', onSubmit: async () => {} });
    await act(async () => { rendered.current.reconcileRecord({ identity: 'row-1', status: 'forbidden' }); });
    expect(rendered.current.watch('title')).toBeUndefined(); expect(Object.keys(rendered.current.getValues())).toEqual([]);
    expect(rendered.current.captureValues().fields).toEqual([]); expect(rendered.current.isValid).toBe(false);
    expect(rendered.current.register('title').value).toBe(''); expect(await rendered.current.submit()).toEqual({ kind: 'blocked' });
  });
  test('collection-backed submissions forward their exact abort signal without pretending to provide CAS', async () => {
    const receipt = deferred<void>(); let signal: AbortSignal | undefined;
    const rendered = await renderForm({ recordIdentity: undefined, collection: { insertAsync: (_: unknown, options: { signal?: AbortSignal }) => {
      signal = options.signal; return receipt.promise;
    } } as unknown as Collection<FormRow> });
    let pending!: ReturnType<typeof rendered.current.submit>;
    await act(async () => { pending = rendered.current.submit(); });
    expect(signal).toBeInstanceOf(AbortSignal); expect(signal!.aborted).toBe(false);
    await rendered.update({ scopeKey: 'new-target' }); expect(signal!.aborted).toBe(true);
    await act(async () => { receipt.resolve(); await pending; }); expect((await pending).kind).toBe('retired');
  });
  test('manual field validation uses declared schema errors and cannot validate foreign fields', async () => {
    const rendered = await renderForm({ baseline: 'accepted' });
    await act(async () => rendered.current.setValue('title', ''));
    let valid = true;
    await act(async () => { valid = rendered.current.validateFields(['title']); });
    expect(valid).toBe(false); expect(rendered.current.errors.title).toBeTruthy();
    expect(() => rendered.current.validateFields(['foreign'])).toThrow('unique declared fields');
    expect(() => rendered.current.validateFields(['title', 'title'])).toThrow('unique declared fields');
    await act(async () => { rendered.current.setValue('title', 'Valid'); valid = rendered.current.validateFields(['title']); });
    expect(valid).toBe(true); expect(rendered.current.errors.title).toBeUndefined();
  });
  test('accepted mode adopts canonical values and revision without overwriting newer edits', async () => {
    let resolve!: (result: { values: Partial<FormRow>; revision: number }) => void;
    const receipt = new Promise<{ values: Partial<FormRow>; revision: number }>(yes => { resolve = yes; });
    let expected: string | number | undefined;
    const rendered = await renderForm({ baseline: 'accepted', initialRevision: 1,
      onSubmit: (_, context) => { expected = context.expectedRevision; return receipt; } });
    await act(async () => rendered.current.setValue('title', 'Submitted'));
    let saving!: ReturnType<typeof rendered.current.submit>;
    await act(async () => { saving = rendered.current.submit(); await Promise.resolve(); });
    await act(async () => { rendered.current.setValue('title', 'Newer'); });
    await act(async () => { resolve({ values: { title: 'Canonical' }, revision: 2 }); await saving; });
    expect(expected).toBe(1); expect((await saving).kind).toBe('accepted');
    expect(rendered.current.watch('title')).toBe('Newer'); expect(rendered.current.isDirty).toBe(true);
    expect(rendered.current.revision).toBe(2);
    await act(async () => rendered.current.reset());
    expect(rendered.current.watch('title')).toBe('Canonical'); expect(rendered.current.isDirty).toBe(false);
  });
  test('manual field acceptance preserves A→B→A and detaches getValues snapshots', async () => {
    const rendered = await renderForm({ baseline: 'accepted', initialRevision: 1 });
    let snapshot!: ReturnType<typeof rendered.current.captureValues>;
    await act(async () => { rendered.current.setValue('title', 'A'); snapshot = rendered.current.captureValues(['title']); });
    await act(async () => { rendered.current.setValue('title', 'B'); rendered.current.setValue('title', 'A'); });
    await act(async () => { expect(rendered.current.acceptValues({ values: { title: 'Canonical' }, revision: 2 }, snapshot)).toBe(true); });
    const detached = rendered.current.getValues(); detached.title = 'Foreign mutation';
    expect(rendered.current.watch('title')).toBe('A'); expect(rendered.current.isDirty).toBe(true);
    expect(rendered.current.acceptValues({ values: { title: 'Twice' } }, snapshot)).toBe(false);
    await act(async () => rendered.current.reset()); expect(rendered.current.watch('title')).toBe('Canonical');
  });
  test('typed submission reports invalid, blocked and conflict outcomes instead of false success', async () => {
    const missing = await renderForm({ baseline: 'accepted' });
    expect(await missing.current.submit()).toEqual({ kind: 'blocked' });
    let writes = 0;
    const rendered = await renderForm({ baseline: 'accepted', onSubmit: async () => { writes++; throw { code: 'REVISION_CONFLICT', private: 'do-not-log' }; } });
    await act(async () => rendered.current.setValue('title', ''));
    let result!: Awaited<ReturnType<typeof rendered.current.submit>>;
    await act(async () => { result = await rendered.current.submit(); }); expect(result.kind).toBe('invalid');
    await act(async () => { rendered.current.setValue('title', 'Valid'); result = await rendered.current.submit(); });
    expect(result.kind).toBe('failed'); expect(rendered.current.hasConflict).toBe(true);
    expect(rendered.current.watch('title')).toBe('Valid'); expect(rendered.current.submitError).toContain('draft is preserved');
    await act(async () => { rendered.current.setValue('title', 'Another draft'); result = await rendered.current.submit(); });
    expect(result.kind).toBe('failed'); expect(writes).toBe(1);
    // A conflict is not silently re-based just because the user edits or retries.
    const reviewed = rendered.current.captureValues();
    await act(async () => { rendered.current.acceptValues({ values: { title: 'Reviewed' }, revision: 2 }, reviewed); });
    expect(rendered.current.hasConflict).toBe(false); expect(rendered.current.revision).toBe(2);
    expect(JSON.stringify(events)).not.toContain('do-not-log');
  });
  test('legacy mode retains its initial reset baseline after successful submission', async () => {
    const rendered = await renderForm({ onSubmit: async () => {} });
    await act(async () => { rendered.current.setValue('title', 'Updated'); await rendered.current.handleSubmit(); });
    expect(rendered.current.isDirty).toBe(true);
    await act(async () => rendered.current.reset()); expect(rendered.current.watch('title')).toBe('A title');
  });
  test('waits for the insert receipt before success and clearing submitting state', async () => {
    const receipt = deferred<void>();
    const calls: string[] = [];
    const collection = {
      insertAsync: () => {
        calls.push('insertAsync');
        return receipt.promise;
      },
    } as unknown as Collection<FormRow>;
    const successes: string[] = [];
    const rendered = await renderForm({
      collection,
      onSuccess: () => successes.push('success'),
    });

    let submission!: Promise<void>;
    await act(async () => {
      submission = rendered.current.handleSubmit();
      await Promise.resolve();
    });

    expect(calls).toEqual(['insertAsync']);
    expect(successes).toEqual([]);
    expect(rendered.current.isSubmitting).toBe(true);

    await act(async () => {
      receipt.resolve();
      await submission;
    });

    expect(successes).toEqual(['success']);
    expect(rendered.current.isSubmitting).toBe(false);
  });

  test('waits for update receipts and routes receipt rejection to onError', async () => {
    const receipt = deferred<void>();
    const updates: Array<{ id: string; partial: Partial<FormRow> }> = [];
    const collection = {
      getAll: () => ({ 'row-1': { id: 'row-1', title: 'A title' } }),
      updateAsync: (id: string, partial: Partial<FormRow>) => {
        updates.push({ id, partial });
        return receipt.promise;
      },
    } as unknown as Collection<FormRow>;
    const successes: string[] = [];
    const errors: string[] = [];
    const rendered = await renderForm({
      collection,
      mode: 'edit',
      editId: 'row-1',
      onSuccess: () => successes.push('success'),
      onError: (error) => errors.push(error),
    });

    let submission!: Promise<void>;
    await act(async () => {
      submission = rendered.current.handleSubmit();
      await Promise.resolve();
    });

    expect(updates).toEqual([{ id: 'row-1', partial: { title: 'A title' } }]);
    expect(rendered.current.isSubmitting).toBe(true);

    await act(async () => {
      receipt.reject(new Error('server rejected mutation'));
      await submission;
    });

    expect(successes).toEqual([]);
    expect(errors).toEqual(['server rejected mutation']);
    expect(rendered.current.isSubmitting).toBe(false);
  });

  test('same-render rapid submits only issue one collection mutation', async () => {
    const receipt = deferred<void>();
    let inserts = 0;
    const collection = {
      insertAsync: () => {
        inserts += 1;
        return receipt.promise;
      },
    } as unknown as Collection<FormRow>;
    const rendered = await renderForm({ collection });

    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      first = rendered.current.handleSubmit();
      second = rendered.current.handleSubmit();
      await Promise.resolve();
    });

    expect(inserts).toBe(1);
    expect(rendered.current.isSubmitting).toBe(true);

    await act(async () => {
      receipt.resolve();
      await Promise.all([first, second]);
    });
    expect(rendered.current.isSubmitting).toBe(false);
  });

  test('a failed accepted-success notification is not reported as a failed write', async () => {
    let inserts = 0;
    const collection = { insertAsync: async () => { inserts += 1; } } as unknown as Collection<FormRow>;
    const errors: string[] = [];
    const rendered = await renderForm({
      collection,
      onSuccess: () => { throw new Error('private notification contents'); },
      onError: (message) => errors.push(message),
    });
    await act(async () => { await rendered.current.handleSubmit(); });
    expect(inserts).toBe(1);
    expect(errors).toEqual([]);
    expect(rendered.current.isSubmitting).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0]?.code).toBe('frontend.mutation.failed');
    expect(events[0]?.metadata).toEqual({ surface: 'use-form', stage: 'accepted-callback' });
    expect(JSON.stringify(events)).not.toContain('private notification contents');
  });

  test('an async accepted notification finishing in an old scope cannot affect the new form', async () => {
    const notification = deferred<void>();
    const nextReceipt = deferred<void>();
    let inserts = 0;
    let notifications = 0;
    const collection = { insertAsync: () => ++inserts === 1 ? Promise.resolve() : nextReceipt.promise } as unknown as Collection<FormRow>;
    const errors: string[] = [];
    const scopeClient = createScopeClient();
    const rendered = await renderForm({
      collection, client: scopeClient.value,
      onSuccess: () => ++notifications === 1 ? notification.promise : undefined,
      onError: (message) => errors.push(message),
    });
    let previous!: Promise<void>;
    await act(async () => { previous = rendered.current.handleSubmit(); await Promise.resolve(); });
    expect(notifications).toBe(1);
    expect(rendered.current.isSubmitting).toBe(true);
    await act(async () => scopeClient.replaceScope());
    let replacement!: Promise<void>;
    await act(async () => { replacement = rendered.current.handleSubmit(); await Promise.resolve(); });
    await act(async () => { notification.reject(new Error('obsolete notification contents')); await previous; });
    expect(rendered.current.isSubmitting).toBe(true);
    expect(errors).toEqual([]);
    expect(events).toEqual([]);
    await act(async () => { nextReceipt.resolve(); await replacement; });
    expect(rendered.current.isSubmitting).toBe(false);
    expect(inserts).toBe(2);
  });

  test('stale receipt cannot call callbacks or clear a replacement scope submission', async () => {
    const oldReceipt = deferred<void>();
    const newReceipt = deferred<void>();
    const receipts = [oldReceipt, newReceipt];
    let inserts = 0;
    const collection = {
      insertAsync: () => receipts[inserts++]!.promise,
    } as unknown as Collection<FormRow>;
    const successes: string[] = [];
    const errors: string[] = [];
    const scopeClient = createScopeClient();
    const rendered = await renderForm({
      collection,
      client: scopeClient.value,
      onSuccess: () => successes.push('success'),
      onError: (error) => errors.push(error),
    });

    let oldSubmission!: Promise<void>;
    await act(async () => {
      oldSubmission = rendered.current.handleSubmit();
      await Promise.resolve();
    });
    expect(rendered.current.isSubmitting).toBe(true);

    await act(async () => scopeClient.replaceScope());
    expect(rendered.current.isSubmitting).toBe(false);

    let newSubmission!: Promise<void>;
    await act(async () => {
      newSubmission = rendered.current.handleSubmit();
      await Promise.resolve();
    });
    expect(inserts).toBe(2);
    expect(rendered.current.isSubmitting).toBe(true);

    await act(async () => {
      oldReceipt.reject(new Error('old scope rejection'));
      await oldSubmission;
    });

    expect(successes).toEqual([]);
    expect(errors).toEqual([]);
    expect(rendered.current.isSubmitting).toBe(true);

    await act(async () => {
      newReceipt.resolve();
      await newSubmission;
    });
    expect(successes).toEqual(['success']);
    expect(errors).toEqual([]);
    expect(rendered.current.isSubmitting).toBe(false);
  });
});

interface RenderFormOptions {
  collection?: Collection<FormRow>;
  mode?: 'create' | 'edit';
  editId?: string;
  onSuccess?: () => void;
  onError?: (error: string) => void;
  client?: Client;
  baseline?: UseFormOptions<FormRow>['baseline'];
  initialRevision?: number;
  onSubmit?: UseFormOptions<FormRow>['onSubmit'];
  recordIdentity?: string | number;
  scopeKey?: string | number;
  source?: FormRecordSnapshot<FormRow>;
  withSave?: boolean;
}
async function renderForm(options: RenderFormOptions): Promise<{ current: ReturnType<typeof useForm<FormRow>>;
  readonly save: UseFormSaveReturn | undefined; update(next: Partial<RenderFormOptions>): Promise<void> }> {
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(createContainer());
  activeRoots.add(root);
  let current!: ReturnType<typeof useForm<FormRow>>;
  let save: UseFormSaveReturn | undefined;

  function Capture(): ReactNode {
    current = useForm<FormRow>({
      schema,
      defaultValues: { id: 'row-1', title: 'A title' },
      collection: options.collection,
      mode: options.mode,
      editId: options.editId,
      onSuccess: options.onSuccess,
      onError: options.onError,
      onSubmit: options.onSubmit,
      baseline: options.baseline,
      initialRevision: options.initialRevision,
      recordIdentity: options.recordIdentity,
      scopeKey: options.scopeKey,
    });
    return createElement(Fragment, null,
      options.source ? createElement(Source, { record: { ...options.source }, form: current }) : null,
      options.withSave ? createElement(Save, { form: current }) : null);
  }

  function Source({ record, form }: { record: FormRecordSnapshot<FormRow>; form: ReturnType<typeof useForm<FormRow>> }): ReactNode {
    useReactiveFormRecord({ form, record }); return null;
  }
  function Save({ form }: { form: ReturnType<typeof useForm<FormRow>> }): ReactNode {
    save = useFormSave({ form, guardNavigation: false, beforeUnload: false }); return null;
  }

  const element = () => options.client ? createElement(ClientProvider, { client: options.client, children: createElement(Capture) }) : createElement(Capture);

  await act(async () => root.render(options.client
    ? createElement(ClientProvider, {
        client: options.client,
        children: createElement(Capture),
      })
    : createElement(Capture)));
  return { get current() { return current; }, get save() { return save; }, async update(next) { Object.assign(options, next); await act(async () => root.render(element())); } };
}

function createScopeClient(): { value: Client; replaceScope(): void } {
  let authState = {
    authorizationScopeKey: 'scope-a',
    user: { userId: 'user-a' },
    activeTenant: { tenantId: 'tenant-a' },
    isLoading: false,
    isAuthenticated: true,
    isRestoring: false,
    authorizationState: { status: 'ready' },
    sessionTransition: {
      phase: 'idle',
      operation: null,
      revision: 0,
      recoverable: false,
      error: null,
    },
  };
  const listeners = new Set<() => void>();
  const auth = {
    ...authState,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeAuthorization: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as AuthClient;

  function replaceScope() {
    authState = {
      ...authState,
      authorizationScopeKey: 'scope-b',
      user: { userId: 'user-b' },
      activeTenant: { tenantId: 'tenant-b' },
    };
    Object.assign(auth, authState);
    for (const listener of listeners) listener();
  }

  return {
    value: { auth } as unknown as Client,
    replaceScope,
  };
}

function createContainer(): Element {
  const document = globalThis.document as unknown as Record<string, unknown>;
  return {
    nodeType: 1,
    nodeName: 'DIV',
    tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    ownerDocument: document,
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    removeChild() {},
    textContent: '',
    firstChild: null,
  } as unknown as Element;
}

function installMinimalDom(): () => void {
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const previous = new Map<string, PropertyDescriptor | undefined>(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  class HTMLIFrameElement {}
  const window = { HTMLIFrameElement, document: null as unknown };
  const document = {
    nodeType: 9,
    defaultView: window,
    activeElement: null,
    body: null,
    addEventListener() {},
    removeEventListener() {},
  };
  window.document = document;
  Object.defineProperties(globalThis, {
    window: { configurable: true, writable: true, value: window },
    document: { configurable: true, writable: true, value: document },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, writable: true, value: true },
  });

  return () => {
    for (const key of keys) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value?: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value?: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = value => resolvePromise(value as T);
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
