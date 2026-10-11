/**
 * ordinary-scroll-adoption.browser-fixture.tsx
 *
 * Synthetic DatePicker and ContextMenu consumers for exact native viewport,
 * focus, portal, and ref qualification. No application or service is booted.
 */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import type { RootProps } from 'react-day-picker';
import { DatePicker } from '../../ui/date-picker';
import { ScrollViewportAttachment } from './scroll-viewport-attachment';
import { ModalManager } from '../../../modals/modal-manager';
import { modals } from '../../../modals/modal-events';
import { hasOwnedFloatingOverlay } from '../overlay-scope/overlay-scope';
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
  ContextMenuLabel, ContextMenuSeparator, ContextMenuSub, ContextMenuSubTrigger,
  ContextMenuSubContent, ContextMenuViewport,
} from '../../context-menu';

interface MenuConfiguration {
  mounted: boolean;
  rows: number;
  wide: boolean;
  rtl: boolean;
  portal: 'default' | 'custom' | 'none';
  forceMount: boolean;
  asChild: boolean;
  customViewport: boolean;
  childTag: 'section' | 'article';
  scrollTreatment: 'arc' | 'native';
}
interface DateConfiguration {
  mounted: boolean;
  disabled: boolean;
  readOnly: boolean;
  controlled: boolean;
  open: boolean;
  rtl: boolean;
  wide: boolean;
  yearRange: readonly [number, number];
  customRoot: boolean;
  controlledDraft: boolean;
  scrollTreatment: 'arc' | 'native';
}
interface NativeEventRecord { kind: string; native: boolean; exact: boolean }
interface RefRecord { owner: 'public' | 'child' | 'viewport' | 'calendar'; phase: 'attach' | 'cleanup'; tag: string }
interface OrdinaryScrollFixture {
  configure(next: Partial<MenuConfiguration>): void;
  configureDate(next: Partial<DateConfiguration>): void;
  surface(): HTMLElement | null;
  child(): HTMLElement | null;
  retired(): HTMLElement | null;
  viewport(): HTMLDivElement | null;
  calendar(): HTMLDivElement | null;
  events(): readonly NativeEventRecord[];
  refs(): readonly RefRecord[];
  changes(): readonly string[];
  requests(): readonly boolean[];
  actions(): readonly string[];
  mountRaw(mounted: boolean): void;
  reparentRaw(): void;
  raw(): HTMLDivElement | null;
  registered(id: string): boolean;
  releaseManagedRetention(): void;
  clear(): void;
}
declare global { interface Window { __ordinaryScroll: OrdinaryScrollFixture } }

let configure!: OrdinaryScrollFixture['configure'];
let configureDate!: OrdinaryScrollFixture['configureDate'];
let surface: HTMLElement | null = null, child: HTMLElement | null = null, retired: HTMLElement | null = null;
let nativeViewport: HTMLDivElement | null = null, calendar: HTMLDivElement | null = null;
let mountRaw!: (mounted: boolean) => void, raw: HTMLDivElement | null = null, retiredRaw: HTMLDivElement | null = null;
let releaseManagedRetention: (() => void) | null = null;
const refs: RefRecord[] = [], events: NativeEventRecord[] = [], changes: string[] = [], requests: boolean[] = [], actions: string[] = [];

/** Consumer-owned Root retains the installed DayPicker rootRef contract. */
function ConsumerCalendarRoot({ rootRef, ...props }: RootProps) {
  const ref = React.useCallback((node: HTMLDivElement | null) => {
    calendar = node;
    const cleanup = typeof rootRef === 'function' ? rootRef(node) : rootRef ? (rootRef.current = node, undefined) : undefined;
    if (!node) return;
    refs.push({ owner: 'calendar', phase: 'attach', tag: node.tagName });
    return () => {
      refs.push({ owner: 'calendar', phase: 'cleanup', tag: node.tagName }); if (calendar === node) calendar = null;
      if (typeof cleanup === 'function') cleanup();
      else if (typeof rootRef === 'function') rootRef(null);
      else if (rootRef) rootRef.current = null;
    };
  }, [rootRef]);
  return <div {...props} ref={ref} data-consumer-root="retained" />;
}

