'use client';
/** Auth-generation owned React collection and evidence bindings; SDK owns transport and the server owns identity. */
import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useClientMaybe } from './client-context';
import { useAuthorizationScopeBoundary } from './authorization-scope-hooks';
import { createLoggingCollector, type LoggingCollector } from './logging-collector';
import type { LoggingPage, LoggingQuery, LoggingStream } from '../../logging/logging-contracts';
import { emitFrontendCode } from './observability';
import { OBS_CODES } from '../../observability/codes';
import type { InternalClient } from './sdk';
import { Button } from '../../components/ui/button';
import { bootstrapLoggingDelivery } from './logging-bootstrap';

const CollectorContext = createContext<LoggingCollector | null>(null);
const DeliveryContext = createContext<{ readonly paused: boolean; readonly failed: boolean; readonly retry: () => void } | null>(null);
interface LoggingActivityProviderProps { children?: ReactNode; required?: boolean; policyVersion?: string }
/** Standalone guarded composition. AppProvider uses the same owner/gate with persistent session-recovery ownership. */
export function LoggingActivityProvider({ children, ...options }: LoggingActivityProviderProps) {
  return createElement(LoggingActivityOwner, { ...options, children: createElement(LoggingDeliveryGuard, { children }) });
}

/** @internal Persistent collector owner. AppProvider keeps session recovery outside the presentation-only delivery gate. */
export function LoggingActivityOwner({ children, required = false, policyVersion }: LoggingActivityProviderProps) {
  const client = useClientMaybe(), scope = useAuthorizationScopeBoundary(client);
  const [value, setValue] = useState<{ key: string; collector: LoggingCollector } | null>(null);
  const [confirmed, setConfirmed] = useState<{ key: string; expiresAt: number } | null>(null);
  const [failure, setFailure] = useState<{ key: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const auth = (client as InternalClient | null)?.auth;
  // The write-only handshake proves live server authority itself. It must not
  // wait for a Sync baseline which requires this very grant. All protected
  // reads/UI remain under their unchanged authorization-data guards.
  const canCollect = Boolean(auth?.isAuthenticated && !auth.isRestoring && scope.stable && (required || scope.ready));
  useEffect(() => {
    // A committed sign-in/scope switch may be waiting for a Sync baseline.
    // Recover only the fixed empty handshake through the HttpOnly page cookie;
    // no event content, application read or general API request is admitted here.
    if (!required || !policyVersion || !auth?.isAuthenticated || !['committed', 'reconciling', 'recovery-required'].includes(auth.sessionTransition.phase)) return;
    const abort = new AbortController();
    const family = auth.authorizationScopeKey, revision = auth.sessionTransition.revision;
    void bootstrapLoggingDelivery(policyVersion, AbortSignal.any([abort.signal, AbortSignal.timeout(15000)])).then(() => {
      if (!abort.signal.aborted && auth.authorizationScopeKey === family && auth.sessionTransition.revision === revision) (client as InternalClient)._syncClient.reconnect();
    }).catch(() => { if (!abort.signal.aborted) { setFailure({ key: scope.key }); emitFrontendCode(OBS_CODES.LOGGING_BROWSER_FAILED); } });
    return () => abort.abort();
  }, [client, auth, scope.key, policyVersion, required, retry]);
  useEffect(() => {
    if (!client || !canCollect) return;
    const abort = new AbortController(); let collector: LoggingCollector | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const fail = () => {
      if (abort.signal.aborted) return;
      setConfirmed(null); setFailure({ key: scope.key }); emitFrontendCode(OBS_CODES.LOGGING_BROWSER_FAILED);
    };
    // Pending is not failure, but an indefinitely stalled first handshake is
    // not healthy either. Keep protection closed and offer explicit recovery.
    const pendingDeadline = setTimeout(fail, 15000);
    // Pin before fetching policy, not after a possible identity replacement.
    const writer = client.logging.bindObservations();
    void client.logging.collectionPolicy({ signal: abort.signal }).then(policy => {
      if (abort.signal.aborted) return;
      if (!policy.enabled) {
        if (required) throw new Error('Required audit collection is unavailable.');
        clearTimeout(pendingDeadline); return;
      }
      if (required && !policy.delivery?.required) throw new Error('Required audit delivery policy is unavailable.');
      collector = createLoggingCollector({ bindObservations: () => writer }, policy, {
        onError: () => {
          clearTimeout(pendingDeadline); fail();
        },
        onAcknowledgment: receipt => {
          if (abort.signal.aborted) return;
          clearTimeout(pendingDeadline); clearTimeout(expiry); setFailure(null);
          setConfirmed({ key: scope.key, expiresAt: receipt.expiresAt });
          expiry = setTimeout(fail, Math.max(0, receipt.expiresAt - Date.now()));
        },
      });
      setValue({ key: scope.key, collector });
      if (!policy.delivery?.required) clearTimeout(pendingDeadline);
      if (policy.delivery?.required) void collector.flush();
    }).catch(() => { clearTimeout(pendingDeadline); fail(); });
    return () => { abort.abort(); clearTimeout(pendingDeadline); clearTimeout(expiry); void collector?.stop(); };
  }, [client, scope.key, canCollect, required, retry]);
  const pause = required && Boolean(auth?.isAuthenticated)
    && (!scope.stable || confirmed?.key !== scope.key || confirmed.expiresAt <= Date.now());
  const retryDelivery = useCallback(() => { setFailure(null); setRetry(n => n + 1); }, []);
  return createElement(CollectorContext.Provider, { value: scope.ready && scope.stable && value?.key === scope.key ? value.collector : null },
    createElement(DeliveryContext.Provider, { value: { paused: pause, failed: failure?.key === scope.key, retry: retryDelivery }, children }));
}

/** @internal Masks protected output without retiring either session recovery or its required collector. */
export function LoggingDeliveryGuard({ children }: { children?: ReactNode }) {
  const delivery = useContext(DeliveryContext);
  if (!delivery) throw new Error('Audit delivery guard requires its managed owner.');
  if (delivery.paused && !delivery.failed) return <p role="status" aria-label="Preparing secure workspace" aria-busy="true"
    className="mx-auto my-8 text-sm text-muted-foreground">Opening secure workspace…</p>;
  return delivery.paused
    ? <section role="alert" aria-label="Audit delivery required" className="mx-auto my-8 max-w-lg rounded-xl border bg-card p-6 text-card-foreground">
        <h1 className="text-lg font-semibold">Confirm audit delivery</h1>
        <p className="my-3 text-sm text-muted-foreground">Protected work is paused until audit delivery is confirmed. Check your connection, service status, or extensions blocking requests to this site, then retry.</p>
        <Button type="button" variant="outline" onClick={delivery.retry}>Retry audit delivery</Button>
      </section>
    : children;
}

/** Bind opaque record/document identity; no URL, label, text or clinical content is collected. */
export function useLoggingView(target: { type: string; id: string } | null): void {
  const collector = useContext(CollectorContext);
  useEffect(() => { collector?.target(target); return () => collector?.target(null); }, [collector, target?.type, target?.id]);
}

/** Explicit successful/failed clipboard integrations report observations, not server-confirmed data exfiltration. */
export function useLoggingActivity() {
  const collector = useContext(CollectorContext);
  return { collector, action: useCallback((action: Parameters<LoggingCollector['action']>[0]) => collector?.action(action), [collector]) };
}

/** Scoped server query hook: masks old scope data synchronously and retires stale async results. */
export function useLoggingEvents(stream: LoggingStream, query: LoggingQuery = {}) {
  const client = useClientMaybe(), scope = useAuthorizationScopeBoundary(client), queryKey = JSON.stringify(query);
  const key = JSON.stringify([scope.key, stream, queryKey]);
  const [result, setResult] = useState<{ key: string; page: LoggingPage | null; error: Error | null } | null>(null);
  const [revision, setRevision] = useState(0), live = useRef(key); live.current = key;
  useEffect(() => {
    if (!client || !scope.ready || !scope.stable) return;
    const abort = new AbortController();
    void client.logging.page(stream, JSON.parse(queryKey), { signal: abort.signal }).then(page => {
      if (!abort.signal.aborted && live.current === key) setResult({ key, page, error: null });
    }).catch(error => { if (!abort.signal.aborted && live.current === key) setResult({ key, page: null, error: error instanceof Error ? error : new Error('Logging query failed.') }); });
    return () => abort.abort();
  }, [client, scope.ready, scope.stable, key, queryKey, stream, revision]);
  const current = scope.ready && scope.stable && result?.key === key ? result : null;
  return { page: current?.page ?? null, error: current?.error ?? null, isLoading: !current,
    refresh: useCallback(() => setRevision(n => n + 1), []) };
}
