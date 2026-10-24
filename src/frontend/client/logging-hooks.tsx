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

const CollectorContext = createContext<LoggingCollector | null>(null);
/** AppProvider mounts this only for configured logging. Collection starts after live session/scope admission. */
export function LoggingActivityProvider({ children }: { children?: ReactNode }) {
  const client = useClientMaybe(), scope = useAuthorizationScopeBoundary(client);
  const [value, setValue] = useState<{ key: string; collector: LoggingCollector } | null>(null);
  useEffect(() => {
    if (!client || !(client as InternalClient).auth?.isAuthenticated || !scope.ready || !scope.stable) return;
    const abort = new AbortController(); let collector: LoggingCollector | undefined;
    // Pin before fetching policy, not after a possible identity replacement.
    const writer = client.logging.bindObservations();
    void client.logging.collectionPolicy({ signal: abort.signal }).then(policy => {
      if (abort.signal.aborted || !policy.enabled) return;
      collector = createLoggingCollector({ bindObservations: () => writer }, policy, {
        onError: () => emitFrontendCode(OBS_CODES.LOGGING_BROWSER_FAILED),
      });
      setValue({ key: scope.key, collector });
    }).catch(() => { if (!abort.signal.aborted) emitFrontendCode(OBS_CODES.LOGGING_BROWSER_FAILED); });
    return () => { abort.abort(); void collector?.stop(); };
  }, [client, scope.key, scope.ready, scope.stable]);
  return createElement(CollectorContext.Provider, { value: scope.ready && scope.stable && value?.key === scope.key ? value.collector : null }, children);
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
