/** Controller/React adapter ownership tests; no server, database, or browser presentation. */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, createElement, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { defineSchema, field } from '../schema';
import { useForm, type UseFormReturn } from '../hooks/use-form';
import { useFormSave } from '../hooks/use-form-save';
import { ConfirmProvider, useConfirm } from '../hooks/use-confirm';
import { configureFrontendObservability } from '../frontend/client/observability';
import { ControlledModal, type ControlledModalProps } from './modal-controlled';
import { bindModalFormState, useModalForm } from './modal-form';
import { ModalHostContext } from './modal-host-context';
import { OverlayScopeProvider } from '../components/overlays/overlay-scope';
import { modals } from './modal-events';
import { modalStore } from './modal-store';
import type { ModalContext, ModalDescriptor } from './modal-system.types';

const roots = new Set<Root>();
let restore: () => void;
beforeEach(() => { restore = installMinimalDom(); configureFrontendObservability({ http: false, console: false }); modals.discardAll(); });
afterEach(async () => { for (const root of roots) await act(async () => root.unmount()); roots.clear(); modals.discardAll(); restore(); });

function context<T>() {
  const lifetime = new AbortController(), accepted: T[] = [];
  let actionPending = false;
  const state = { dirty: false, busy: false, error: null as string | null };
  const value = { id: 'fixture', signal: lifetime.signal, accept(result: T) { accepted.push(result); return true; },
    requestClose: async () => false, setDirty(value: boolean) { state.dirty = value; },
    setBusy(value: boolean) { state.busy = actionPending || value; }, setError(value: string | null) { state.error = value; },
    setActionDisabled() {}, show: modals.show } satisfies ModalContext<T>;
  return { value, state, accepted, lifetime, setActionPending(value: boolean) { actionPending = value; state.busy = value; } };
}

describe('modal form adapters', () => {
  test('retained forms aggregate dirty/busy/error and one cleanup cannot erase another owner', () => {
    const c = context<unknown>(), first = bindModalFormState(c.value), second = bindModalFormState(c.value);
    first.update({ dirty: true, busy: false, error: null }); second.update({ dirty: false, busy: true, error: 'Safe form error' });
    expect(c.state).toEqual({ dirty: true, busy: true, error: 'Safe form error' });
    first.dispose(); expect(c.state).toEqual({ dirty: false, busy: true, error: 'Safe form error' });
    c.setActionPending(true); second.dispose(); expect(c.state.busy).toBe(true);
    expect(c.state.dirty).toBe(false); expect(c.state.error).toBeNull();
    c.lifetime.abort(); second.update({ dirty: true, busy: true, error: 'Retired' }); expect(c.state.error).toBeNull();
  });
  test('an acknowledged clean save accepts canonical values and repeated native submit does not duplicate writes', async () => {
    const c = context<FormRow>(), receipt = deferred<{ values: Partial<FormRow>; revision: number }>(); let writes = 0;
    const rendered = await renderBoundForm(c.value, () => { writes++; return receipt.promise; });
    await act(async () => { rendered.form.setValue('title', 'Sent'); });
    let saving!: ReturnType<typeof rendered.binding.submit>;
    await act(async () => { saving = rendered.binding.submit(); expect((await rendered.binding.submit()).kind).toBe('blocked'); });
    expect(writes).toBe(1);
    await act(async () => { receipt.resolve({ values: { title: 'Canonical' }, revision: 2 }); await saving; });
    expect(c.accepted).toEqual([{ id: 'row', title: 'Canonical' }]); expect(rendered.form.revision).toBe(2);
  });
  test('newer edits or lifetime retirement prevent accepted receipts from closing the modal', async () => {
    const c = context<FormRow>(), receipt = deferred<{ values: Partial<FormRow>; revision: number }>();
    const rendered = await renderBoundForm(c.value, () => receipt.promise);
    let saving!: ReturnType<typeof rendered.binding.submit>;
    await act(async () => { rendered.form.setValue('title', 'Sent'); saving = rendered.binding.submit(); });
    await act(async () => { rendered.form.setValue('title', 'Newer'); });
    await act(async () => { receipt.resolve({ values: { title: 'Canonical' }, revision: 2 }); await saving; });
    expect(c.accepted).toEqual([]); expect(rendered.form.watch('title')).toBe('Newer');
    c.lifetime.abort(); expect(await rendered.binding.submit()).toEqual({ kind: 'retired' });
  });
  test('failed submissions return false through the action adapter and child submit stops event ancestry', async () => {
    const c = context<FormRow>(); let writes = 0;
    const rendered = await renderBoundForm(c.value, async () => { writes++; throw { code: 'REVISION_CONFLICT' }; });
    let prevented = 0, stopped = 0;
    await act(async () => { rendered.binding.onSubmit({ preventDefault() { prevented++; }, stopPropagation() { stopped++; } } as React.FormEvent); });
    expect(prevented).toBe(1); expect(stopped).toBe(1); expect(writes).toBe(1); expect(c.accepted).toEqual([]);
    await act(async () => { expect(await rendered.binding.action()).toBe(false); }); expect(writes).toBe(1);
  });
  test('retiring a real modal close decision cancels its prompt, not a separately admitted current form receipt', async () => {
    const handle = modals.show<FormRow>({ title: 'Owned form' }), owned = modals.getContext(handle.id)!;
    const receipt = deferred<{ values: Partial<FormRow>; revision: number }>();
    const rendered = await renderBoundForm(owned as unknown as ModalContext<FormRow>, () => receipt.promise);
    await act(async () => { rendered.form.setValue('title', 'Sent'); });
    let leaving!: Promise<boolean>;
    await act(async () => { leaving = modals.requestClose(handle.id, { reason: 'close-button' }); });
    expect(rendered.save.confirmationOpen).toBe(true);
    let saving!: Promise<void>;
    await act(async () => { saving = rendered.save.chooseLeave('save'); });
    await act(async () => { handle.update({ title: 'Replacement context' }); });
    expect(await leaving).toBe(false); expect(rendered.save.confirmationOpen).toBe(false);
    expect(owned.signal.aborted).toBe(true);
    await act(async () => { receipt.resolve({ values: { title: 'Canonical' }, revision: 2 }); await saving; });
    expect(rendered.form.watch('title')).toBe('Canonical'); expect(rendered.form.revision).toBe(2);
    expect(modalStore.getSnapshot().context.closingIds).not.toContain(handle.id);
    expect(modalStore.getSnapshot().context.modals[0]?.title).toBe('Replacement context');
  });
});

