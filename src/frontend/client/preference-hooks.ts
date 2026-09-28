/**
 * preference-hooks.ts
 *
 * Convenience hooks for user preferences and form drafts backed by Zero server
 * state sync. This file owns naming and UI state shape only; persistence and
 * cross-device synchronization remain in StateClient/useServerState.
 */

import { useCallback, useMemo, useRef } from 'react';
import type { JsonValue } from '../../sync/types';
import { useServerState } from '../../sync/client/state-hooks';
import {
  isAuthorizationScopeCallbackCurrent,
  useAuthorizationScopeBoundary,
} from './authorization-scope-hooks';
import { useClientMaybe } from './client-context';

type JsonObject = Record<string, JsonValue>;

export interface UsePreferenceResult<T extends JsonValue> {
  value: T;
  setValue: (value: T) => void;
  reset: () => void;
}

function stateKey(namespace: string, key: string): string {
  return `${namespace}.${key}`;
}

/**
 * Persist one user preference through server state sync.
 *
 * Requires `stateSync: true` on both `createApp()` and `AppProvider`.
 */
export function usePreference<T extends JsonValue>(
  key: string,
  defaultValue: T,
): UsePreferenceResult<T> {
  const client = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const [value, setServerValue] = useServerState<T>(stateKey('preferences', key), defaultValue);
  const boundaryKeyRef = useRef(authorizationBoundary.key);
  const boundaryReadyRef = useRef(authorizationBoundary.ready);
  boundaryKeyRef.current = authorizationBoundary.key;
  boundaryReadyRef.current = authorizationBoundary.ready;
  const callbackBoundaryKey = authorizationBoundary.key;
  const setValue = useCallback((nextValue: T) => {
    if (!isAuthorizationScopeCallbackCurrent(
      boundaryKeyRef.current,
      boundaryReadyRef.current,
      callbackBoundaryKey,
    )) return;
    setServerValue(nextValue);
  }, [callbackBoundaryKey, setServerValue]);
  const reset = useCallback(() => setValue(defaultValue), [defaultValue, setValue]);

  return useMemo(
    () => ({ value, setValue, reset }),
    [reset, setValue, value],
  );
}

export interface UseFormDraftOptions {
  namespace?: string;
}

export interface UseFormDraftResult<T extends JsonObject> {
  draft: T;
  setDraft: (draft: T) => void;
  updateDraft: (partial: Partial<T>) => void;
  setField: <K extends keyof T>(key: K, value: T[K]) => void;
  resetDraft: () => void;
}

/**
 * Persist one object-shaped form draft through server state sync.
 *
 * Use stable keys such as `client-intake` or `orders.edit.${orderId}` so drafts
 * survive navigation and sync across the signed-in user's devices.
 */
export function useFormDraft<T extends JsonObject>(
  key: string,
  initialValue: T,
  options: UseFormDraftOptions = {},
): UseFormDraftResult<T> {
  const client = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const namespace = options.namespace ?? 'drafts';
  const [draft, setServerDraft] = useServerState<T>(stateKey(namespace, key), initialValue);
  const boundaryKeyRef = useRef(authorizationBoundary.key);
  const boundaryReadyRef = useRef(authorizationBoundary.ready);
  boundaryKeyRef.current = authorizationBoundary.key;
  boundaryReadyRef.current = authorizationBoundary.ready;
  const callbackBoundaryKey = authorizationBoundary.key;
  const setDraft = useCallback((nextDraft: T) => {
    if (!isAuthorizationScopeCallbackCurrent(
      boundaryKeyRef.current,
      boundaryReadyRef.current,
      callbackBoundaryKey,
    )) return;
    setServerDraft(nextDraft);
  }, [callbackBoundaryKey, setServerDraft]);

  const updateDraft = useCallback(
    (partial: Partial<T>) => setDraft({ ...draft, ...partial }),
    [draft, setDraft],
  );

  const setField = useCallback(
    <K extends keyof T>(field: K, value: T[K]) => setDraft({ ...draft, [field]: value }),
    [draft, setDraft],
  );

  const resetDraft = useCallback(() => setDraft(initialValue), [initialValue, setDraft]);

  return useMemo(
    () => ({
      draft,
      setDraft,
      updateDraft,
      setField,
      resetDraft,
    }),
    [draft, resetDraft, setDraft, setField, updateDraft],
  );
}
