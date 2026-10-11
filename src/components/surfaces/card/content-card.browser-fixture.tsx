/** Synthetic Card compositions and existing-manager quick-look integration; no application, services or remote assets. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { ContentCard } from './content-card';
import { Card, CardHeader, CardTitle, CardAction, CardDescription } from './card';
import { ModalManager } from '../../../modals/modal-manager';
import { modalStore } from '../../../modals/modal-store';
import { modals } from '../../../modals/modal-events';
import type { ModalContext } from '../../../modals/modal-system.types';
import { configureFrontendObservability, type FrontendObservabilityEvent } from '../../../frontend/client/observability';

type Config = { title: string; description: string; meta: string; status: string; version: number;
  identity: string; visible: boolean; details: boolean; controlled: boolean; open: boolean; media: boolean; rich: boolean; throwNotification: boolean; rejectNotification: boolean };
const initial: Config = { title: 'Synthetic record', description: 'Compact supporting copy', meta: 'Source metadata',
  status: 'Live updates connected', version: 1, identity: 'record-a', visible: true, details: true, controlled: false, open: false, media: true, rich: false, throwNotification: false, rejectNotification: false };
const notifications: boolean[] = [], admitted: string[] = [];
const events: FrontendObservabilityEvent[] = [];
configureFrontendObservability({ sink: { emit(event) { events.push(event); } } });
let configure!: (config: Partial<Config>) => void;
let firstContext: ModalContext | undefined, currentContext: ModalContext | undefined;
const refs = { article: null as HTMLElement | null, articleMounts: 0, status: null as HTMLSpanElement | null };
const calls = { actions: 0, pointerEnter: 0, pointerLeave: 0, previewMounts: 0, detailsMounts: 0 };
const root = document.getElementById('root')!;
modalStore.subscribe(snapshot => {
  for (const modal of snapshot.context.modals) if (modal.descriptor?.dataSlot === 'content-card-quick-look' && !admitted.includes(modal.id)) admitted.push(modal.id);
});

function Preview() {
  React.useEffect(() => { calls.previewMounts++; }, []);
  return <form id="preview-form" data-testid="preview-form" onSubmit={event => event.preventDefault()}>
    <label>Preview draft<input id="preview-draft" name="preview" aria-label="Preview draft" defaultValue="Preview state" /></label>
  </form>;
}
function DetailsBody({ context, version }: { context: ModalContext; version: number }) {
  currentContext = context; firstContext ??= context;
  React.useEffect(() => { calls.detailsMounts++; }, []);
  return <div data-testid="details-body"><p data-testid="body-version">Body revision {version}</p>
    <label>Quick-look draft<input id="quick-look-draft" aria-label="Quick-look draft" name="draft" defaultValue="Initial draft" /></label>
    <button type="button" onClick={event => context.show({ title: 'Owned quick-look child', trigger: event.currentTarget,
      guard: false, body: <input aria-label="Child draft" defaultValue="Child state" /> })}>Open owned child</button>
  </div>;
}
function Fixture() {
  const [config, setConfig] = React.useState<Config>(() => ({ ...initial,
    controlled: root.dataset.mode === 'controlled', open: root.dataset.mode === 'controlled',
  }));
  configure = next => setConfig(previous => ({ ...previous, ...next }));
  const articleRef = React.useCallback((element: HTMLElement | null) => { refs.article = element; if (element) refs.articleMounts++; }, []);
  const cardProps = { title: config.title,
    description: config.rich ? <input id="preview-description" aria-label="Preview description control" defaultValue="Description native state" /> : config.description,
    meta: config.rich ? <input id="preview-meta" aria-label="Preview metadata control" defaultValue="Metadata native state" /> : config.meta, status: config.status,
    identity: config.identity, details: config.details ? (context: ModalContext) => <DetailsBody context={context} version={config.version} /> : undefined };
  return <ModalManager recedeSurface={false}>
    <main data-zero-theme="next" className="p-8" style={{ '--zero-theme-font-body': 'sans-serif' } as React.CSSProperties}>
      <div className="grid max-w-xl gap-6">
        {config.visible && <ContentCard {...cardProps} ref={articleRef} data-testid="content-card"
          htmlTitle="Native article title" defaultOpen={root.dataset.mode === 'default'}
          open={config.controlled ? config.open : undefined} onOpenChange={open => { notifications.push(open);
            if (!open && config.throwNotification) throw new Error('PRIVATE_CARD_NOTIFICATION_DETAIL');
            if (!open && config.rejectNotification) return Promise.reject(new Error('PRIVATE_CARD_NOTIFICATION_DETAIL')); }}
          style={{ transform: 'translateX(4px)' }}
          media={config.media ? <span id="preview-media" data-testid="media-content" style={{ display: 'block', padding: 24 }}>Synthetic media</span> : undefined}
          avatar={<span id="preview-avatar">AB</span>} action={<button type="button" onClick={() => { calls.actions++; }}>Preview action</button>}
          onPointerEnter={() => { calls.pointerEnter++; }} onPointerLeave={() => { calls.pointerLeave++; }}>
          <Preview />
        </ContentCard>}
        <Card data-testid="native-card"><CardHeader><CardTitle asChild><h2>Native composition</h2></CardTitle>
          <CardDescription>Original padding unless requested</CardDescription><CardAction><button type="button">Native action</button></CardAction></CardHeader></Card>
      </div>
      <button data-testid="outside" type="button">Outside card</button>
      <button type="button" onClick={event => modals.show({ title: 'Unrelated owner', trigger: event.currentTarget, guard: false, body: 'Not card-owned' })}>Open unrelated</button>
      <button type="button" onClick={event => modals.show({ title: 'Parent card owner', trigger: event.currentTarget, guard: false,
        body: <ContentCard title="Nested record" description="Nested card" details={context => <DetailsBody context={context} version={1} />} /> })}>Open parent owner</button>
    </main>
  </ModalManager>;
}
Object.assign(window, { __cards: {
  configure: (config: Partial<Config>) => configure(config), notifications: () => [...notifications], admitted: () => [...admitted],
  events: () => [...events],
  calls: () => ({ ...calls }), refs: () => ({ articleMatches: refs.article === document.querySelector('[data-testid="content-card"]'), articleMounts: refs.articleMounts }),
  state: () => {
    const state = modalStore.getSnapshot().context;
    return state.modals.map(modal => ({ id: modal.id, title: modal.title, parentId: modal.parentId,
      generation: modal.generation, closing: state.closingIds.includes(modal.id), busy: modal.systemState?.busy,
      quickLook: modal.descriptor?.dataSlot === 'content-card-quick-look',
      triggerIsArticle: modal.descriptor?.trigger === refs.article, signalAborted: modals.getContext(modal.id)?.signal.aborted }));
  },
  context: () => ({ same: firstContext === currentContext, sameSignal: firstContext?.signal === currentContext?.signal, aborted: firstContext?.signal.aborted }),
  dirty: () => currentContext?.setDirty(true),
  close: () => currentContext?.requestClose('close-button'),
  staleProjection: () => { if (firstContext) modals.projectPresentation(firstContext.id, firstContext.signal, { title: 'Stale quick-look write' }); },
  unmount: () => { configure({ visible: false }); },
} });
createRoot(root).render(<React.StrictMode><Fixture /></React.StrictMode>);
