/** Browser history admission. Form guards supply decisions; this owns URL publication only. */
export type NavigationGuard = () => boolean | Promise<boolean>;
export interface NavigationOptions { bypassGuards?: boolean }
const INDEX = '__zero_router_index';

export class RouterNavigation {
  private readonly guards = new Set<NavigationGuard>();
  private readonly listeners = new Set<() => void>();
  private readonly browser: Window | null;
  private href: string;
  private pathname: string;
  private index = 0;
  private epoch = 0;
  private awaitingEpoch: number | null = null;
  private restoring: { target: string; index: number; delta: number; resumeGuard: boolean } | null = null;
  private bypassPop: { readonly href: string; readonly index: number } | null = null;
  private readonly knownHrefs = new Map<number, string>();
  private attached = false;
  constructor(private readonly initialPathname = '/', private readonly reportFailure: () => void = () => {}) {
    this.browser = typeof window === 'undefined' ? null : window;
    this.href = this.browser?.location.href ?? initialPathname;
    this.pathname = this.browser?.location.pathname ?? initialPathname;
    this.knownHrefs.set(this.index, this.href);
  }
  readonly getSnapshot = (): string => this.pathname;
  readonly getServerSnapshot = (): string => this.initialPathname;
  readonly subscribe = (callback: () => void): (() => void) => {
    this.listeners.add(callback); this.attach();
    return () => { this.listeners.delete(callback); if (!this.listeners.size) this.detach(); };
  };
  register(guard: NavigationGuard): () => void {
    this.guards.add(guard); ++this.epoch; this.awaitingEpoch = null; this.attach();
    return () => { this.guards.delete(guard); ++this.epoch; this.awaitingEpoch = null; };
  }
  push(path: string, options?: NavigationOptions): void {
    this.admit(() => {
      const browser = this.browser; if (!browser) return;
      browser.history.pushState({ [INDEX]: ++this.index }, '', path); this.publish();
      browser.dispatchEvent(new PopStateEvent('popstate', { state: browser.history.state }));
    }, options);
  }
  replace(path: string, options?: NavigationOptions): void {
    this.admit(() => {
      const browser = this.browser; if (!browser) return;
      browser.history.replaceState(this.stateWithIndex(browser.history.state), '', path); this.publish();
      browser.dispatchEvent(new PopStateEvent('popstate', { state: browser.history.state }));
    }, options);
  }
  back(options?: NavigationOptions): void {
    this.admit(() => { if (this.browser) {
      const href = this.knownHrefs.get(this.index - 1);
      this.bypassPop = href ? { href, index: this.index - 1 } : null;
      this.browser.history.back();
    } }, options);
  }
  private admit(commit: () => void, options?: NavigationOptions): void {
    // A displayed decision belongs to one destination. A duplicate click must
    // not retire it or silently retarget a Save/Discard/Stay confirmation.
    if (!options?.bypassGuards && (this.awaitingEpoch !== null || this.restoring)) return;
    const epoch = ++this.epoch;
    if (options?.bypassGuards) {
      this.awaitingEpoch = null; this.restoring = null; this.bypassPop = null;
      this.index = this.readIndex(this.browser?.history.state) ?? this.index;
      this.commit(commit); return;
    }
    if (!this.guards.size) { this.commit(commit); return; }
    this.awaitingEpoch = epoch;
    void this.check(epoch).then(accepted => { if (accepted && epoch === this.epoch) this.commit(commit); }).finally(() => {
      if (this.awaitingEpoch === epoch) this.awaitingEpoch = null;
    });
  }
  private async check(epoch: number): Promise<boolean> {
    try {
      for (const guard of [...this.guards]) {
        if (!await guard() || epoch !== this.epoch) return false;
      }
      return epoch === this.epoch;
    } catch { if (epoch === this.epoch) this.reportFailure(); return false; }
  }
  private attach(): void {
    if (!this.browser || this.attached) return;
    const state = this.browser.history.state;
    this.index = this.readIndex(state) ?? 0;
    this.knownHrefs.set(this.index, this.href);
    this.browser.history.replaceState(this.stateWithIndex(state), '', this.browser.location.href);
    this.browser.addEventListener('popstate', this.onPop, true); this.attached = true;
  }
  private detach(): void {
    this.browser?.removeEventListener('popstate', this.onPop, true);
    this.attached = false; ++this.epoch; this.awaitingEpoch = null;
  }
  private readonly onPop = (event: PopStateEvent): void => {
    const browser = this.browser; if (!browser) return;
    if (this.restoring) {
      const restore = this.restoring;
      // Suppress the temporary rollback event. The mounted page has never changed.
      // Equal URLs can be different history entries (e.g. settings→list→settings).
      // Rapid browser traversals may move again before the first rollback arrives.
      const actualIndex = this.readIndex(event.state);
      if (browser.location.href !== this.href || actualIndex !== this.index) {
        event.stopImmediatePropagation();
        if (actualIndex !== null && actualIndex !== this.index) browser.history.go(this.index - actualIndex);
        return;
      }
      event.stopImmediatePropagation(); this.restoring = null;
      if (!restore.resumeGuard) return;
      const epoch = ++this.epoch;
      this.awaitingEpoch = epoch;
      void this.check(epoch).then(accepted => {
        if (accepted && epoch === this.epoch) {
          this.bypassPop = { href: restore.target, index: restore.index }; browser.history.go(restore.delta);
        }
      }).finally(() => { if (this.awaitingEpoch === epoch) this.awaitingEpoch = null; });
      return;
    }
    if (this.bypassPop && this.bypassPop.href === browser.location.href
      && this.bypassPop.index === this.readIndex(event.state)) {
      this.bypassPop = null; this.index = this.readIndex(event.state) ?? this.index;
      this.publish(); return;
    }
    this.bypassPop = null;
    const targetIndex = this.readIndex(event.state), delta = targetIndex === null ? null : targetIndex - this.index;
    if (this.guards.size && delta !== null && delta !== 0) {
      event.stopImmediatePropagation();
      const resumeGuard = this.awaitingEpoch === null;
      if (resumeGuard) ++this.epoch;
      this.restoring = { target: browser.location.href, index: targetIndex!, delta, resumeGuard };
      browser.history.go(-delta); return;
    }
    // History outside this provider cannot be replayed safely; full-document
    // departures retain the native beforeunload boundary, never a fake custom modal.
    this.index = targetIndex ?? this.index; this.publish();
  };
  private publish(): void {
    if (!this.browser) return;
    this.href = this.browser.location.href; this.pathname = this.browser.location.pathname;
    this.knownHrefs.set(this.index, this.href);
    for (const callback of this.listeners) callback();
  }
  private commit(callback: () => void): void {
    try { callback(); } catch { this.reportFailure(); }
  }
  private readIndex(state: unknown): number | null {
    if (!state || typeof state !== 'object') return null;
    const value = (state as Record<string, unknown>)[INDEX];
    return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
  }
  private stateWithIndex(state: unknown): Record<string, unknown> {
    return { ...(state && typeof state === 'object' ? state : {}), [INDEX]: this.index };
  }
}
