/** One lifecycle-owned browser activity collector. Records signals/durations, never clipboard contents, keys or raw URLs. */
import type { LoggingClient, LoggingCollectionPolicy, LoggingObservation } from '../../logging/logging-api-contracts';
import { LOGGING_BROWSER_ACTIONS } from '../../logging/logging-api-contracts';
import type { LoggingAdmissionReceipt } from '../../logging/logging-admission-contracts';
import type { LoggingResultReceipt } from '../../logging/logging-result-contracts';
import { isLoggingResultReceipt } from '../../logging/logging-result-shape';
export type LoggingResultBinding = LoggingResultReceipt | Promise<LoggingResultReceipt | null>;
export type LoggingResultInteraction = Extract<LoggingObservation['action'], `clipboard.${string}` | `print.${string}`>;
const pendingResult = (value: LoggingResultBinding): value is Promise<LoggingResultReceipt | null> => value instanceof Promise;

export interface LoggingCollector {
  readonly capturesViews: boolean;
  /** Component-owned lifetime. Closing one view never resets another mounted record. */
  bindView(value: { type: string; id: string }): Readonly<{ close(): void }>;
  /** A mounted component's actual displayed result. Updates revise that view; prefetches must never be bound. */
  bindResult(value: LoggingResultBinding): Readonly<{ update(value: LoggingResultBinding): void; action(action: LoggingResultInteraction): void; pause(): void; close(): void }>;
  /** Called after route content commits. Identity is compared in memory only and never transmitted. */
  navigation(pattern: string, identity: string): void;
  /** @deprecated Use bindView(); this compatibility owner no longer replaces the page/other views. */
  target(value: { type: string; id: string } | null): void;
  action(action: LoggingObservation['action']): void;
  flush(): Promise<void>;
  diagnostics(): Readonly<{ queued: number; dropped: number; failed: number; stopped: boolean; incomplete: boolean }>;
  /** A required native display binding failed. A later heartbeat cannot conceal missing display evidence. */
  reportFailure(): void;
  stop(): Promise<void>;
}

