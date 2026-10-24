/** Frozen original modal shell/skin/legacy theme and additive option admission; no application is started. */
import { expect, test, afterEach } from 'bun:test';
import { modals } from './modal-events';
import { modalStore } from './modal-store';
import type { ModalDescriptor } from './modal-system.types';

const root = new URL('../../', import.meta.url);
const originals = {
  'src/modals/modal-shell.tsx': '08c87f4fadfdd31eb0b1c8f8554acf2aad1071855ec1c1f736d1497fb87251f9',
  'src/modals/modal-shell.css': 'c11d71c03295ace5a48549fbf98a15114099f261e92358cd5ec8af934ee1ad1f',
  'src/components/_internal/scroll-viewport/scroll-viewport.css': '8fb6b6ed8845afd8547a70dc08bc6bed4e6444de77f8d6c08cacadd9e3e992e5',
  'src/frontend/styles/globals.css': '1c1669a61ea3a1cc22f91d3621b95822a814d7af15a050ec90ff33703b511ce5',
};
// Shared ScrollArea/helpers and the next supplement were intentionally updated
// for table edge chaining/hidden-axis fades and picker trigger polish (Oct 13).
// Their behavior and installed/source identity are qualified separately; the
// original modal owner, original scrollbar skin and legacy theme stay frozen.
// The globals baseline includes the already-shipped messaging/email and shared
// component imports on main; drawer adoption must not alter that approved file.

afterEach(() => modals.discardAll());

test('modal scroll adoption keeps every original shell/skin/legacy-theme byte until approved retirement', async () => {
  for (const [path, hash] of Object.entries(originals)) {
    expect(new Bun.CryptoHasher('sha256').update(await Bun.file(new URL(path, root)).arrayBuffer()).digest('hex'), path).toBe(hash);
  }
});

test('arc and original native scroll choices are admitted without changing modal allocation or results', async () => {
  for (const scrollTreatment of ['arc', 'native'] as const) {
    const modal = modals.show({ title: 'Scroll choice', scrollTreatment, scrollbar: 'hidden', navScrollbar: 'thin' });
    expect(modalStore.getSnapshot().context.modals.find(item => item.id === modal.id)?.descriptor?.scrollTreatment).toBe(scrollTreatment);
    expect(modal.close('done')).toBe(true);
    expect(await modal.result).toEqual({ kind: 'accepted', value: 'done' });
    modals.discardAll();
  }
  expect(() => modals.show({ title: 'Invalid', scrollTreatment: 'unknown' } as unknown as ModalDescriptor)).toThrow('Unsupported modal scrollTreatment');
  expect(modalStore.getSnapshot().context.modals).toHaveLength(0);
});
