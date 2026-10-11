/** Owner-document presentation subscriptions for portals and cached chart paint; no theme installation or interaction ownership. */

/** Legacy/public and opt-in theme boundaries; arbitrary content/data mutations do not trigger repaint. */
export const PRESENTATION_THEME_ATTRIBUTES = Object.freeze([
  'class', 'style', 'data-theme', 'data-zero-theme', 'data-zero-mode',
  'data-zero-density', 'data-zero-surface', 'data-zero-page',
]);
const MEDIA = ['(prefers-color-scheme: dark)', '(prefers-reduced-motion: reduce)', '(pointer: coarse)', '(forced-colors: active)'];

/** A renderer may ignore only its own known decorative mutations to avoid feedback from paint. */
export interface PresentationThemeObservationOptions {
  readonly ignoreMutation?: (record: MutationRecord) => boolean;
}

/**
 * Subscribe to scoped presentation and native preference changes without a DOM
 * read at import time. Disconnected sources use their own document root; moving
 * connected sources rebind ancestor/document subscriptions. Reconnection inside
 * the same document or a known shadow branch is detected. Already-detached
 * adoption into another document/unknown shadow branch requires resubscription.
 * Accessible slot ancestry and assignment changes are followed; browsers hide
 * closed-shadow slot associations for light-DOM sources.
 * Calls are coalesced, not polled.
 * No initial notification is emitted; disposal cancels queued notifications.
 */
export function observePresentationTheme(source: Element | null, onChange: () => void,
  options: PresentationThemeObservationOptions = {}): () => void {
  let disposed = false, pending = false, observer: MutationObserver | undefined;
  let document: Document | null = null, ancestors: Node[] = [], connected = false;
  let shadowRoots: ShadowRoot[] = [];
  let releaseEnvironment = () => {};
  let releaseSlots = () => {};

  const resolveDocument = () => source?.ownerDocument ?? (typeof globalThis.document === 'undefined' ? null : globalThis.document);
  function request() {
    if (disposed || pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      if (disposed) return;
      bind();
      onChange();
    });
  }
  function mutation(records: MutationRecord[]) {
    if (disposed) return;
    const changed = bind();
    if (changed || records.some(record => record.type === 'attributes'
      && PRESENTATION_THEME_ATTRIBUTES.includes(record.attributeName ?? '') && !options.ignoreMutation?.(record))) request();
  }
  function slotAssignment() { if (!disposed && bind()) request(); }
  function bind(): boolean {
    const nextDocument = resolveDocument(), nextConnected = !!source?.isConnected;
    const nextAncestors: Node[] = [], nextElements = new Set<Element>(), nextShadowRoots: ShadowRoot[] = [];
    const includeRoot = (root: ShadowRoot) => {
      if (nextShadowRoots.includes(root)) return;
      nextAncestors.push(root); nextShadowRoots.push(root);
    };
    let element: Element | null = nextConnected ? source : nextDocument?.documentElement ?? null;
    while (element && !nextElements.has(element)) {
      nextAncestors.push(element); nextElements.add(element);
      // Open roots also publish slotchange when a previously unassigned source
      // gains a slot. CSS inheritance follows the assigned slot, not its DOM parent.
      if (nextConnected && element.shadowRoot) includeRoot(element.shadowRoot);
      if (element.assignedSlot) element = element.assignedSlot;
      else if (element.parentElement) element = element.parentElement;
      else {
        const root = element.getRootNode() as ShadowRoot;
        if (root.host) { includeRoot(root); element = root.host; }
        else element = null;
      }
    }
    const documentChanged = document !== nextDocument;
    if (nextConnected) shadowRoots = nextShadowRoots;
    else if (documentChanged) shadowRoots = [];
    // Document subtree observers do not cross a ShadowRoot boundary. Keep the
    // last known roots while detached so same-branch reinsertion is observable.
    if (!nextConnected) nextAncestors.push(...shadowRoots);
    const changed = documentChanged || connected !== nextConnected || ancestors.length !== nextAncestors.length
      || ancestors.some((ancestor, index) => ancestor !== nextAncestors[index]);
    if (!changed) return false;
    observer?.disconnect();
    releaseSlots();
    if (documentChanged) {
      releaseEnvironment(); observer = undefined;
      const view = nextDocument?.defaultView;
      if (view?.MutationObserver) observer = new view.MutationObserver(mutation);
      const releases: Array<() => void> = [];
      if (view) {
        for (const query of MEDIA) {
          const media = view.matchMedia?.(query);
          if (!media) continue;
          if (typeof media.addEventListener === 'function') {
            media.addEventListener('change', request);
            releases.push(() => media.removeEventListener('change', request));
          } else if (typeof media.addListener === 'function') {
            media.addListener(request); releases.push(() => media.removeListener(request));
          }
        }
        view.addEventListener('resize', request);
        releases.push(() => view.removeEventListener('resize', request));
      }
      releaseEnvironment = () => { for (const release of releases) release(); };
    }
    document = nextDocument; ancestors = nextAncestors; connected = nextConnected;
    for (const root of shadowRoots) root.addEventListener?.('slotchange', slotAssignment);
    const observedRoots = [...shadowRoots];
    releaseSlots = () => { for (const root of observedRoots) root.removeEventListener?.('slotchange', slotAssignment); };
    // Direct child-list observation catches removals/reparenting without waking
    // every chart observer for descendant SVG/content updates on every frame.
    for (const ancestor of ancestors) observer?.observe(ancestor, nextElements.has(ancestor as Element)
      ? { attributes: true, attributeOldValue: true, attributeFilter: [...PRESENTATION_THEME_ATTRIBUTES], childList: true }
      : { childList: true, subtree: !connected });
    // A detached source can reconnect anywhere, not only in the old ancestor chain.
    if (!connected && document) observer?.observe(document, { childList: true, subtree: true });
    return true;
  }
  bind();
  return () => {
    if (disposed) return;
    disposed = true; observer?.disconnect(); releaseSlots(); releaseEnvironment(); ancestors = []; shadowRoots = [];
  };
}
