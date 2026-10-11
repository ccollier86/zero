/** Isolated native action-tray qualification; no application, services, fonts, database or persistence executes. */
import * as React from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { motion } from 'motion/react';
import { FloatingButtonGroup } from './floating-button-group';
import type { FloatingButtonGroupItem } from './floating-button-group.types';
import { useFloatingButtonGroupHighlight } from './use-floating-button-group-highlight';
import { OverlayScopeProvider } from '../../overlays/overlay-scope';

type Settings = {
  orientation: 'horizontal' | 'vertical'; dir: 'ltr' | 'rtl'; iconOnly: boolean;
  label: string; pressed: boolean; disabled: readonly string[]; removed: readonly string[];
  empty: boolean; mounted: boolean; scaleX: number; scaleY: number; active: boolean;
  side: 'top' | 'right' | 'bottom' | 'left'; size: 'sm' | 'md'; variant: 'muted' | 'floating';
};
const defaults: Settings = { orientation: 'horizontal', dir: 'ltr', iconOnly: false, label: 'Share', pressed: false,
  disabled: ['beta'], removed: [], empty: false, mounted: true, scaleX: 1, scaleY: 1, active: true,
  side: 'top', size: 'md', variant: 'floating' };
const events: string[] = [];
const refEvents: { id: string; phase: 'attach' | 'cleanup' }[] = [];
const refs = new Map<string, HTMLButtonElement>();
let tray: HTMLDivElement | null = null;
const itemRefs = new Map<string, React.RefCallback<HTMLButtonElement>>();
function actionRef(id: string): React.RefCallback<HTMLButtonElement> {
  let ref = itemRefs.get(id);
  if (!ref) {
    ref = element => {
      if (!element) { refs.delete(id); return; }
      refs.set(id, element); refEvents.push({ id, phase: 'attach' });
      return () => { if (refs.get(id) === element) refs.delete(id); refEvents.push({ id, phase: 'cleanup' }); };
    };
    itemRefs.set(id, ref);
  }
  return ref;
}
function Icon() {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path d="M3 4h7v8H3zM6 2h7v8" fill="none" stroke="currentColor" /></svg>;
}
function items(settings: Settings): FloatingButtonGroupItem[] {
  if (settings.empty) return [];
  return [
    { id: 'alpha', label: settings.label, icon: <Icon />, shortcut: '⌘ S', reserveLabels: ['Share', 'Copied successfully'],
      ref: actionRef('alpha'), disabled: settings.disabled.includes('alpha'), onSelect: () => events.push('item:alpha') },
    { type: 'separator' as const, id: 'cluster' },
    { id: 'beta', label: 'Unavailable', icon: <Icon />, ref: actionRef('beta'), disabled: settings.disabled.includes('beta'), onSelect: () => events.push('item:beta') },
    { id: 'gamma', label: 'Export', icon: <Icon />, ref: actionRef('gamma'), disabled: settings.disabled.includes('gamma'), onSelect: () => events.push('item:gamma') },
    { id: 'delta', label: 'Present', icon: <Icon />, ref: actionRef('delta'), disabled: settings.disabled.includes('delta'),
      pressed: settings.pressed, onSelect: () => events.push('item:delta') },
    { id: 'plain', label: 'No icon', icon: false, ref: actionRef('plain'), disabled: settings.disabled.includes('plain'), onSelect: () => events.push('item:plain') },
  ].filter(item => !settings.removed.includes(item.id));
}

const playback: { duration: number; target: string }[] = [];
const nativeAnimate = Element.prototype.animate;
Element.prototype.animate = function (keyframes, options) {
  const duration = typeof options === 'number' ? options : options?.duration;
  if (typeof duration === 'number') playback.push({ duration,
    target: this.closest('[data-zero-tooltip]') || this.querySelector('[data-zero-tooltip]') ? 'tooltip' : this.className.toString() });
  return nativeAnimate.call(this, keyframes, options);
};

// Exercise the private paint adapter's actual DOM replacement boundary without
// mutating React-owned elements or pretending the public tray admits asChild.
function ReplacementProbe() {
  const [root, setRoot] = React.useState<HTMLDivElement | null>(null), [replace, setReplace] = React.useState(false);
  const nodes = React.useRef(new Map<string, HTMLButtonElement>()), [version, updateVersion] = React.useReducer((value: number) => value + 1, 0);
  const ref = React.useCallback((element: HTMLButtonElement | null) => {
    if (!element) return;
    nodes.current.set('same', element); updateVersion();
    return () => { if (nodes.current.get('same') === element) nodes.current.delete('same'); };
  }, []);
  const paint = useFloatingButtonGroupHighlight(root, nodes.current, version, 'same', false);
  React.useLayoutEffect(() => { Object.assign(window, { __floatingReplacement: () => setReplace(value => !value) }); }, []);
  return <div ref={setRoot} data-testid="replacement-probe" style={{ position: 'relative', width: 360, padding: 12, border: '2px solid transparent' }}>
    <motion.span data-testid="replacement-paint" aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, ...paint.style }} />
    <button key={replace ? 'new' : 'old'} ref={ref} type="button" data-zero-floating-action="same" data-replaced={replace}
      style={{ width: replace ? 230 : 100, height: 36 }}>{replace ? 'Replacement native action' : 'Native action'}</button>
  </div>;
}

