'use client';
/** React facade shared by chat/tool inspectors and full-page organisms. */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useClientMaybe } from './client-context';
import { useAuthorizationScopeBoundary, readAuthorizationScopeBoundaryKey } from './authorization-scope-hooks';
import type { InternalClient } from './sdk';
import { VectorVisualizationController } from './vector-visualization-controller';
import type { VectorVisualizationAdapter } from '../../vector/visualization-types';

const unavailable: VectorVisualizationAdapter = { get: async () => null, subscribe: () => () => {} };
const serverSnapshot = Object.freeze({ status: 'idle' as const, snapshot: null, error: null });
export interface UseVectorVisualizationOptions {
  /** Omit to use the managed authenticated SDK. */
  adapter?: VectorVisualizationAdapter;
  index?: string;
}
export function useVectorVisualization(operationId: string | null, options: UseVectorVisualizationOptions = {}) {
  const client = useClientMaybe();
  const boundary = useAuthorizationScopeBoundary(client);
  const adapter = useMemo(() => options.adapter ?? (options.index ? client?.vectorVisualizationFor(options.index) : client?.vectorVisualization) ?? unavailable,
    [options.adapter, options.index, client]);
  // A selected operation is a synchronous rendering/callback boundary, not only
  // an effect dependency. Never expose A's snapshot while rendering B.
  const controller = useMemo(() => new VectorVisualizationController(adapter), [adapter, boundary.key, operationId]);
  const current = useRef({ controller, key: boundary.key, adapter, operationId }); current.current = { controller, key: boundary.key, adapter, operationId };
  const mounted = useRef(false);
  const observation = useSyncExternalStore(controller.subscribe, controller.getSnapshot, () => serverSnapshot);
  const allowed = Boolean(options.adapter || client && boundary.ready);
  useEffect(() => { mounted.current = true; controller.attach(allowed ? operationId : null); return () => { mounted.current = false; controller.attach(null); }; }, [controller, operationId, allowed]);
  const requireCurrent = () => {
    const internal = client as InternalClient | null;
    if (!mounted.current || !allowed || current.current.controller !== controller || current.current.adapter !== adapter || current.current.operationId !== operationId
      || !options.adapter && readAuthorizationScopeBoundaryKey(internal?.auth ?? null, internal?._authorizationDataBoundary?.revision ?? 0) !== boundary.key) {
      throw new DOMException('Visualization selection or authority changed.', 'AbortError');
    }
    return controller;
  };
  return { ...(allowed ? observation : serverSnapshot),
    attach: (id: string | null) => requireCurrent().attach(id),
    search: (input: Parameters<VectorVisualizationController['search']>[0]) => requireCurrent().search(input),
    ingest: (input: Parameters<VectorVisualizationController['ingest']>[0]) => requireCurrent().ingest(input),
    cancel: () => requireCurrent().cancel() };
}
/** Alias emphasizes an observer-only binding in streamed tool/chat content. */
export const useVectorOperation = useVectorVisualization;