describe('ConfirmProvider managed single-slot ownership', () => {
  test('replacement/unmount/retained functions settle only their own requests', async () => {
    let confirm!: ReturnType<typeof useConfirm>;
    function Capture() { confirm = useConfirm(); return null; }
    const root = await render(createElement(ConfirmProvider, { children: createElement(Capture) }));
    const first = confirm({ title: 'First' }), second = confirm({ title: 'Second', variant: 'destructive' });
    expect(await first).toBe(false);
    const modal = modalStore.getSnapshot().context.modals.find(value => value.title === 'Second')!;
    expect(modal.descriptor?.initialFocus).toBe('cancel');
    await act(async () => { await modals.performAction(modal.id, 'confirm'); }); expect(await second).toBe(true);
    const last = confirm({ title: 'Pending' });
    await act(async () => root.unmount()); roots.delete(root);
    expect(await last).toBe(false); expect(await confirm({ title: 'Detached' })).toBe(false);
  });
  test('a confirmation called inside a modal belongs to that parent and a retained retired opener cannot replace a newer request', async () => {
    const parent = modals.show({ title: 'Parent' });
    let ownedConfirm!: ReturnType<typeof useConfirm>, globalConfirm!: ReturnType<typeof useConfirm>;
    function Owned() { ownedConfirm = useConfirm(); return null; }
    function Global() { globalConfirm = useConfirm(); return null; }
    await render(createElement(ConfirmProvider, { children: [createElement(Global, { key: 'global' }),
      createElement(OverlayScopeProvider, { key: 'scope', value: { id: parent.id, zIndex: 1000, active: true },
        children: createElement(Owned) })] }));
    const pending = ownedConfirm({ title: 'Owned confirmation' });
    expect(modalStore.getSnapshot().context.modals.at(-1)?.parentId).toBe(parent.id);
    modals.disposeHost([parent.id]); expect(await pending).toBe(false);
    const replacement = globalConfirm({ title: 'Global confirmation' });
    expect(await ownedConfirm({ title: 'Retired opener' })).toBe(false);
    const current = modalStore.getSnapshot().context.modals.at(-1)!;
    expect(current.title).toBe('Global confirmation');
    await act(async () => { await modals.performAction(current.id, 'confirm'); }); expect(await replacement).toBe(true);
  });
});

