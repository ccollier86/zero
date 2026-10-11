/** Independent paint/viewport lifecycle qualification using synthetic owners only. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { MenuActiveHighlight } from './menu-active-highlight';
import { ScrollViewportDecoration } from '../scroll-viewport/scroll-viewport-decoration';

type Settings = { count: number; duration: string; mounted: boolean; scrollbars: 'hidden' | 'always'; inert: boolean };
const controls = new Map<string, (next: Partial<Settings>) => void>();
function Example({ id }: { id: string }) {
  const [settings, setSettings] = React.useState<Settings>({ count: 5, duration: '280ms', mounted: true, scrollbars: 'always', inert: false });
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
  controls.set(id, next => setSettings(previous => ({ ...previous, ...next })));
  return <section data-testid={`${id}-frame`} style={{ position: 'relative', width: 220 }}>
    {settings.mounted && <div ref={setContainer} data-testid={id} inert={settings.inert}
      style={{ position: 'relative', height: 110, width: 220, overflow: 'auto', '--zero-menu-highlight-duration': settings.duration } as React.CSSProperties}>
      {Array.from({ length: settings.count }, (_, index) => <button key={index} type="button" role="option" disabled={index === 1}
        data-testid={`${id}-${index}`} style={{ display: 'block', width: '100%', height: 36, border: 0, background: 'transparent' }}>Option {index}</button>)}
    </div>}
    <MenuActiveHighlight container={container} activeSelector='[data-active="true"]' hoverSelector='[role="option"]' preserveSelectionFill={false} />
    <ScrollViewportDecoration viewport={container} scrollbars={settings.scrollbars} />
  </section>;
}
createRoot(document.getElementById('root')!).render(<main data-zero-theme="next" style={{ display: 'flex', gap: 40, padding: 30 }}><Example id="left" /><Example id="right" /></main>);
Object.assign(window, { __highlightReview: { configure: (id: string, next: Partial<Settings>) => controls.get(id)?.(next) } });
