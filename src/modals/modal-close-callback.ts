/**
 * Observes application close notifications after the modal lifecycle commits.
 * It never blocks dismissal or emits callback payloads, modal IDs or raw errors.
 */
import { emitFrontendCode } from '../frontend/client/observability';
import { OBS_CODES } from '../observability/codes';
import type { ModalInstance } from './modal.types';

/** Invoke a close notification once; rejected async notifications are observed safely. */
export function notifyModalClosed(modal: ModalInstance): void {
  try {
    const result: unknown = modal.onClose?.();
    if (result != null && (typeof result === 'object' || typeof result === 'function')
      && typeof (result as PromiseLike<unknown>).then === 'function') {
      void Promise.resolve(result).catch(reportFailure);
    }
  } catch {
    reportFailure();
  }
}

function reportFailure(): void {
  emitFrontendCode(OBS_CODES.FRONTEND_MODAL_CALLBACK_FAILED, {
    metadata: { surface: 'modal-manager', stage: 'close-callback' },
  });
}
