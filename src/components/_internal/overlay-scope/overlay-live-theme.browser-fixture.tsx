/** Synthetic owned popovers and iframe realms for live presentation-theme qualification; no app or data service boots. */
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Popover, PopoverContent, PopoverTrigger } from '../../surfaces/popover/popover';
import { OverlayScopeProvider, hasOwnedFloatingOverlay, useOverlayTheme } from './overlay-scope';

interface OwnerControls { setActive(active: boolean): void; }
interface OverlayThemeHarness {
  ready: boolean;
  commits: Record<string, number>;
  reads: Record<string, number>;
  registered(prefix: string): boolean;
  setActive(prefix: string, active: boolean): void;
  installIframe(css: string): void;
  unmount(): void;
}
declare global { interface Window { __overlayThemeHarness: OverlayThemeHarness; } }

const controls = new Map<string, OwnerControls>();
const roots: Root[] = [];
const commits: Record<string, number> = {}, reads: Record<string, number> = {};

/** Count JS style reads to prove observer retirement, not merely hidden post-unmount React output. */
function instrumentReads(view: Window, prefix: string): void {
  const original = view.getComputedStyle.bind(view);
  reads[prefix] = 0;
  view.getComputedStyle = (element, pseudo) => {
    reads[prefix]++;
    return original(element, pseudo);
  };
}

function Scenario({ prefix, container }: { prefix: string; container: HTMLElement }) {
  const [source, setSource] = React.useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(true);
  const theme = useOverlayTheme(source);
  React.useLayoutEffect(() => {
    commits[prefix] = (commits[prefix] ?? 0) + 1;
  }, [theme]);
  React.useLayoutEffect(() => {
    controls.set(prefix, { setActive });
    return () => { controls.delete(prefix); };
  }, [prefix]);
  return <section id={`${prefix}-scope`} data-testid={`${prefix}-scope`} data-zero-theme="next"
    data-zero-mode="light" data-zero-density="compact">
    <OverlayScopeProvider value={{ id: `${prefix}-owner`, zIndex: 1400, active, themeStyle: theme, container }}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild><button id={`${prefix}-opener`} ref={setSource} type="button">Open {prefix} menu</button></PopoverTrigger>
        <PopoverContent data-testid={`${prefix}-popover`} transition={{ duration: 0 }}
          style={{ '--fixture-local-token': 'local', borderWidth: '3px' } as React.CSSProperties}>
          <h2>Owned {prefix} menu</h2>
          <label>Continuity {prefix}<input aria-label={`Continuity ${prefix}`} defaultValue="" /></label>
          <div data-testid={`${prefix}-local`} className="fixture-local-paint"
            style={{ '--popover': '#ddeeff', '--popover-foreground': '#334455' } as React.CSSProperties}>
            Local child paint survives
          </div>
        </PopoverContent>
      </Popover>
    </OverlayScopeProvider>
  </section>;
}

instrumentReads(window, 'main');
const main = createRoot(document.getElementById('root')!);
roots.push(main);
main.render(<React.StrictMode><Scenario prefix="main" container={document.getElementById('overlay-target')!} /></React.StrictMode>);

window.__overlayThemeHarness = {
  ready: true, commits, reads,
  registered: prefix => hasOwnedFloatingOverlay(`${prefix}-owner`),
  setActive(prefix, active) { controls.get(prefix)?.setActive(active); },
  installIframe(css) {
    if (document.getElementById('theme-frame')) throw new Error('The synthetic iframe already exists.');
    const frame = document.createElement('iframe');
    frame.id = 'theme-frame'; frame.title = 'Synthetic theme owner';
    // A separate fixture lane prevents the already-open main popup covering the frame's trigger.
    frame.style.cssText = 'display:block;margin-top:240px;width:700px;height:350px';
    document.body.append(frame);
    const doc = frame.contentDocument!, view = frame.contentWindow!;
    const style = doc.createElement('style'); style.textContent = css; doc.head.append(style);
    doc.body.innerHTML = '<div id="frame-root"></div><div id="frame-target"></div>';
    doc.documentElement.setAttribute('data-zero-theme', 'next');
    doc.documentElement.setAttribute('data-zero-mode', 'dark');
    instrumentReads(view, 'frame');
    const root = createRoot(doc.getElementById('frame-root')!); roots.push(root);
    root.render(<React.StrictMode><Scenario prefix="frame" container={doc.getElementById('frame-target')!} /></React.StrictMode>);
  },
  unmount() { for (const root of roots.splice(0)) root.unmount(); },
};