function Fixture() {
  const [settings, setSettings] = React.useState(defaults);
  const [submits, setSubmits] = React.useState(0);
  const [portal, setPortal] = React.useState<HTMLDivElement | null>(null);
  const owner = React.useMemo(() => ({ id: 'floating-fixture-owner', active: settings.active, zIndex: 1700, container: portal }), [settings.active, portal]);
  React.useLayoutEffect(() => {
    Object.assign(window, { __floatingFixture: {
      configure(next: Partial<Settings>) { setSettings(previous => ({ ...previous, ...next })); },
      reset() { events.length = 0; playback.length = 0; setSettings(defaults); setSubmits(0); },
      events: () => [...events], playback: (clear = false) => { const result = [...playback]; if (clear) playback.length = 0; return result; },
      refs: () => ({ tray: !!tray?.isConnected, items: [...refs].map(([id, element]) => ({ id,
        exact: document.querySelector(`[data-testid="dynamic"] [data-zero-floating-action="${id}"]`) === element,
        connected: element.isConnected })), events: [...refEvents] }),
    } });
  }, []);
  return <main data-zero-theme="next" data-zero-mode="light" style={{ minHeight: '100vh', padding: 48, display: 'grid', gap: 32, alignContent: 'start',
    background: 'var(--zero-theme-canvas)', color: 'var(--zero-theme-text-primary)' }}>
    <h1>Floating Button Group fixture</h1>
    <button type="button" data-testid="outside">Outside control</button>
    <div ref={setPortal} data-testid="owned-portals" />
    <form data-testid="action-form" onSubmit={event => { event.preventDefault(); setSubmits(value => value + 1); }}>
      <div data-testid="transform-host" style={{ display: 'inline-block', border: '3px solid transparent', transformOrigin: '0 0',
        transform: `scale(${settings.scaleX}, ${settings.scaleY})` }}>
        <OverlayScopeProvider value={owner}>
          {settings.mounted && <FloatingButtonGroup data-testid="dynamic" ref={element => { tray = element; }}
            items={items(settings)} label="Document actions" variant={settings.variant} size={settings.size}
            orientation={settings.orientation} dir={settings.dir} iconOnly={settings.iconOnly} tooltipSide={settings.side}
            onAction={id => events.push(`group:${id}`)} />}
        </OverlayScopeProvider>
      </div>
      <output data-testid="submit-count">{submits}</output>
    </form>
    <section aria-label="Independent trays" style={{ display: 'flex', gap: 40, alignItems: 'start' }}>
      <FloatingButtonGroup data-testid="independent" label="Independent actions" size="sm" variant="muted"
        items={[{ id: 'alpha', label: 'Another Share', icon: <Icon /> }, { id: 'gamma', label: 'Another Export', icon: <Icon /> }]} />
      <FloatingButtonGroup data-testid="vertical" label="Column actions" orientation="vertical" iconOnly
        items={[{ id: 'up', label: 'First column action', icon: <Icon /> }, { type: 'separator', id: 'middle' },
          { id: 'down', label: 'Last column action', icon: <Icon /> }]} />
    </section>
    <ReplacementProbe />
  </main>;
}
const hydrationEvents: string[] = [], hydrationErrors: string[] = [];
const hydrationHost = document.getElementById('hydrate-root');
if (hydrationHost) hydrateRoot(hydrationHost, <FloatingButtonGroup label="Hydrated actions" items={[
  { id: 'first', label: 'Hydrated first', onSelect: () => hydrationEvents.push('item:first') },
  { id: 'disabled', label: 'Hydrated unavailable', disabled: true },
  { id: 'last', label: 'Hydrated last', onSelect: () => hydrationEvents.push('item:last') },
]} onAction={id => hydrationEvents.push(`group:${id}`)} />, { onRecoverableError: error => hydrationErrors.push(String(error)) });
Object.assign(window, { __floatingHydration: { events: () => [...hydrationEvents], errors: () => [...hydrationErrors] } });
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
