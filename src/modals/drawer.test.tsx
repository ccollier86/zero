/** Shared-store drawer admission, guarded replacement, retirement and SSR without a browser or backend. */
import { afterEach, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DrawerWorkspace, ControlledDrawer, drawers } from '../drawers';
import { modals } from './modal-events';
import { modalStore } from './modal-store';

afterEach(() => modals.discardAll());

test('drawer defaults and outcomes use the exact existing modal owner', async () => {
  const handle = drawers.show<number>({ title: 'Inspector', body: 'Synthetic', reserveSpace: true });
  const instance = modalStore.getSnapshot().context.modals.find(item => item.id === handle.id)!;
  expect(instance.descriptor?.drawer).toMatchObject({ side: 'right', mode: 'modal', mobile: 'bottom-sheet' });
  expect(instance.descriptor?.motion?.pageRecedes).toBe(false);
  expect(handle.close(7)).toBe(true); expect(await handle.result).toEqual({ kind: 'accepted', value: 7 });
});
test('guarded replacement cannot bypass rejection, pending actions or retirement', async () => {
  const handle = drawers.show({ title: 'Original', beforeClose: () => false });
  expect(await handle.replace({ title: 'Denied' })).toBeNull();
  expect(modalStore.getSnapshot().context.modals.map(item => item.title)).toEqual(['Original']);
  let allow!: (value: boolean) => void;
  handle.update({ beforeClose: () => new Promise<boolean>(resolve => { allow = resolve; }) });
  const pending = handle.replace({ title: 'Stale' });
  modals.discardAll(); allow(true);
  expect(await pending).toBeNull(); expect(modalStore.getSnapshot().context.modals).toEqual([]);
});
test('successful replacement keeps drawer geometry while retiring original callbacks', async () => {
  const handle = drawers.show({ title: 'Original', side: 'left', width: '320px', beforeClose: () => true });
  const original = modals.getContext(handle.id)!;
  const replacement = await handle.replace({ title: 'Replacement' });
  expect(replacement).not.toBeNull(); expect(original.signal.aborted).toBe(true);
  expect(modalStore.getSnapshot().context.modals.find(item => item.id === replacement!.id)?.descriptor?.drawer)
    .toMatchObject({ side: 'left', width: '320px' });
  const child = modals.getContext(replacement!.id)!.show({ title: 'Nested decision' });
  modals.disposeHost([replacement!.id]);
  expect(await replacement!.result).toEqual({ kind: 'retired' }); expect(await child.result).toEqual({ kind: 'retired' });
});
test('invalid presentation never allocates a drawer and unrelated modals cannot be dismissed through the facade', async () => {
  expect(() => drawers.show({ title: 'Invalid', width: '2px; color:red' })).toThrow();
  expect(() => drawers.show({ title: 'Invalid', side: 'elsewhere' as 'left' })).toThrow();
  const dialog = modals.show({ title: 'Not a drawer' });
  expect(await drawers.dismiss(dialog.id)).toBe(false);
  expect(modals.getContext(dialog.id)?.signal.aborted).toBe(false);
});
test('workspace and controlled bridge server-render without portal or window creation', () => {
  const html = renderToStaticMarkup(<DrawerWorkspace><p>Canvas</p><ControlledDrawer open={false} descriptor={{ title: 'Closed' }} onOpenChange={() => { throw new Error('No SSR callbacks'); }} /></DrawerWorkspace>);
  expect(html).toContain('Canvas'); expect(html).toContain('drawer-workspace'); expect(html).not.toContain('role="dialog"');
});
