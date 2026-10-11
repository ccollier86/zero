/** Deterministic realm/ancestry/disposal tests for presentation observation; no globals or application services are installed. */
import { expect, test } from 'bun:test';
import { observePresentationTheme, PRESENTATION_THEME_ATTRIBUTES } from './observe-presentation-theme';

function realm() {
  const observers: Array<{ targets: Map<Node, MutationObserverInit>; fire: (records: MutationRecord[]) => void; disconnects: number }> = [];
  const media = new Map<string, Set<() => void>>(), resize = new Set<() => void>();
  class Observer {
    readonly state: (typeof observers)[number];
    constructor(callback: (records: MutationRecord[]) => void) { this.state = { targets: new Map(), fire: callback, disconnects: 0 }; observers.push(this.state); }
    observe(target: Node, options: MutationObserverInit) { this.state.targets.set(target, options); }
    disconnect() { this.state.targets.clear(); this.state.disconnects++; }
  }
  const document = { defaultView: { MutationObserver: Observer,
    matchMedia(query: string) { const listeners = new Set<() => void>(); media.set(query, listeners);
      return { addEventListener(_event: string, listener: () => void) { listeners.add(listener); },
        removeEventListener(_event: string, listener: () => void) { listeners.delete(listener); } }; },
    addEventListener(_event: string, listener: () => void) { resize.add(listener); },
    removeEventListener(_event: string, listener: () => void) { resize.delete(listener); },
  } } as unknown as Document;
  const element = (parentElement: Element | null = null) => ({ ownerDocument: document, parentElement, isConnected: true,
    getRootNode() { return document; } }) as unknown as Element;
  const root = element(), branch = element(root), source = element(branch);
  Object.defineProperty(document, 'documentElement', { value: root });
  const fire = (attributeName = 'data-zero-mode', target = source) => observers.at(-1)!.fire([{ type: 'attributes', target, attributeName } as unknown as MutationRecord]);
  return { document, source, branch, root, observers, media, resize, element, fire };
}
const flush = () => Promise.resolve();

test('observes exact attributes in the source realm and coalesces relevant events only', async () => {
  const r = realm(); let calls = 0;
  const dispose = observePresentationTheme(r.source, () => { calls++; });
  expect(calls).toBe(0); expect(r.observers).toHaveLength(1);
  expect([...r.observers[0]!.targets.keys()]).toEqual([r.source, r.branch, r.root]);
  expect(r.observers[0]!.targets.get(r.source)?.attributeFilter).toEqual([...PRESENTATION_THEME_ATTRIBUTES]);
  r.fire('data-value'); await flush(); expect(calls).toBe(0);
  for (const attribute of PRESENTATION_THEME_ATTRIBUTES) r.fire(attribute);
  for (const listeners of r.media.values()) for (const listener of listeners) listener();
  for (const listener of r.resize) listener();
  await flush(); expect(calls).toBe(1);
  dispose(); expect([...r.media.values()].every(listeners => listeners.size === 0)).toBe(true); expect(r.resize.size).toBe(0);
});

test('ignores renderer-owned decorative mutations and unrelated child rendering', async () => {
  const r = realm(); let calls = 0;
  const dispose = observePresentationTheme(r.source, () => { calls++; }, { ignoreMutation: record => record.attributeName === 'class' });
  r.fire('class'); r.observers[0]!.fire([{ type: 'childList', target: r.source } as unknown as MutationRecord]);
  await flush(); expect(calls).toBe(0);
  r.fire('style'); await flush(); expect(calls).toBe(1); dispose();
});

test('reparenting replaces stale ancestors, detached fallback reconnects, and cleanup cancels queued work', async () => {
  const r = realm(); let calls = 0;
  const dispose = observePresentationTheme(r.source, () => { calls++; });
  const moved = r.element(r.root);
  Object.defineProperty(r.source, 'parentElement', { value: moved, configurable: true });
  r.observers[0]!.fire([{ type: 'childList', target: r.branch } as unknown as MutationRecord]);
  await flush(); expect(calls).toBe(1);
  expect([...r.observers[0]!.targets.keys()]).toEqual([r.source, moved, r.root]);
  Object.defineProperty(r.source, 'isConnected', { value: false, configurable: true });
  r.observers[0]!.fire([{ type: 'childList', target: moved } as unknown as MutationRecord]);
  await flush(); expect([...r.observers[0]!.targets.keys()]).toEqual([r.root, r.document]);
  expect(r.observers[0]!.targets.get(r.document)?.subtree).toBe(true);
  Object.defineProperty(r.source, 'isConnected', { value: true });
  r.observers[0]!.fire([{ type: 'childList', target: r.root } as unknown as MutationRecord]);
  await flush(); expect([...r.observers[0]!.targets.keys()]).toEqual([r.source, moved, r.root]);
  r.fire(); dispose(); dispose(); await flush(); expect(calls).toBe(3); expect(r.observers[0]!.targets.size).toBe(0);
});

