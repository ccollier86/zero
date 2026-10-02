'use client';

/** Load the immutable, presentation-only topology pinned to one workflow run. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OBS_CODES } from '../../observability/codes';
import type { WorkflowPublicTopology } from '../../workflows/workflow-public-topology';
import { unwrap } from './api';
import { useAuthorizationScopeBoundary } from './authorization-scope-hooks';
import { shouldUseSsrFallback, useClientMaybe } from './client-context';
import { emitFrontendCode } from './observability';

export interface UseWorkflowTopologyResult {
  /** Sanitized immutable topology for the selected run. */
  topology: WorkflowPublicTopology | null;
  isLoading: boolean;
  error: unknown;
  /** Explicitly reload the same immutable resource after a transport failure. */
  reload(): void;
}

interface WorkflowTopologyState {
  key: string | null;
  topology: WorkflowPublicTopology | null;
  isLoading: boolean;
  error: unknown;
}

const EMPTY_STATE: WorkflowTopologyState = Object.freeze({
  key: null,
  topology: null,
  isLoading: false,
  error: null,
});

/**
 * Load safe topology through the authenticated workflow API.
 *
 * Topology is pinned for the lifetime of a run, so live status continues to
 * come from `useWorkflow()` while this hook performs one fenced HTTP read.
 */
export function useWorkflowTopology(
  instanceId: string | null,
): UseWorkflowTopologyResult {
  const client = useClientMaybe();
  const ssrFallback = shouldUseSsrFallback(client, 'useWorkflowTopology');
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const [reloadRevision, setReloadRevision] = useState(0);
  const [state, setState] = useState<WorkflowTopologyState>(EMPTY_STATE);
  const requestRevision = useRef(0);
  const canLoad = !ssrFallback
    && Boolean(instanceId)
    && authorizationBoundary.ready;
  const key = canLoad
    ? JSON.stringify([authorizationBoundary.key, instanceId])
    : null;

  useEffect(() => {
    const operation = ++requestRevision.current;
    if (!client || !instanceId || !key) {
      setState(EMPTY_STATE);
      return;
    }

    setState({ key, topology: null, isLoading: true, error: null });
    void (async () => {
      try {
        const topology: WorkflowPublicTopology = unwrap(
          await client.api.workflows[instanceId].topology.get(),
        );
        if (topology.instanceId !== instanceId) {
          throw new Error('Workflow topology response did not match the requested run.');
        }
        if (operation !== requestRevision.current) return;
        setState({ key, topology, isLoading: false, error: null });
      } catch (error) {
        if (operation !== requestRevision.current) return;
        emitFrontendCode(OBS_CODES.FRONTEND_WORKFLOW_TOPOLOGY_FAILED, {
          error,
          metadata: { action: 'load', instanceId },
        });
        setState({ key, topology: null, isLoading: false, error });
      }
    })();

    return () => {
      if (operation === requestRevision.current) requestRevision.current += 1;
    };
  }, [client, instanceId, key, reloadRevision]);

  const reload = useCallback(() => {
    if (key) setReloadRevision((revision) => revision + 1);
  }, [key]);
  const visible = state.key === key ? state : {
    key,
    topology: null,
    isLoading: key !== null,
    error: null,
  };

  return useMemo(() => ({
    topology: visible.topology,
    isLoading: visible.isLoading,
    error: visible.error,
    reload,
  }), [reload, visible.error, visible.isLoading, visible.topology]);
}
