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
/** AppProvider mounts this only for configured logging. Collection starts after live session/scope admission. */
export function LoggingActivityProvider({ children, required = false, policyVersion }: { children?: ReactNode; required?: boolean; policyVersion?: string }) {
  const client = useClientMaybe(), scope = useAuthorizationScopeBoundary(client);
  const [value, setValue] = useState<{ key: string; collector: LoggingCollector } | null>(null);
  const [confirmed, setConfirmed] = useState<{ key: string; expiresAt: number } | null>(null);
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
    void bootstrapLoggingDelivery(policyVersion, abort.signal).then(() => {
      if (!abort.signal.aborted && auth.authorizationScopeKey === family && auth.sessionTransition.revision === revision) (client as InternalClient)._syncClient.reconnect();
    }).catch(() => { if (!abort.signal.aborted) emitFrontendCode(OBS_CODES.LOGGING_BROWSER_FAILED); });
    return () => abort.abort();
  }, [client, auth, scope.key, policyVersion, required, retry]);
  useEffect(() => {
    if (!client || !canCollect) return;
    const abort = new AbortController(); let collector: LoggingCollector | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    // Pin before fetching policy, not after a possible identity replacement.
    const writer = client.logging.bindObservations();
    void client.logging.collectionPolicy({ signal: abort.signal }).then(policy => {
      if (abort.signal.aborted || !policy.enabled) return;
      if (required && !policy.delivery?.required) throw new Error('Required audit delivery policy is unavailable.');
      collector = createLoggingCollector({ bindObservations: () => writer }, policy, {
        onError: () => {
          if (abort.signal.aborted) return;
          setConfirmed(null); emitFrontendCode(OBS_CODES.LOGGING_BROWSER_FAILED);
        },
        onAcknowledgment: receipt => {
          if (abort.signal.aborted) return;
          clearTimeout(expiry);
          setConfirmed({ key: scope.key, expiresAt: receipt.expiresAt });
          expiry = setTimeout(() => { if (!abort.signal.aborted) setConfirmed(null); }, Math.max(0, receipt.expiresAt - Date.now()));
        },
      });
      setValue({ key: scope.key, collector });
      if (policy.delivery?.required) void collector.flush();
    }).catch(() => { if (!abort.signal.aborted) emitFrontendCode(OBS_CODES.LOGGING_BROWSER_FAILED); });
    return () => { abort.abort(); clearTimeout(expiry); void collector?.stop(); };
  }, [client, scope.key, canCollect, required, retry]);
  const pause = required && Boolean(auth?.isAuthenticated)
    && (!scope.stable || confirmed?.key !== scope.key || confirmed.expiresAt <= Date.now());
  return createElement(CollectorContext.Provider, { value: scope.ready && scope.stable && value?.key === scope.key ? value.collector : null }, pause
    ? <section role="alert" aria-label="Audit delivery required" className="mx-auto my-8 max-w-lg rounded-xl border bg-card p-6 text-card-foreground">
        <h1 className="text-lg font-semibold">Confirm audit delivery</h1>
        <p className="my-3 text-sm text-muted-foreground">Protected work is paused until audit delivery is confirmed. Check your connection, service status, or extensions blocking requests to this site, then retry.</p>
        <Button type="button" variant="outline" onClick={() => setRetry(n => n + 1)}>Retry audit delivery</Button>
      </section>
    : children);
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
