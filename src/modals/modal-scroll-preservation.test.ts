/** Frozen originals and additive option admission; no browser, provider, database or application is started. */
import { expect, test, afterEach } from 'bun:test';
import { modals } from './modal-events';
import { modalStore } from './modal-store';
import type { ModalDescriptor } from './modal-system.types';

const root = new URL('../../', import.meta.url);
const originals = {
  'src/modals/modal-shell.tsx': '08c87f4fadfdd31eb0b1c8f8554acf2aad1071855ec1c1f736d1497fb87251f9',
  'src/modals/modal-shell.css': 'c11d71c03295ace5a48549fbf98a15114099f261e92358cd5ec8af934ee1ad1f',
  'src/components/_internal/scroll-viewport/use-scroll-viewport.ts': '2e39074bebfabba791c2eaf813e6694f1c4fbd87eb51efb3d1088e6abc7474b9',
  'src/components/_internal/scroll-viewport/scroll-viewport-decoration.tsx': '15800e18510ad468509952958ccbef18218f1fb5fee35d5c64fa6c28a98701a1',
  'src/components/_internal/scroll-viewport/scroll-viewport.css': '8fb6b6ed8845afd8547a70dc08bc6bed4e6444de77f8d6c08cacadd9e3e992e5',
  'src/components/_internal/scroll-viewport/scroll-viewport-metrics.ts': 'df7a9cb2897b33e1e40636a9cf621978dd87531f9919c2dfd79f191b936db1dd',
  'src/components/ui/scroll-area.tsx': 'd9f250e9224b5b2ff6595c36ba003f428eeeb02d6a2e0728151e6d63a396e15b',
  'src/frontend/styles/globals.css': 'af1682801435cc0ceef66a2a472099b7adc25e9e55b626ce56d1815a9e2a282d',
  'src/frontend/styles/theme-next.css': '6dd2c0e6f22046512bccab3592e30d0f60a93bcc05d1729e925fa4aad39874c8',
};

afterEach(() => modals.discardAll());

test('modal scroll adoption keeps every original shell/adapter/skin/theme byte until approved retirement', async () => {
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
