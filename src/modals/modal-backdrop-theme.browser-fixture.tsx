/** Synthetic scoped backdrop/stack fixture; no app config, services, persistence or external fonts. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { ModalManager } from './modal-manager';
import { modals } from './modal-events';
import type { ModalContext, ModalHandle } from './modal-system.types';

declare global {
  interface Window {
    __modalBackdropTheme: {
      closeParent(): void;
      reopen(): void;
      programmatic(): void;
    };
  }
}
let parent: ModalHandle<string> | undefined;
function ParentBody({ context }: { context: ModalContext<string> }) {
  return <div><input aria-label="Parent draft" defaultValue="Retained draft" />
    <button type="button" data-testid="child-trigger"
      style={{ '--zero-modal-backdrop-color': 'rgb(70 80 90 / .8)' } as React.CSSProperties}
      onClick={event => context.show({ title: 'Scoped child', trigger: event.currentTarget, guard: false,
        body: <input aria-label="Child draft" defaultValue="Child value" /> })}>Open scoped child</button></div>;
}
function openParent(trigger?: Element | null) {
  parent = modals.show<string>({ title: 'Scoped parent', trigger, guard: false,
    body: context => <ParentBody context={context} /> });
}
function Demo() {
  React.useLayoutEffect(() => {
    window.__modalBackdropTheme = {
      closeParent: () => { parent?.close('done'); },
      reopen: () => {
        parent?.close('done');
        modals.show({ title: 'Fresh owner', trigger: document.querySelector('[data-testid="fresh-trigger"]'), guard: false,
          body: <input aria-label="Fresh draft" defaultValue="Fresh value" /> });
      },
      programmatic: () => openParent(),
    };
  }, []);
  return <ModalManager portalContainer={document.getElementById('backdrop-portals')}>
    <main style={{ padding: 24, minHeight: 600 }}>
      <section data-testid="primary-source" style={{ '--zero-modal-backdrop-color': 'rgb(10 20 30 / .9)',
        '--zero-modal-motion-backdrop-out': '800ms' } as React.CSSProperties}>
        <button type="button" data-testid="primary-trigger" onClick={event => openParent(event.currentTarget)}>Open scoped parent</button>
      </section>
      <section style={{ '--zero-modal-backdrop-color': 'rgb(100 110 120 / .7)',
        '--zero-modal-motion-backdrop-out': '800ms' } as React.CSSProperties}>
        <button type="button" data-testid="fresh-trigger">Fresh source</button>
      </section>
    </main>
  </ModalManager>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Demo /></React.StrictMode>);