/** Mount once per authenticated scope. No localStorage, unload guarantee, clipboard interception or print-success claim. */
export function createLoggingCollector(client: Pick<LoggingClient, 'bindObservations'>, policy: LoggingCollectionPolicy,
  options: { target?: { type: string; id: string }; pageViews?: boolean; committedNavigation?: boolean; window?: Window; document?: Document; now?: () => number; onError?: (error: unknown) => void; onAcknowledgment?: (receipt: LoggingAdmissionReceipt) => void } = {}): LoggingCollector {
  if (!Number.isSafeInteger(policy.heartbeatMs) || policy.heartbeatMs < 10000 || policy.heartbeatMs > 60000
    || !Number.isSafeInteger(policy.idleMs) || policy.idleMs < 1000 || policy.idleMs > 300000) throw new Error('Invalid logging collection policy.');
  const writer = client.bindObservations();
  const win = options.window ?? window, doc = options.document ?? document, now = options.now ?? (() => performance.now());
  const collectorId = crypto.randomUUID(); let viewId = crypto.randomUUID(), sequence = 0, target = options.target ?? { type: 'page', id: 'application' };
  let committedPage: string | null = null;
  let last = now(), interaction = last, visibleMs = 0, activeMs = 0, elapsedMs = 0, stopped = false, dropped = 0, failed = 0;
  let visible = doc.visibilityState !== 'hidden' && doc.hasFocus(), href = win.location.href, suspended = false;
  let pending: LoggingObservation[] = [], running: Promise<void> | null = null, stopTask: Promise<void> | null = null;
  const deferredResults = new WeakMap<LoggingObservation, Promise<LoggingResultReceipt | null>>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null, incomplete = false;
  const subscriptions: (() => void)[] = [];
  interface OwnedView { id: string; sequence: number; target: { type: string; id: string }; receipt?: LoggingResultBinding; last: number; elapsed: number; visible: number; active: number; incomplete: boolean; paused: boolean }
  const views = new Set<OwnedView>(); let compatibilityView: Readonly<{ close(): void }> | null = null;
  const enabled = (action: LoggingObservation['action']) => policy.enabled && policy.capture[LOGGING_BROWSER_ACTIONS[action]];
  const reportFailure = () => { if (incomplete || stopped) return; incomplete = true; failed++; options.onError?.(new Error('Native audit display evidence could not be confirmed.')); };
  const lose = (count: number) => {
    dropped += count;
    if (!count || !policy.delivery?.required || incomplete) return;
    // A later successful heartbeat cannot prove observations which were lost.
    // Only a new collector/recovery lifetime may resume admission presentation.
    incomplete = true; failed++; options.onError?.(new Error('Required audit observations were lost; restart audit collection.'));
  };
  const enqueue = (action: LoggingObservation['action'], interval?: LoggingObservation['interval'], subject = target, receipt?: LoggingResultBinding, page?: string) => {
    if (suspended || !enabled(action)) return;
    if (pending.length >= 128) { lose(1); return; }
    const observation: LoggingObservation = { id: crypto.randomUUID(), collectorId, action,
      ...(page ? { page } : receipt ? pendingResult(receipt) ? {} : { receiptId: receipt.id } : { target: { ...subject } }), occurredAt: Date.now(), ...(interval ? { interval } : {}) };
    if (receipt && pendingResult(receipt)) deferredResults.set(observation, receipt);
    pending.push(observation);
    // Batch meaningful observations promptly; the heartbeat is only the upper
    // bound for control renewal, not a delay before recording a newly opened view.
    if (!flushTimer && !stopped) flushTimer = setTimeout(() => { flushTimer = null; void flush(); }, 250);
  };
  const accountView = (view: OwnedView) => {
    if (view.paused) { view.last = now(); return; }
    const current = now(), delta = current - view.last, bounded = Math.max(0, Math.min(60000, delta));
    view.incomplete ||= delta < 0 || delta > 60000;
    view.elapsed += bounded;
    if (visible) { view.visible += bounded; view.active += Math.max(0, Math.min(bounded, interaction + policy.idleMs - view.last)); }
    view.last = current;
  };
  const observeView = (view: OwnedView, action: 'view.opened' | 'view.interval' | 'view.closed' | 'view.result.changed') => {
    if (action === 'view.opened') view.last = now(); else accountView(view);
    enqueue(action, { viewId: view.id, sequence: view.sequence++, elapsedMs: Math.min(60000, Math.round(view.elapsed)),
      visibleMs: Math.min(60000, Math.round(view.visible)), activeMs: Math.min(60000, Math.round(view.active)),
      incomplete: view.incomplete || view.elapsed > 60000 }, view.target, view.receipt);
    view.elapsed = view.visible = view.active = 0; view.incomplete = false;
  };
  const bindOwnedView = (value: { type: string; id: string }, receipt?: LoggingResultBinding) => {
    if (stopped || !enabled('view.opened')) return Object.freeze({ update(_value: LoggingResultBinding) {}, action(_action: LoggingResultInteraction) {}, pause() {}, close() {} });
    if (views.size >= 16) { const error = new Error('Audit view capacity is exhausted.'); options.onError?.(error); throw error; }
    const view: OwnedView = { id: crypto.randomUUID(), sequence: 0, target: { ...value }, receipt, last: now(), elapsed: 0, visible: 0, active: 0, incomplete: false, paused: false };
    views.add(view); if (!suspended) observeView(view, 'view.opened');
    return Object.freeze({
      update(next: LoggingResultBinding) {
        if (!views.has(view) || stopped) return;
        if (!view.receipt || !pendingResult(next) && !isLoggingResultReceipt(next)
          || !pendingResult(next) && !pendingResult(view.receipt) && (next.kind !== view.receipt.kind || next.table !== view.receipt.table)) throw new Error('Invalid displayed-result revision.');
        const same = view.receipt === next || !pendingResult(next) && !pendingResult(view.receipt) && view.receipt.id === next.id;
        if (same && !view.paused) return;
        if (!suspended && !view.paused) observeView(view, 'view.interval');
        view.paused = false; view.last = now();
        view.receipt = pendingResult(next) ? next : Object.freeze({ ...next });
        if (!suspended && !same) observeView(view, 'view.result.changed');
      },
      pause() { if (!views.has(view) || stopped || view.paused) return; if (!suspended) observeView(view, 'view.interval'); view.paused = true; },
      action(action: LoggingResultInteraction) { if (views.has(view) && !view.paused && !stopped && ['clipboard', 'printing'].includes(LOGGING_BROWSER_ACTIONS[action])) enqueue(action, undefined, view.target, view.receipt); },
      close() { if (!views.delete(view)) return; if (!stopped && !suspended) observeView(view, 'view.closed'); void flush(); },
    });
  };
  const bindView = (value: { type: string; id: string }) => bindOwnedView(value);
  const account = () => {
    for (const view of views) accountView(view);
    const current = now(), rawDelta = current - last, delta = Math.max(0, rawDelta);
    // Missing sleep/unload tails are not fabricated as observed attention.
    const bounded = Math.min(60000, delta);
    elapsedMs += bounded;
    if (visible) { visibleMs += bounded; activeMs += Math.max(0, Math.min(bounded, interaction + policy.idleMs - last)); }
    last = current; return rawDelta < 0 || delta > 60000;
  };
  const interval = (action: 'view.interval' | 'view.closed') => {
    const incomplete = account() || elapsedMs > 60000;
    if (options.pageViews !== false) enqueue(action, { viewId, sequence: sequence++, elapsedMs: Math.min(60000, Math.round(elapsedMs)), visibleMs: Math.min(60000, Math.round(visibleMs)), activeMs: Math.min(60000, Math.round(activeMs)), incomplete });
    elapsedMs = visibleMs = activeMs = 0;
  };
  const opened = () => { if (options.pageViews !== false) enqueue('view.opened', { viewId, sequence: sequence++, elapsedMs: 0, visibleMs: 0, activeMs: 0, incomplete: false }); };
  const flush = (): Promise<void> => {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (running) return running;
    running = (async () => {
      let heartbeat = Boolean(policy.delivery?.required);
      let acknowledgment: LoggingAdmissionReceipt | undefined;
      while (pending.length || heartbeat) {
        const fresh = pending.filter(event => Date.now() - event.occurredAt <= 300000);
        lose(pending.length - fresh.length); pending = fresh;
        if (!pending.length && !heartbeat) break;
        const batch = pending.slice(0, 32);
        try {
          // A quick filter/close is still an actual committed display. Resolve its
          // opaque selection later without changing timestamps, sequence or duration.
          const observations = await Promise.all(batch.map(async observation => {
            const deferred = deferredResults.get(observation); if (!deferred) return observation;
            let timeout: ReturnType<typeof setTimeout> | undefined;
            try {
              const receipt = await Promise.race([deferred, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Displayed result acknowledgment timed out.')), 15000); })]);
              if (!receipt || !isLoggingResultReceipt(receipt)) throw new Error('Displayed result evidence is unavailable.');
              return { ...observation, receiptId: receipt.id };
            } finally { clearTimeout(timeout); }
          }));
          const result = await writer.observe(observations, policy.delivery ? { policyVersion: policy.delivery.policyVersion } : undefined);
          if (policy.delivery) {
            if (policy.delivery.required && result.accepted !== batch.length) throw new Error('Required audit observations were not fully acknowledged.');
            if (!result.admission || result.admission.policyVersion !== policy.delivery.policyVersion || result.admission.expiresAt <= Date.now()) throw new Error('Audit delivery was not acknowledged.');
            acknowledgment = result.admission;
          }
          pending.splice(0, batch.length); heartbeat = false;
        }
        catch (error) { acknowledgment = undefined; failed++; options.onError?.(error); break; }
      }
      // A successful prefix is not durable capture of the remaining queue.
      if (acknowledgment && !incomplete && !pending.length) options.onAcknowledgment?.(acknowledgment);
    })().finally(() => { running = null; });
    return running;
  };
  const listen = (object: Window | Document, name: string, handler: () => void) => { object.addEventListener(name, handler, { passive: true }); subscriptions.push(() => object.removeEventListener(name, handler)); };
  const setVisibility = () => { if (stopped || suspended) return; interval('view.interval'); for (const view of views) observeView(view, 'view.interval'); visible = doc.visibilityState !== 'hidden' && doc.hasFocus(); void flush(); };
  for (const event of ['pointerdown', 'keydown', 'touchstart']) listen(doc, event, () => { if (stopped || suspended) return; account(); interaction = now(); });
  listen(doc, 'copy', () => enqueue('clipboard.copy.observed'));
  listen(doc, 'visibilitychange', setVisibility); listen(win, 'focus', setVisibility); listen(win, 'blur', setVisibility);
  listen(win, 'beforeprint', () => { if (!suspended) { enqueue('print.requested'); void flush(); } });
  listen(win, 'afterprint', () => { if (!suspended) { enqueue('print.dialog.closed'); void flush(); } });
  listen(win, 'pagehide', () => { if (suspended) return; interval('view.closed'); for (const view of views) observeView(view, 'view.closed'); suspended = true; void flush(); });
  listen(win, 'pageshow', () => { if (suspended) {
    suspended = false; last = interaction = now(); elapsedMs = visibleMs = activeMs = 0;
    viewId = crypto.randomUUID(); sequence = 0; href = win.location.href; visible = doc.visibilityState !== 'hidden' && doc.hasFocus(); opened();
    for (const view of views) {
      view.id = crypto.randomUUID(); view.sequence = 0; view.last = last;
      view.elapsed = view.visible = view.active = 0; view.incomplete = false; observeView(view, 'view.opened');
    }
  } });
  // Zero's router publishes popstate only after navigation admission. Native
  // Back/Forward can use the same signal; only pathname changes are compared
  // in memory only, never copied into evidence. A duplicate browser signal is
  // not a second navigation. Keep the heartbeat as a fallback for integrations
  // which change history without publishing a navigation event.
  const navigation = () => {
    if (options.committedNavigation) return false;
    if (stopped || suspended || win.location.href === href) return false;
    const previous = new URL(href).pathname; href = win.location.href;
    if (new URL(href).pathname === previous) return false;
    interval('view.closed'); viewId = crypto.randomUUID(); sequence = 0;
    enqueue('navigation.changed'); opened(); void flush(); return true;
  };
  listen(win, 'popstate', navigation); listen(win, 'hashchange', navigation);
  const timer = setInterval(() => {
    if (stopped || suspended) return;
    if (!navigation()) interval('view.interval');
    for (const view of views) if (!view.paused) observeView(view, 'view.interval');
    void flush();
  }, policy.heartbeatMs);
  opened();
  return Object.freeze({
    capturesViews: enabled('view.opened'),
    bindView,
    navigation(pattern: string, identity: string) {
      if (stopped || suspended || committedPage === identity) return;
      committedPage = identity; enqueue('navigation.changed', undefined, target, undefined, pattern);
    },
    bindResult(receipt: LoggingResultBinding) {
      if (!pendingResult(receipt) && !isLoggingResultReceipt(receipt)) throw new Error('Invalid displayed-result receipt.');
      return bindOwnedView({ type: 'result', id: pendingResult(receipt) ? 'pending' : receipt.id }, pendingResult(receipt) ? receipt : Object.freeze({ ...receipt }));
    },
    target(value: { type: string; id: string } | null) { compatibilityView?.close(); compatibilityView = value ? bindView(value) : null; },
    action(action: LoggingObservation['action']) { if (!stopped && Object.hasOwn(LOGGING_BROWSER_ACTIONS, action)) enqueue(action); },
    flush,
    reportFailure,
    diagnostics() { return Object.freeze({ queued: pending.length, dropped, failed, stopped, incomplete }); },
    stop() {
      if (stopTask) return stopTask;
      stopped = true; if (!suspended) { interval('view.closed'); for (const view of views) observeView(view, 'view.closed'); }
      views.clear(); clearInterval(timer); if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; } subscriptions.forEach(remove => remove());
      stopTask = flush().finally(() => { dropped += pending.length; pending = []; }); return stopTask;
    },
  });
}
