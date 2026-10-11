/** Synthetic scroll-surface qualification; no app configuration, client, live records or authority. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { ModalManager } from './modal-manager';
import { modals } from './modal-events';
import type { ModalDescriptor } from './modal-system.types';
import { ScrollViewportDecorationNext } from '../components/_internal/scroll-viewport/scroll-viewport-decoration-next';

interface RawOptions {
  mounted: boolean;
  revision: number;
  rtl: boolean;
  scaleX: number;
  scaleY: number;
  snap: boolean;
  scrollbars: 'hover' | 'scroll' | 'always' | 'hidden';
  wheelMode: 'native' | 'horizontal';
  orientation: 'vertical' | 'horizontal' | 'both';
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
}
declare global {
  interface Window {
    __modalScroll: {
      configure(options: Partial<RawOptions>): void;
      native(): HTMLDivElement | null;
      retired(): HTMLDivElement | null;
      clear(): void;
      parentWheels(): number;
    };
  }
}
const overflowBody = (name: string) => <div data-testid={name} style={{ width: 940 }}>
  {Array.from({ length: 36 }, (_, index) => <p key={index} style={{ height: 37, margin: 0, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
    <span>{name} row {index + 1}</span><span>Synthetic detail {index + 1}</span><span>Record {index + 1}</span><span>Bounded content</span>
  </p>)}
</div>;

function Fixture() {
  const [raw, setRaw] = React.useState<RawOptions>({ mounted: true, revision: 0, rtl: false, scaleX: 1, scaleY: 1,
    snap: false, scrollbars: 'always', wheelMode: 'native', orientation: 'both', width: 1000, height: 1200, viewportWidth: 320, viewportHeight: 190 });
  const [viewport, setViewport] = React.useState<HTMLDivElement | null>(null);
  const viewportRef = React.useRef<HTMLDivElement | null>(null), retired = React.useRef<HTMLDivElement | null>(null);
  const parentWheels = React.useRef(0);
  const register = React.useCallback((element: HTMLDivElement | null) => {
    viewportRef.current = element; setViewport(element);
    if (element) {
      element.style.setProperty('--zero-scroll-edge-top', '7px');
      element.setAttribute('data-zero-scroll-fade', 'owner-sentinel');
    }
  }, []);
  React.useLayoutEffect(() => {
    if (viewport && raw.snap) viewport.style.setProperty('scroll-snap-type', 'y mandatory', 'important');
    else viewport?.style.removeProperty('scroll-snap-type');
  }, [viewport, raw.snap]);
  React.useLayoutEffect(() => {
    window.__modalScroll = {
      configure(options) {
        if (options.mounted === false || options.revision !== undefined) retired.current = viewportRef.current;
        setRaw(previous => ({ ...previous, ...options }));
      },
      native: () => viewportRef.current,
      retired: () => retired.current,
      clear: () => modals.discardAll(),
      parentWheels: () => parentWheels.current,
    };
  });
  const show = (title: string, extra: Partial<ModalDescriptor> = {}) => modals.show({
    title, height: 'fixed', customSize: { width: '480px', height: '440px' }, body: overflowBody('overflow'),
    footer: { start: 'Fixed footer remains legible.' }, actions: [{ id: 'done', label: 'Done', value: true }],
    motion: { pageRecedes: false }, ...extra,
  } as ModalDescriptor);
  const section = (id: string, label: string) => ({ id, label, body: overflowBody(id) });
  return <ModalManager><main style={{ padding: 24 }}>
    <h1>Modal scroll treatment fixture</h1>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      <button onClick={() => show('Overflow')}>Open overflow</button>
      <button onClick={() => show('Fitting', { body: <p>Short content.</p> })}>Open fitting</button>
      <button onClick={() => show('Hidden rails', { scrollbar: 'hidden' })}>Open hidden rails</button>
      <button onClick={() => show('Thin rails', { scrollbar: 'thin' })}>Open thin rails</button>
      <button onClick={() => show('Native scroll', { scrollTreatment: 'native', scrollbar: 'thin' })}>Open native scroll</button>
      <button onClick={() => show('Retained tabs', { body: undefined, layout: 'tabs', sections: [section('alpha', 'Alpha'), section('beta', 'Beta')] })}>Open retained tabs</button>
      <button onClick={() => show('Independent navigation', { body: undefined, layout: 'nav', size: 'lg', customSize: { width: '740px', height: '440px' },
        sections: Array.from({ length: 24 }, (_, index) => ({ ...section('nav-' + index, 'Section ' + (index + 1)), group: index < 12 ? 'Account' : 'Workspace' })) })}>Open independent navigation</button>
    </div>
    <div data-testid="raw-parent" onWheel={() => { parentWheels.current++; }} style={{ marginTop: 28 }}>
      <div data-testid="raw-frame" style={{ position: 'relative', width: raw.viewportWidth, height: raw.viewportHeight, transformOrigin: 'top left', transform: `scale(${raw.scaleX}, ${raw.scaleY})` }}>
        {raw.mounted && <div key={raw.revision} ref={register} data-testid="raw-viewport" dir={raw.rtl ? 'rtl' : 'ltr'}
          style={{ overflow: 'auto', width: raw.viewportWidth, height: raw.viewportHeight, border: '2px solid currentColor' }} tabIndex={0}>
          <div data-testid="raw-content" style={{ width: raw.width, height: raw.height }}>
            {Array.from({ length: 12 }, (_, index) => <div key={index} style={{ height: 100, scrollSnapAlign: 'start' }}>Raw item {index + 1}</div>)}
          </div>
        </div>}
        <ScrollViewportDecorationNext viewport={viewport} orientation={raw.orientation} scrollbars={raw.scrollbars} wheelMode={raw.wheelMode} />
      </div>
    </div>
  </main></ModalManager>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