/** An independent native DOM owner may reparent its viewport without remounting its adapter. */
function IndependentNativeOwner() {
  const first = React.useRef<HTMLDivElement>(null), second = React.useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = React.useState<HTMLDivElement | null>(null);
  React.useLayoutEffect(() => {
    for (const parent of [first.current!, second.current!]) parent.style.setProperty('position', 'static', 'important');
    const element = document.createElement('div'); raw = element;
    element.dataset.testid = 'independent-native'; element.dataset.zeroScrollFade = 'owner-sentinel';
    element.style.cssText = 'width:200px;height:100px;overflow:auto'; element.style.setProperty('--zero-scroll-edge-top', '3px', 'important');
    const content = document.createElement('div'); content.style.cssText = 'width:500px;height:600px'; content.textContent = 'Independent content';
    element.append(content); first.current!.append(element); setViewport(element);
    return () => { retiredRaw = element; if (raw === element) raw = null; element.remove(); };
  }, []);
  return <section data-testid="independent-host" style={{ marginTop: 12 }}>
    <div ref={first} data-testid="first-parent" style={{ width: 240, padding: 12 }} />
    <div ref={second} data-testid="second-parent" style={{ width: 240, padding: 12 }} />
    <ScrollViewportAttachment viewport={viewport} orientation="both" />
  </section>;
}

