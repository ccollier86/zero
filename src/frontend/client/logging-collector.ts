/** One lifecycle-owned browser activity collector. Records signals/durations, never clipboard contents, keys or raw URLs. */
import type { LoggingClient, LoggingCollectionPolicy, LoggingObservation } from '../../logging/logging-api-contracts';
import { LOGGING_BROWSER_ACTIONS } from '../../logging/logging-api-contracts';
import type { LoggingAdmissionReceipt } from '../../logging/logging-admission-contracts';

export interface LoggingCollector {
  target(value: { type: string; id: string } | null): void;
  action(action: LoggingObservation['action']): void;
  flush(): Promise<void>;
  diagnostics(): Readonly<{ queued: number; dropped: number; failed: number; stopped: boolean }>;
  stop(): Promise<void>;
}

/** Mount once per authenticated scope. No localStorage, unload guarantee, clipboard interception or print-success claim. */
export function createLoggingCollector(client: Pick<LoggingClient, 'bindObservations'>, policy: LoggingCollectionPolicy,
  options: { target?: { type: string; id: string }; window?: Window; document?: Document; now?: () => number; onError?: (error: unknown) => void; onAcknowledgment?: (receipt: LoggingAdmissionReceipt) => void } = {}): LoggingCollector {
  if (!Number.isSafeInteger(policy.heartbeatMs) || policy.heartbeatMs < 10000 || policy.heartbeatMs > 60000
    || !Number.isSafeInteger(policy.idleMs) || policy.idleMs < 1000 || policy.idleMs > 300000) throw new Error('Invalid logging collection policy.');
  const writer = client.bindObservations();
  const win = options.window ?? window, doc = options.document ?? document, now = options.now ?? (() => performance.now());
  const collectorId = crypto.randomUUID(); let viewId = crypto.randomUUID(), sequence = 0, target = options.target ?? { type: 'page', id: 'application' };
  let last = now(), interaction = last, visibleMs = 0, activeMs = 0, elapsedMs = 0, stopped = false, dropped = 0, failed = 0;
  let visible = doc.visibilityState !== 'hidden' && doc.hasFocus(), href = win.location.href, suspended = false;
  let pending: LoggingObservation[] = [], running: Promise<void> | null = null, stopTask: Promise<void> | null = null;
  const subscriptions: (() => void)[] = [];
  const enabled = (action: LoggingObservation['action']) => policy.enabled && policy.capture[LOGGING_BROWSER_ACTIONS[action]];
  const enqueue = (action: LoggingObservation['action'], interval?: LoggingObservation['interval']) => {
    if (!enabled(action)) return;
    if (pending.length >= 128) { dropped++; return; }
    pending.push({ id: crypto.randomUUID(), collectorId, action, target: { ...target }, occurredAt: Date.now(), ...(interval ? { interval } : {}) });
  };
  const account = () => {
    const current = now(), delta = Math.max(0, current - last);
    // Missing sleep/unload tails are not fabricated as observed attention.
    const bounded = Math.min(60000, delta);
    elapsedMs += bounded;
    if (visible) { visibleMs += bounded; activeMs += Math.max(0, Math.min(bounded, interaction + policy.idleMs - last)); }
    last = current; return delta > 60000;
  };
  const interval = (action: 'view.interval' | 'view.closed') => {
    const incomplete = account() || elapsedMs > 60000;
    enqueue(action, { viewId, sequence: sequence++, elapsedMs: Math.min(60000, Math.round(elapsedMs)), visibleMs: Math.min(60000, Math.round(visibleMs)), activeMs: Math.min(60000, Math.round(activeMs)), incomplete });
    elapsedMs = visibleMs = activeMs = 0;
  };
  const opened = () => enqueue('view.opened', { viewId, sequence: sequence++, elapsedMs: 0, visibleMs: 0, activeMs: 0, incomplete: false });
  const flush = (): Promise<void> => {
    if (running) return running;
    running = (async () => {
      let heartbeat = Boolean(policy.delivery?.required);
      while (pending.length || heartbeat) {
        const fresh = pending.filter(event => Date.now() - event.occurredAt <= 300000);
        dropped += pending.length - fresh.length; pending = fresh;
        if (!pending.length && !heartbeat) break;
        const batch = pending.slice(0, 32);
        try {
          const result = await writer.observe(batch, policy.delivery ? { policyVersion: policy.delivery.policyVersion } : undefined);
          if (policy.delivery) {
            if (!result.admission || result.admission.policyVersion !== policy.delivery.policyVersion || result.admission.expiresAt <= Date.now()) throw new Error('Audit delivery was not acknowledged.');
            options.onAcknowledgment?.(result.admission);
          }
          pending.splice(0, batch.length); heartbeat = false;
        }
        catch (error) { failed++; options.onError?.(error); break; }
      }
    })().finally(() => { running = null; });
    return running;
  };
  const listen = (object: Window | Document, name: string, handler: () => void) => { object.addEventListener(name, handler, { passive: true }); subscriptions.push(() => object.removeEventListener(name, handler)); };
  const setVisibility = () => { if (stopped) return; interval('view.interval'); visible = doc.visibilityState !== 'hidden' && doc.hasFocus(); void flush(); };
  for (const event of ['pointerdown', 'keydown', 'touchstart']) listen(doc, event, () => { if (stopped) return; account(); interaction = now(); });
  listen(doc, 'copy', () => enqueue('clipboard.copy.observed'));
  listen(doc, 'visibilitychange', setVisibility); listen(win, 'focus', setVisibility); listen(win, 'blur', setVisibility);
  listen(win, 'beforeprint', () => { enqueue('print.requested'); void flush(); });
  listen(win, 'afterprint', () => { enqueue('print.dialog.closed'); void flush(); });
  listen(win, 'pagehide', () => { if (!suspended) interval('view.closed'); suspended = true; void flush(); });
  listen(win, 'pageshow', () => { if (suspended) { suspended = false; last = interaction = now(); viewId = crypto.randomUUID(); sequence = 0; opened(); } });
  const timer = setInterval(() => {
    if (stopped || suspended) return;
    if (win.location.href !== href) { interval('view.closed'); href = win.location.href; viewId = crypto.randomUUID(); sequence = 0; enqueue('navigation.changed'); opened(); }
    else interval('view.interval');
    void flush();
  }, policy.heartbeatMs);
  opened();
  return Object.freeze({
    target(value: { type: string; id: string } | null) { if (stopped) return; interval('view.closed'); target = value ? { ...value } : { type: 'page', id: 'application' }; viewId = crypto.randomUUID(); sequence = 0; opened(); },
    action(action: LoggingObservation['action']) { if (!stopped && Object.hasOwn(LOGGING_BROWSER_ACTIONS, action)) enqueue(action); },
    flush,
    diagnostics() { return Object.freeze({ queued: pending.length, dropped, failed, stopped }); },
    stop() {
      if (stopTask) return stopTask;
      stopped = true; if (!suspended) interval('view.closed'); clearInterval(timer); subscriptions.forEach(remove => remove());
      stopTask = flush().finally(() => { dropped += pending.length; pending = []; }); return stopTask;
    },
  });
}
