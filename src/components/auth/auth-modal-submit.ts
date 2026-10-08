/** Admits native dialog submits once; existing domain controllers retain validation and writes. */
import type { FormEvent, MutableRefObject } from 'react';
import type { ModalContext } from '../../modals/modal-system.types';
import { emitFrontendCode } from '../../frontend/client/observability';
import { OBS_CODES } from '../../observability/codes';

/** A child native form cannot bubble into a parent shell or replay its pending writer. */
export async function submitOwnedAuthModal(context: Pick<ModalContext, 'signal' | 'setBusy' | 'setError'>,
  event: FormEvent, pending: MutableRefObject<boolean>, operation: () => void | Promise<void>): Promise<void> {
  event.preventDefault(); event.stopPropagation();
  if (pending.current || context.signal.aborted) return;
  pending.current = true; context.setBusy(true);
  try { await operation(); }
  catch {
    if (!context.signal.aborted) {
      context.setError('The operation could not be confirmed. Please try again.');
      emitFrontendCode(OBS_CODES.FRONTEND_MODAL_CALLBACK_FAILED, { metadata: { surface: 'auth-dialog', stage: 'native-submit' } });
    }
  } finally { pending.current = false; if (!context.signal.aborted) context.setBusy(false); }
}