/** Actual managed owner exercises portal-layer inheritance and stacked admission. */
function ManagedContextBody({ asChild = false, retain = false }: { asChild?: boolean; retain?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [retained, setRetained] = React.useState(false);
  React.useLayoutEffect(() => {
    releaseManagedRetention = () => setRetained(false);
    return () => { releaseManagedRetention = null; };
  }, []);
  const content = <>
    <ContextMenuItem onSelect={event => event.preventDefault()}>Keep managed menu open</ContextMenuItem>
    <ContextMenuSub><ContextMenuSubTrigger>Managed destinations</ContextMenuSubTrigger>
      <ContextMenuSubContent data-testid="managed-submenu" style={{ width: 210, maxHeight: 150 }}>
        {Array.from({ length: 16 }, (_, index) => <ContextMenuItem key={index} onSelect={event => event.preventDefault()}>Managed destination {index + 1}</ContextMenuItem>)}
      </ContextMenuSubContent>
    </ContextMenuSub>
    <ContextMenuItem onSelect={event => {
      event.preventDefault();
      modals.show({ title: 'Stacked context child', body: <p>Owned child dialog.</p>, guard: false,
        motion: { pageRecedes: false }, actions: [{ id: 'done', label: 'Done' }] });
    }}>Open stacked context dialog</ContextMenuItem>
    {Array.from({ length: 22 }, (_, index) => <ContextMenuItem key={index} onSelect={event => event.preventDefault()}>Managed action {index + 1}</ContextMenuItem>)}
  </>;
  return <section>
    <ContextMenu onOpenChange={next => { setOpen(next); if (next && retain) setRetained(true); }}>
      <ContextMenuTrigger asChild><button type="button" data-testid="managed-target">Managed record menu</button></ContextMenuTrigger>
      <ContextMenuContent data-testid="managed-menu" forceMount={retained ? true : undefined} asChild={asChild}
        style={{ width: 260, maxHeight: 190, visibility: open ? 'visible' : 'hidden' }}>
        {asChild ? <section data-hostile-child="retained" data-zero-overlay-owner="forged-owner" inert={false}
          style={{ zIndex: 999999, pointerEvents: 'auto' }}><ContextMenuViewport>{content}</ContextMenuViewport></section> : content}
      </ContextMenuContent>
    </ContextMenu>
  </section>;
}

function Fixture() {
  const [config, setConfig] = React.useState<MenuConfiguration>({ mounted: true, rows: 32, wide: false, rtl: false,
    portal: 'default', forceMount: false, asChild: false, customViewport: false, childTag: 'section', scrollTreatment: 'arc' });
  const [dateConfig, setDateConfig] = React.useState<DateConfiguration>({ mounted: true, disabled: false, readOnly: false,
    controlled: false, open: false, rtl: false, wide: false, yearRange: [1900, 2100], customRoot: false,
    controlledDraft: true, scrollTreatment: 'arc' });
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
  const [contextOpen, setContextOpen] = React.useState(false);
  const [rawMounted, setRawMounted] = React.useState(false);
  mountRaw = setRawMounted;
  const [date, setDate] = React.useState<Date | undefined>(new Date(2026, 1, 3));
  const [draft, setDraft] = React.useState('February 3rd, 2026');
  configure = next => setConfig(previous => ({ ...previous, ...next }));
  configureDate = next => setDateConfig(previous => ({ ...previous, ...next }));
  React.useLayoutEffect(() => {
    const previous = document.documentElement.getAttribute('dir');
    document.documentElement.setAttribute('dir', dateConfig.rtl ? 'rtl' : 'ltr');
    return () => { if (previous === null) document.documentElement.removeAttribute('dir'); else document.documentElement.setAttribute('dir', previous); };
  }, [dateConfig.rtl]);
  const publicRef = React.useCallback((node: HTMLDivElement | null) => {
    surface = node;
    if (!node) return;
    refs.push({ owner: 'public', phase: 'attach', tag: node.tagName });
    return () => {
      refs.push({ owner: 'public', phase: 'cleanup', tag: node.tagName }); retired = node;
      if (surface === node) surface = null;
    };
  }, []);
  const childRef = React.useCallback((node: HTMLElement | null) => {
    child = node;
    if (!node) return;
    refs.push({ owner: 'child', phase: 'attach', tag: node.tagName });
    return () => { refs.push({ owner: 'child', phase: 'cleanup', tag: node.tagName }); if (child === node) child = null; };
  }, []);
  const viewportRef = React.useCallback((node: HTMLDivElement | null) => {
    nativeViewport = node;
    if (!node) return;
    refs.push({ owner: 'viewport', phase: 'attach', tag: node.tagName });
    return () => { refs.push({ owner: 'viewport', phase: 'cleanup', tag: node.tagName }); if (nativeViewport === node) nativeViewport = null; };
  }, []);
  const Tag = config.childTag;
  const content = <>
    <ContextMenuLabel>Record actions</ContextMenuLabel>
    <ContextMenuItem disabled>Disabled action</ContextMenuItem>
    <ContextMenuSub>
      <ContextMenuSubTrigger>Move to</ContextMenuSubTrigger>
      <ContextMenuSubContent data-testid="submenu" style={{ maxHeight: 151, width: 250 }}>
        {Array.from({ length: 24 }, (_, index) => <ContextMenuItem key={index}
          onSelect={event => { event.preventDefault(); actions.push(`destination-${index + 1}`); }}>
          Destination {String(index + 1).padStart(2, '0')}
        </ContextMenuItem>)}
      </ContextMenuSubContent>
    </ContextMenuSub>
    <ContextMenuSeparator />
    {Array.from({ length: config.rows }, (_, index) => <ContextMenuItem key={index}
      style={{ height: 34, flexShrink: 0, ...(config.wide ? { minWidth: 650 } : {}) }}
      onSelect={event => { event.preventDefault(); actions.push(`action-${index + 1}`); }}>
      Action {String(index + 1).padStart(2, '0')}
    </ContextMenuItem>)}
    <ContextMenuItem onSelect={() => actions.push('zebra')}>Zebra action</ContextMenuItem>
  </>;
  return <><div data-testid="portal-container" ref={setContainer} />
    <ModalManager portalContainer={container}>
    <main data-testid="ordinary-ready" data-zero-theme="next" style={{ padding: 18, minHeight: '100vh' }}>
    <style>{'[data-radix-popper-content-wrapper]:has(> [data-testid="menu"][data-state="closed"]) { visibility:hidden; pointer-events:none; }'}</style>
    <section data-testid="date-host" style={{ maxWidth: 290 }}>
      {dateConfig.mounted && <DatePicker value={date} inputValue={dateConfig.controlledDraft ? draft : undefined}
        scrollTreatment={dateConfig.scrollTreatment} disabled={dateConfig.disabled} readOnly={dateConfig.readOnly}
        open={dateConfig.controlled ? dateConfig.open : undefined} onOpenChange={next => requests.push(next)}
        inputProps={{ 'aria-label': 'Due date' }}
        onInputValueChange={setDraft} onChange={next => {
          changes.push(next ? `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}` : 'cleared');
          setDate(next);
        }} calendarProps={{ showToday: false, dir: dateConfig.rtl ? 'rtl' : 'ltr', yearRange: dateConfig.yearRange,
          style: dateConfig.wide ? { minWidth: 580 } : undefined,
          components: dateConfig.customRoot ? { Root: ConsumerCalendarRoot } : undefined }} />}
    </section>
    <section data-testid="menu-host" dir={config.rtl ? 'rtl' : 'ltr'} style={{ marginTop: 12 }}>
      {config.mounted && <ContextMenu dir={config.rtl ? 'rtl' : 'ltr'} onOpenChange={setContextOpen}>
        <ContextMenuTrigger asChild><button type="button" data-testid="menu-target"
          style={{ border: '1px solid var(--border)', borderRadius: 7, padding: '8px 12px' }}>Record menu</button></ContextMenuTrigger>
        <ContextMenuContent ref={publicRef} viewportRef={viewportRef} data-testid="menu" asChild={config.asChild}
          portal={config.portal !== 'none'} container={config.portal === 'custom' ? container : undefined}
          forceMount={config.forceMount ? true : undefined} scrollTreatment={config.scrollTreatment}
          style={{ width: 290, maxHeight: config.rows > 3 ? 178 : undefined,
            ...(config.forceMount ? { visibility: contextOpen ? 'visible' : 'hidden' } : {}) }}
          onAnimationStart={event => events.push({ kind: 'animation', native: event.nativeEvent instanceof AnimationEvent, exact: event.currentTarget === surface })}
          onDragStart={event => events.push({ kind: 'drag', native: event.nativeEvent instanceof DragEvent, exact: event.currentTarget === surface })}
          onKeyDown={event => events.push({ kind: `key:${event.key}`, native: event.nativeEvent instanceof KeyboardEvent, exact: event.currentTarget === surface })}>
          {config.asChild ? <Tag ref={childRef} data-child="retained" aria-label="Slotted record menu">
            {config.customViewport ? <><header data-testid="custom-fixed-header" style={{ height: 24, flexShrink: 0 }}>Fixed header</header>
              <ContextMenuViewport ref={viewportRef}>{content}</ContextMenuViewport>
              <footer data-testid="custom-fixed-footer" style={{ height: 24, flexShrink: 0 }}>Fixed footer</footer></> : content}
          </Tag> : content}
        </ContextMenuContent>
      </ContextMenu>}
    </section>
    <button type="button" data-testid="managed-open" style={{ marginTop: 12,
      '--zero-test-owned-token': 'owned-from-trigger', '--radix-popover-content-available-height': '9px' } as React.CSSProperties}
      onClick={event => modals.show({ title: 'Managed context owner', body: <ManagedContextBody asChild={config.asChild} retain={config.forceMount} />, trigger: event.currentTarget,
        height: 'fixed', customSize: { width: '440px', height: '370px' }, guard: false,
        motion: { pageRecedes: false }, actions: [{ id: 'done', label: 'Done' }] })}>Open managed context owner</button>
    {rawMounted && <IndependentNativeOwner />}
    <button type="button" data-testid="outside" style={{ position: 'fixed', right: 18, top: 16 }}>Outside target</button>
    </main></ModalManager></>;
}

Object.assign(window, { __ordinaryScroll: {
  configure: (next: Partial<MenuConfiguration>) => configure(next),
  configureDate: (next: Partial<DateConfiguration>) => configureDate(next),
  surface: () => surface, child: () => child, retired: () => retired,
  viewport: () => nativeViewport, calendar: () => calendar,
  mountRaw: (mounted: boolean) => mountRaw(mounted),
  reparentRaw: () => { if (raw) document.querySelector('[data-testid="second-parent"]')!.append(raw); },
  raw: () => raw ?? retiredRaw,
  registered: (id: string) => hasOwnedFloatingOverlay(id),
  releaseManagedRetention: () => releaseManagedRetention?.(),
  events: () => events, refs: () => refs, changes: () => changes, requests: () => requests, actions: () => actions,
  clear: () => { events.length = 0; refs.length = 0; changes.length = 0; requests.length = 0; actions.length = 0; },
} satisfies OrdinaryScrollFixture });
createRoot(document.getElementById('root')!).render(<Fixture />);
