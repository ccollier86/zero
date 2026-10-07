'use client';

/** Bind Save/Discard/Stay to existing form state and Guardian; native unload remains browser-managed. */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useClientMaybe } from '../frontend/client/client-context';
import type { InternalClient } from '../frontend/client/sdk';
import { isAuthorizationDataReady, isAuthorizationScopeReady, readAuthorizationScopeBoundaryKey,
  useAuthorizationScopeBoundary } from '../frontend/client/authorization-scope-hooks';
import { emitFrontendCode } from '../frontend/client/observability';
import { OBS_CODES } from '../observability/codes';
import { useNavigationGuard } from '../frontend/client/router-context';
import { FormSaveController, type FormSaveAdapter } from './form-save-controller';

export interface UseFormSaveOptions {
  readonly form: FormSaveAdapter;
  readonly scopeKey?: string | number;
  /** Browser-managed close/reload warning; enabled by default for this opt-in hook. */
  readonly beforeUnload?: boolean;
  /** Join the optional RouterProvider guard; standalone/modal-only usage remains safe. */
  readonly guardNavigation?: boolean;
}

/** Compose with FormSaveBar/UnsavedChangesDialog; routing and persistence stay outside. */
export function useFormSave(options: UseFormSaveOptions) {
  const client = useClientMaybe(), boundary = useAuthorizationScopeBoundary(client);
  const latest = useRef({ options, client }); latest.current = { options, client };
  const ref = useRef<FormSaveController | null>(null);
  if (!ref.current) ref.current = new FormSaveController({
    readForm: () => latest.current.options.form,
    readBoundary: () => {
      const { client, options } = latest.current;
      const internal = client as InternalClient | null, auth = internal?.auth ?? null;
      const revision = internal?._authorizationDataBoundary?.revision ?? 0;
      return { key: JSON.stringify([readAuthorizationScopeBoundaryKey(auth, revision), options.scopeKey ?? null]),
        ready: !auth || isAuthorizationScopeReady(auth.sessionTransition, auth.isRestoring)
          && isAuthorizationDataReady(revision, auth.authorizationState.status, auth.isAuthenticated) };
    },
    onNotificationFailure: () => emitFrontendCode(OBS_CODES.FRONTEND_MUTATION_FAILED, { metadata: { surface: 'form-save', stage: 'notification' } }),
  });
  const controller = ref.current;
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useNavigationGuard(() => controller.requestLeave(() => {}), options.guardNavigation !== false
    && boundary.ready);
  useEffect(() => { controller.activate(); return () => controller.retire(); }, [controller]);
  useEffect(() => { controller.reconcile(); }, [boundary.key, boundary.ready, controller, options.scopeKey]);
  useEffect(() => {
    if (options.beforeUnload === false) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!controller.needsLeavePrompt()) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [controller, options.beforeUnload]);
  const save = useCallback(() => controller.save(), [controller]);
  const discard = useCallback(() => controller.discard(), [controller]);
  const requestLeave = useCallback((continuation: () => void | Promise<void>) => controller.requestLeave(continuation), [controller]);
  const chooseLeave = useCallback((choice: 'save' | 'discard' | 'stay') => controller.chooseLeave(choice), [controller]);
  return { ...state, error: state.error ?? options.form.submitError ?? null, isDirty: boundary.ready && options.form.isDirty,
    isSaving: state.saving || boundary.ready && options.form.isSubmitting,
    save, discard, requestLeave, chooseLeave };
}
export type UseFormSaveReturn = ReturnType<typeof useFormSave>;
