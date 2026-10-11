/** Synthetic native scroll and cmdk composition; no application, database or remote font boot. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { ScrollArea } from '../../ui/scroll-area';
import { Command, CommandInput, CommandList, CommandGroup, CommandItem } from '../../ui/command';
import { ScrollViewportDecoration } from './scroll-viewport-decoration';

type Configuration = { type: 'hover' | 'scroll' | 'always' | 'auto'; scale: number; rtl: boolean; mounted: boolean; contentHeight: number; headerHeight: number };
let configure!: (next: Partial<Configuration>) => void;
let raw: HTMLDivElement | null = null, native: HTMLDivElement | null = null;
let selected = '', refCleanups = 0;
function Fixture() {
  const [config, change] = React.useState<Configuration>({ type: 'hover', scale: 1, rtl: false, mounted: true, contentHeight: 60, headerHeight: 24 });
  configure = next => change(previous => ({ ...previous, ...next }));
  const [viewport, setViewport] = React.useState<HTMLDivElement | null>(null);
  const nativeRef = React.useCallback((element: HTMLDivElement | null) => { native = element; if (!element) refCleanups++; }, []);
  return <main data-zero-theme="next" style={{ padding: 30, display: 'flex', gap: 40, alignItems: 'flex-start' }}>
    <section data-testid="scaled" style={{ transform: `scale(${config.scale})`, transformOrigin: 'top left' }}>
      {config.mounted && <ScrollArea data-testid="area" type={config.type} dir={config.rtl ? 'rtl' : 'ltr'} orientation="both" viewportRef={nativeRef}
        style={{ width: 240, height: 160, border: '1px solid', '--zero-scroll-hide-delay': '30ms' } as React.CSSProperties}>
        <div style={{ width: 900, height: 2400 }}>{Array.from({ length: 30 }, (_, i) => <div key={i} style={{ height: 80 }}>Row {i + 1}</div>)}</div>
      </ScrollArea>}
    </section>
    <Command label="Synthetic choices" data-testid="command" style={{ width: 240, height: 'auto' }}>
      <CommandInput aria-label="Search choices" />
      <CommandList data-testid="choices" style={{ maxHeight: 130 }}>
        <CommandGroup heading="Options">{Array.from({ length: 30 }, (_, i) => <CommandItem key={i} value={`Option ${i + 1}`} disabled={i === 1}
          onSelect={value => { selected = value; }}>Option {i + 1}</CommandItem>)}</CommandGroup>
      </CommandList>
      <footer data-testid="command-footer">Fixed footer</footer>
    </Command>
    <section data-testid="raw-frame" style={{ position: 'relative', width: 240 }}>
      <header data-testid="raw-header" style={{ height: config.headerHeight }}>Header</header>
      <div data-testid="raw" tabIndex={0} ref={element => { raw = element; setViewport(element); }} style={{ width: 240, height: 120, overflow: 'auto' }}>
        <div style={{ height: 60 }}>First child</div><div data-testid="later-child" style={{ height: config.contentHeight }}>Later child</div>
      </div>
      <ScrollViewportDecoration viewport={viewport} scrollbars="always" />
    </section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
Object.assign(window, { __menuScroll: { configure: (next: Partial<Configuration>) => configure(next),
  native: () => native, raw: () => raw, selected: () => selected, refCleanups: () => refCleanups } });
