/** SSR anatomy regression for next scroll adoption; no document, manager mount or application service. */
import { expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Dialog } from 'radix-ui';
import { ModalShell } from './modal-shell';
import { ModalScrollShell } from './modal-scroll-shell';
import { resolveModalMotion } from './modal-motion';
import type { ModalContext, ModalDescriptor } from './modal-system.types';

const context: ModalContext = {
  id: 'ssr-scroll-fixture', signal: new AbortController().signal, accept: () => false, requestClose: async () => false,
  setError() {}, setBusy() {}, setDirty() {}, setActionDisabled() {}, show() { throw new Error('SSR must not admit a dialog.'); },
};
const state = { busy: false, dirty: false, error: null, actionId: null, disabledActions: {} } as const;
function markup(descriptor: ModalDescriptor, original = false) {
  const Shell = original ? ModalShell : ModalScrollShell;
  return renderToStaticMarkup(<Dialog.Root open><Shell descriptor={descriptor} context={context} state={state}
    motion={resolveModalMotion(null, {}, true)} innerRef={null} /></Dialog.Root>);
}
test('SSR content keeps one existing body and fixed header/footer without decorative scroll owners', () => {
  for (const scrollTreatment of ['arc', 'native'] as const) {
    const descriptor: ModalDescriptor = { title: 'Bounded content', description: 'Fixed description.', body: <p>Native content.</p>, scrollTreatment,
      scrollbar: 'hidden', footer: { start: 'Fixed note.' }, actions: [{ id: 'done', label: 'Done' }] };
    const html = markup(descriptor);
    // React's generated accessibility IDs differ between render roots, not anatomy.
    const normalized = (value: string) => value.replace(/_R_[^" ]*_/gu, 'SSR-ID');
    expect(normalized(html)).toBe(normalized(markup(descriptor, true)));
    expect(html.match(/class="zero-modal__body"/gu)).toHaveLength(1);
    expect(html.match(/data-slot="dialog-header"/gu)).toHaveLength(1);
    expect(html.match(/data-slot="modal-footer"/gu)).toHaveLength(1);
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain('data-scrollbar="hidden"');
    expect(html).not.toContain('data-radix-scroll-area-viewport');
    expect(html).not.toContain('zero-scroll-decoration');
    expect(html).not.toContain('mask-image');
  }
});
test('SSR retained panels remain native, separately identifiable and inactive content stays deferred', () => {
  const html = markup({ title: 'Retained sections', layout: 'nav', navScrollbar: 'thin', sections: [
    { id: 'alpha', label: 'Alpha', body: <p>First native panel.</p> }, { id: 'beta', label: 'Beta', body: <p>Deferred panel.</p> },
  ] });
  expect(html.match(/role="tabpanel"/gu)).toHaveLength(2);
  expect(html.match(/role="tablist"/gu)).toHaveLength(1);
  expect(html).toContain('First native panel.');
  expect(html).not.toContain('Deferred panel.');
  expect(html).toContain('data-scrollbar="thin"');
  expect(html).not.toContain('data-radix-scroll-area-viewport');
  expect(html).not.toContain('zero-scroll-decoration');
});
