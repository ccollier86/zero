'use client';

/**
 * Owns acknowledged CRUD operation lifecycle and accepted-action callbacks.
 * Reuses the table mutation runner and SDK authorization boundary; it performs
 * no transport, database authorization, form rendering or modal composition.
 */

import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useClientMaybe } from '../../frontend/client/client-context';
import {
  isAuthorizationScopeCallbackCurrent,
  readAuthorizationScopeBoundaryKey,
  useAuthorizationScopeBoundary,
} from '../../frontend/client/authorization-scope-hooks';
import type { InternalClient } from '../../frontend/client/sdk';
import { emitFrontendCode } from '../../frontend/client/observability';
import { OBS_CODES } from '../../observability/codes';
import {
  useDataTableMutationRunner,
  mutationCancelledError,
  type DataTableMutationContext,
} from '../data-table/use-data-table-mutation';

export interface CrudMutationRunner {
  run(
    key: string,
    execute: (context: DataTableMutationContext) => void | Promise<void>,
    accepted?: () => unknown,
  ): Promise<void>;
  isPending(key: string): boolean;
}

/** Await a write, report safe failures once, and suppress stale accepted effects. */
export function useCrudMutation(boundaryKey: string): CrudMutationRunner {
  const client = useClientMaybe();
  const boundary = useAuthorizationScopeBoundary(client);
  const currentKey = useRef(boundary.key);
  const ready = useRef(boundary.ready);
  currentKey.current = boundary.key;
  ready.current = boundary.ready;
  const capturedKey = boundary.key;
  const mounted = useRef(true), incarnation = useRef({ key: JSON.stringify([capturedKey, boundaryKey]), token: {} });
  const targetKey = JSON.stringify([capturedKey, boundaryKey]);
  if (incarnation.current.key !== targetKey) incarnation.current = { key: targetKey, token: {} };
  const token = incarnation.current.token;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const runner = useDataTableMutationRunner({ boundaryKey });
  const run = useCallback((
    key: string,
    execute: (context: DataTableMutationContext) => void | Promise<void>,
    accepted?: () => unknown,
  ) => runner.run({
    key,
    kind: 'row',
    execute: async (context) => {
      const isCurrent = () => {
        const internal = client as InternalClient | null;
        return mounted.current && incarnation.current.token === token && !context.signal.aborted
          && isAuthorizationScopeCallbackCurrent(currentKey.current, ready.current, capturedKey)
          && readAuthorizationScopeBoundaryKey(internal?.auth ?? null, internal?._authorizationDataBoundary?.revision ?? 0) === capturedKey;
      };
      if (!isCurrent()) {
        throw mutationCancelledError();
      }
      await execute(context);
      // A parent can render the new auth boundary before effects have retired
      // the runner. Check its synchronous fence as well as cancellation.
      if (!isCurrent()) {
        throw mutationCancelledError();
      }
      const notificationFailed = () => {
        // The write was accepted. An app follow-up failure must not turn it
        // into a failed write that a retry could issue a second time.
        if (!isCurrent()) return;
        emitFrontendCode(OBS_CODES.FRONTEND_MUTATION_FAILED, {
          metadata: { surface: 'crud-page', stage: 'accepted-callback' },
        });
        toast.error('The record change was accepted, but a follow-up action failed.');
      };
      try { void Promise.resolve(accepted?.()).catch(notificationFailed); }
      catch { notificationFailed(); }
    },
  }), [capturedKey, runner, client, token]);
  return { run, isPending: runner.isPending };
}
