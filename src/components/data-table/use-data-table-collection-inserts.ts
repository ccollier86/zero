'use client';

/** Distinguish admitted collection INSERTs from hydration/replacement snapshots. */
import * as React from 'react';
import type { InternalClient } from '../../frontend/client/sdk';
import { readAuthorizationScopeBoundaryKey, isAuthorizationDataReady, isAuthorizationScopeReady } from '../../frontend/client/authorization-scope-hooks';
import { readDataTableSyncChange, DATA_TABLE_SERVER_MAX_INSERT_EVIDENCE } from './data-table-server-changes';

export function useDataTableCollectionInserts(client: InternalClient | null, table: string | null,
  authorityKey: string, ready: boolean, queryKey: string) {
  const key = JSON.stringify([authorityKey, table, ready, queryKey]);
  const [evidence, setEvidence] = React.useState<{ key: string; ids: readonly string[] }>({ key, ids: [] });
  const current = React.useRef(key); current.current = key;
  if (evidence.key !== key) setEvidence({ key, ids: [] });
  React.useEffect(() => {
    if (!client?._syncClient || !table || !ready) return;
    let live = true;
    const unsubscribe = client._syncClient.onMessage(message => {
      const auth = client.auth, revision = client._authorizationDataBoundary?.revision ?? 0;
      if (!live || current.current !== key || readAuthorizationScopeBoundaryKey(auth, revision) !== authorityKey) return;
      if (auth && (!isAuthorizationScopeReady(auth.sessionTransition, auth.isRestoring)
        || !isAuthorizationDataReady(revision, auth.authorizationState.status, auth.isAuthenticated))) return;
      const change = readDataTableSyncChange(message, table);
      if (!change || change.op === 'UPDATE') return;
      setEvidence(value => value.key !== key ? value : { key, ids: change.op === 'DELETE'
        ? value.ids.filter(id => id !== change.rowId)
        : [...new Set([...value.ids, change.rowId])].slice(-DATA_TABLE_SERVER_MAX_INSERT_EVIDENCE) });
    });
    return () => { live = false; unsubscribe(); };
  }, [client, table, authorityKey, ready, key]);
  return evidence.key === key ? evidence.ids : [];
}