describe('ControlledModal bridge ownership', () => {
  test('body props update without retiring a context, while target identity updates retire the exact previous opening', async () => {
    let props: ControlledModalProps<string> = { open: true, identityKey: 'a', descriptor: { title: 'Fixture', body: 'Original' },
      onOpenChange() {} };
    function Capture() { return <ControlledModal<string> {...props} />; }
    const root = await render(createElement(Capture));
    const first = modalStore.getSnapshot().context.modals[0]!, owned = modals.getContext(first.id)!;
    props = { ...props, descriptor: { title: 'Fixture', body: 'Changed live' } };
    await act(async () => root.render(wrap(createElement(Capture))));
    const current = modalStore.getSnapshot().context.modals[0]!;
    expect(current.id).toBe(first.id); expect(current.generation).toBe(first.generation); expect(owned.signal.aborted).toBe(false);
    const body = (current.descriptor as ModalDescriptor<string>).body!;
    expect(renderToStaticMarkup(createElement('div', null, typeof body === 'function' ? body(owned as ModalContext<string>) : body))).toBe('<div>Changed live</div>');
    props = { ...props, identityKey: 'b', descriptor: { title: 'Other target', body: 'B' } };
    await act(async () => root.render(wrap(createElement(Capture))));
    expect(owned.signal.aborted).toBe(true); expect(modalStore.getSnapshot().context.modals.map(value => value.title)).toEqual(['Other target']);
  });
  test('live actions/footer retain the context and an admitted action retains its original writer', async () => {
    const receipt = deferred<string>(), calls: string[] = [];
    let props: ControlledModalProps<string> = { open: true, descriptor: { title: 'Create', footer: { start: 'Initial note' },
      actions: [{ id: 'save', label: 'Create', closes: false, onClick: () => { calls.push('first'); return receipt.promise; } }] }, onOpenChange() {} };
    function Capture() { return <ControlledModal<string> {...props} />; }
    const root = await render(createElement(Capture));
    const first = modalStore.getSnapshot().context.modals[0]!, owned = modals.getContext(first.id)!;
    let admitted!: Promise<boolean>;
    await act(async () => { admitted = modals.performAction(first.id, 'save'); });
    expect(calls).toEqual(['first']);
    props = { ...props, descriptor: { title: 'Retry', footer: { start: 'Created, notification needs retry' },
      actions: [{ id: 'stay', label: 'Stay', role: 'cancel' }, { id: 'save', label: 'Retry created notification', closes: false,
        onClick: () => { calls.push('second'); return 'retry'; } }] } };
    await act(async () => root.render(wrap(createElement(Capture))));
    const projected = modalStore.getSnapshot().context.modals[0]!;
    expect(projected.generation).toBe(first.generation); expect(modals.getContext(first.id)).toBe(owned);
    expect(projected.descriptor?.actions?.map(action => action.id)).toEqual(['stay', 'save']);
    expect(projected.descriptor?.actions?.[1]?.label).toBe('Retry created notification');
    expect(projected.descriptor?.footer?.start).toBe('Created, notification needs retry');
    await act(async () => { receipt.resolve('original'); expect(await admitted).toBe(false); });
    expect(calls).toEqual(['first']);
    await act(async () => { expect(await modals.performAction(first.id, 'save')).toBe(false); });
    expect(calls).toEqual(['first', 'second']);
  });
  test('a completed opening cannot replay when an owner ignores or throws its close notification', async () => {
    let writes = 0, closes = 0;
    let props: ControlledModalProps<unknown> = { open: true, identityKey: 'a', descriptor: { title: 'Save',
      actions: [{ id: 'save', label: 'Save', onClick: () => { writes++; } }] },
      onOpenChange() { closes++; throw new Error('Host notification failed'); } };
    function Capture() { return <ControlledModal {...props} />; }
    const root = await render(createElement(Capture));
    const first = modalStore.getSnapshot().context.modals[0]!;
    await act(async () => { expect(await modals.performAction(first.id, 'save')).toBe(true); });
    expect(writes).toBe(1); expect(closes).toBe(1);
    modals.completeExit(first.id, first.generation);
    props = { ...props, descriptor: { ...props.descriptor, title: 'Updated presentation' } };
    await act(async () => root.render(wrap(createElement(Capture))));
    expect(modalStore.getSnapshot().context.modals).toHaveLength(0);
    props = { ...props, open: false }; await act(async () => root.render(wrap(createElement(Capture))));
    props = { ...props, open: true }; await act(async () => root.render(wrap(createElement(Capture))));
    expect(modalStore.getSnapshot().context.modals).toHaveLength(1);
  });
});

type FormRow = { id: string; title: string };
const schema = defineSchema({ id: field.text({ required: true }), title: field.text({ required: true }) });
async function renderBoundForm(c: ModalContext<FormRow>, onSubmit: () => Promise<{ values: Partial<FormRow>; revision: number }>) {
  let form!: UseFormReturn<FormRow>, binding!: ReturnType<typeof useModalForm<FormRow>>, save!: ReturnType<typeof useFormSave>;
  function Capture() {
    form = useForm<FormRow>({ schema, defaultValues: { id: 'row', title: 'Initial' }, baseline: 'accepted', initialRevision: 1, onSubmit });
    save = useFormSave({ form, guardNavigation: false, beforeUnload: false });
    binding = useModalForm({ context: c, form, save }); return null;
  }
  await render(createElement(Capture)); return { get form() { return form; }, get binding() { return binding; }, get save() { return save; } };
}
function wrap(children: ReactNode) { return createElement(ModalHostContext.Provider, { value: true, children }); }
async function render(children: ReactNode) {
  const { createRoot } = await import('react-dom/client');
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', namespaceURI: 'http://www.w3.org/1999/xhtml',
    ownerDocument: document, addEventListener() {}, removeEventListener() {}, appendChild() {}, removeChild() {},
    textContent: '', firstChild: null } as unknown as Element;
  const root = createRoot(container); roots.add(root); await act(async () => root.render(wrap(children))); return root;
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function installMinimalDom() {
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  class HTMLIFrameElement {}
  const window = { HTMLIFrameElement, document: null as unknown }, document = { nodeType: 9, defaultView: window,
    activeElement: null, body: null, addEventListener() {}, removeEventListener() {} };
  window.document = document;
  Object.defineProperties(globalThis, { window: { configurable: true, value: window }, document: { configurable: true, value: document },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true } });
  return () => { for (const key of keys) { const descriptor = previous.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as Record<string, unknown>)[key]; } };
}
