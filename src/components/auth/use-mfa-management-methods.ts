'use client';

/** Owns only current-capability MFA method loading, retry and late-result retirement. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AuthActions } from '../../frontend/client/auth-hooks';
import type { AuthMfaMethod } from '../../frontend/client/auth-client';
import { getAuthDisplayMessage, reportAuthUiError } from './auth-error';
import { MfaManagementRequestLifecycle } from './mfa-management-request';

interface MfaMethodState {
  readonly methods: readonly AuthMfaMethod[];
  readonly required: boolean;
  readonly loading: boolean;
  readonly error: string | null;
}

export function useMfaManagementMethods(
  listMfaMethods: AuthActions['listMfaMethods'],
  isCurrentScope: () => boolean,
) {
  const lifecycle = useMemo(() => new MfaManagementRequestLifecycle(isCurrentScope), [isCurrentScope]);
  const [state, setState] = useState<MfaMethodState>({ methods: [], required: false, loading: true, error: null });
  const reload = useCallback(async () => {
    const isCurrent = lifecycle.begin();
    if (!isCurrent) return;
    setState(current => ({ ...current, loading: true, error: null }));
    try {
      const result = await listMfaMethods();
      if (!isCurrent()) return;
      if (!result) throw new Error('MFA settings response was unavailable.');
      setState({ methods: result.methods, required: result.required, loading: false, error: null });
    } catch (cause) {
      if (!isCurrent()) return;
      reportAuthUiError('listMfaMethods', cause);
      setState({ methods: [], required: false, loading: false,
        error: getAuthDisplayMessage(cause, 'Failed to load MFA settings') });
    }
  }, [lifecycle, listMfaMethods]);
  useEffect(() => {
    lifecycle.activate();
    void reload();
    return () => lifecycle.retire();
  }, [lifecycle, reload]);
  return { ...state, reload };
}