test('document adoption replaces media and observer realm without leaking the old environment', async () => {
  const first = realm(), second = realm(); let calls = 0;
  const dispose = observePresentationTheme(first.source, () => { calls++; });
  Object.defineProperty(first.source, 'ownerDocument', { value: second.document });
  Object.defineProperty(first.source, 'parentElement', { value: second.branch });
  first.observers[0]!.fire([{ type: 'childList', target: first.branch } as unknown as MutationRecord]);
  await flush(); expect(calls).toBe(1); expect(second.observers).toHaveLength(1);
  expect([...first.media.values()].every(listeners => listeners.size === 0)).toBe(true);
  expect(first.resize.size).toBe(0); expect(first.observers[0]!.targets.size).toBe(0);
  expect([...second.observers[0]!.targets.keys()]).toEqual([first.source, second.branch, second.root]);
  second.fire('data-zero-density', first.source); await flush(); expect(calls).toBe(2); dispose();
});

test('shadow boundaries observe removal and retain same-branch reconnect ownership', async () => {
  const r = realm(); let calls = 0;
  const host = r.element(r.root), shadow = { host } as unknown as ShadowRoot;
  Object.defineProperty(r.source, 'parentElement', { value: null });
  Object.defineProperty(r.source, 'getRootNode', { value: () => shadow });
  const dispose = observePresentationTheme(r.source, () => { calls++; });
  expect([...r.observers[0]!.targets.keys()]).toEqual([r.source, shadow, host, r.root]);
  expect(r.observers[0]!.targets.get(shadow)).toEqual({ childList: true, subtree: false });
  Object.defineProperty(r.source, 'isConnected', { value: false, configurable: true });
  r.observers[0]!.fire([{ type: 'childList', target: shadow } as unknown as MutationRecord]);
  await flush(); expect(calls).toBe(1);
  expect([...r.observers[0]!.targets.keys()]).toEqual([r.root, shadow, r.document]);
  expect(r.observers[0]!.targets.get(shadow)?.subtree).toBe(true);
  Object.defineProperty(r.source, 'isConnected', { value: true });
  r.observers[0]!.fire([{ type: 'childList', target: shadow } as unknown as MutationRecord]);
  await flush(); expect(calls).toBe(2);
  expect([...r.observers[0]!.targets.keys()]).toEqual([r.source, shadow, host, r.root]); dispose();
});

test('accessible slot assignment retargets flattened ancestry and disposes slot listeners', async () => {
  const r = realm(); let calls = 0;
  const host = r.element(r.root), wrapper = r.element(), slot = r.element(wrapper);
  const listeners = new Set<() => void>();
  const shadow = { host,
    addEventListener(_event: string, listener: () => void) { listeners.add(listener); },
    removeEventListener(_event: string, listener: () => void) { listeners.delete(listener); },
  } as unknown as ShadowRoot;
  Object.defineProperty(host, 'shadowRoot', { value: shadow });
  Object.defineProperty(wrapper, 'getRootNode', { value: () => shadow });
  Object.defineProperty(r.source, 'parentElement', { value: host });
  Object.defineProperty(r.source, 'assignedSlot', { value: null, configurable: true });
  const dispose = observePresentationTheme(r.source, () => { calls++; });
  expect(listeners.size).toBe(1);
  Object.defineProperty(r.source, 'assignedSlot', { value: slot, configurable: true });
  for (const listener of [...listeners]) listener();
  await flush(); expect(calls).toBe(1);
  expect([...r.observers[0]!.targets.keys()]).toEqual([r.source, slot, wrapper, shadow, host, r.root]);
  for (const listener of [...listeners]) listener();
  await flush(); expect(calls).toBe(1);
  Object.defineProperty(r.source, 'assignedSlot', { value: null });
  for (const listener of [...listeners]) listener();
  await flush(); expect(calls).toBe(2);
  expect(r.observers[0]!.targets.has(wrapper)).toBe(false);
  dispose(); expect(listeners.size).toBe(0);
});

test('import and null subscription remain safe without a browser document', async () => {
  let calls = 0;
  const dispose = observePresentationTheme(null, () => { calls++; }); dispose(); await flush(); expect(calls).toBe(0);
});
