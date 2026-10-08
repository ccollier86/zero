'use client';

/** Projects existing custom admin form state into its owned shell, without owning persistence. */
import { useEffect, useRef } from 'react';
import type { ModalContext } from '../../../modals/modal-system.types';
import { bindModalFormState } from '../../../modals/modal-form';
import { emitFrontendCode } from '../../../frontend/client/observability';
import { OBS_CODES } from '../../../observability/codes';

/** Custom admin forms retain their validation/state; modal bindings own only view state. */
export function useAdminModalFormState(context: ModalContext<void> | undefined, state: {
  readonly dirty: boolean; readonly busy: boolean; readonly error: string | null;
}) {
  const binding = useRef<ReturnType<typeof bindModalFormState> | null>(null);
  useEffect(() => {
    if (!context) return;
    const next = bindModalFormState(context as unknown as ModalContext<unknown>);
    binding.current = next;
    return () => { next.dispose(); if (binding.current === next) binding.current = null; };
  }, [context]);
  useEffect(() => { binding.current?.update(state); }, [context, state.dirty, state.busy, state.error]);
}

/** Caught exception contents are diagnostic-only upstream; never echoed into these forms. */
export function reportAdminModalFailure(action: 'create-user' | 'set-password'): string {
  emitFrontendCode(OBS_CODES.FRONTEND_ADMIN_USER_ACTION_FAILED, { metadata: { action, surface: 'admin-modal' } });
  return action === 'create-user' ? 'The user could not be created. Please try again.'
    : 'The password change could not be confirmed. Please try again.';
}
