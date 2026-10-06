'use client';

/**
 * signature-composition-callback.ts
 *
 * Observes local signature-composition notifications without treating them as
 * persistence receipts. Errors emit bounded Zero codes, never ink, names,
 * callback exceptions, or application payloads.
 */
import { emitFrontendCode } from '../../frontend/client/observability';
import { OBS_CODES } from '../../observability/codes';

type SignatureCompositionOperation = 'agreement-ink' | 'agreement-name' | 'clause-selection';

/** Contain both thrown and async notification failures; retired UI lifetimes emit nothing. */
export function observeSignatureCompositionCallback(
  callback: () => void | Promise<void>, operation: SignatureCompositionOperation, isCurrent: () => boolean = () => true,
): void {
  const report = () => {
    if (isCurrent()) emitFrontendCode(OBS_CODES.FRONTEND_SIGNATURE_PAD_CALLBACK_FAILED, { metadata: { operation } });
  };
  try {
    const result = callback();
    if (result) Promise.resolve(result).catch(report);
  } catch { report(); }
}
