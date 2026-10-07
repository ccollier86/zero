'use client';

/** Bind controlled matrix interactions to existing Zero authorization and error boundaries. */

import * as React from 'react';
import { readAuthorizationScopeBoundaryKey, useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import { isAuthorizationDataReady, isAuthorizationScopeReady } from '../../frontend/client/authorization-scope-readiness';
import { useClientMaybe } from '../../frontend/client/client-context';
import type { InternalClient } from '../../frontend/client/sdk';
import { emitFrontendCode } from '../../frontend/client/observability';
import { OBS_CODES } from '../../observability/codes';
import { SettingsMatrixController } from './settings-matrix-controller';
import { readSettingsMatrixCell, settingsMatrixCellIsEditable } from './settings-matrix-model';
import type { SettingsMatrixChange, SettingsMatrixProps } from './settings-matrix-types';

/** Reuse Guardian's lifetime when mounted in a provider; remain standalone/SSR safe. */
export function useSettingsMatrix(props: SettingsMatrixProps) {
  const client = useClientMaybe();
  const authorization = useAuthorizationScopeBoundary(client);
  const boundaryKey = JSON.stringify([authorization.key, props.scopeKey ?? null]);
  const cells = props.rows.flatMap((row) => props.columns.map((column) => readSettingsMatrixCell(props, row, column)));
  const editableKeys = new Set(cells.filter(settingsMatrixCellIsEditable).map((cell) => cell.key));
  const currentRef = React.useRef({ client, scopeKey: props.scopeKey, editableKeys });
  currentRef.current = { client, scopeKey: props.scopeKey, editableKeys };
  const readBoundary = () => {
    const current = currentRef.current;
    const internal = current.client as InternalClient | null;
    const auth = internal?.auth ?? null;
    const revision = internal?._authorizationDataBoundary?.revision ?? 0;
    return {
      key: JSON.stringify([readAuthorizationScopeBoundaryKey(auth, revision), current.scopeKey ?? null]),
      ready: auth ? isAuthorizationScopeReady(auth.sessionTransition, auth.isRestoring)
        && isAuthorizationDataReady(revision, auth.authorizationState.status, auth.isAuthenticated) : true,
    };
  };
  const controllerRef = React.useRef<SettingsMatrixController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new SettingsMatrixController({
      readBoundary,
      isEditable: (key) => currentRef.current.editableKeys.has(key),
      onFailure: () => emitFrontendCode(OBS_CODES.FRONTEND_MUTATION_FAILED, {
        metadata: { surface: 'settings-matrix', kind: 'cell', stage: 'mutation' },
      }),
    });
  }
  const controller = controllerRef.current;
  React.useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  React.useEffect(() => { controller.activate(); return () => controller.retire(); }, [controller]);
  React.useEffect(() => { controller.reconcile(); });
  const change = (key: string, next: SettingsMatrixChange) => {
    const live = readBoundary();
    if (!props.onChange || !live.ready || live.key !== boundaryKey) return;
    void controller.run(key, next, props.onChange);
  };
  return { cells, ready: authorization.ready, change,
    enabledCount: authorization.ready ? cells.filter((cell) => cell.checked === true).length : 0,
    editableCount: authorization.ready ? editableKeys.size : 0,
    isPending: (key: string) => controller.isPending(key),
    getError: (key: string) => controller.getError(key),
  };
}
