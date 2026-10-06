'use client';

/**
 * use-signature-agreement.ts
 *
 * Adapts the single-document signing lifecycle to React and content-free Zero
 * observability. Callers provide persistence and current-draft admission.
 */
import * as React from 'react';
import { emitFrontendCode } from '../../frontend/client/observability';
import { OBS_CODES } from '../../observability/codes';
import { SignatureAgreementController } from './signature-agreement-controller';
import { normalizeSignatureAgreementReceipt, type SignatureAgreementAcknowledgement, type SignatureAgreementPayload,
  type SignatureAgreementReceipt, type SignatureAgreementSignedValue } from './signature-agreement-model';

interface AgreementOptions {
  sourceKey: string;
  signed?: SignatureAgreementSignedValue | null;
  onSign?: (payload: SignatureAgreementPayload) => SignatureAgreementAcknowledgement | Promise<SignatureAgreementAcknowledgement>;
  onSigned?: (receipt: SignatureAgreementReceipt) => void | Promise<void>;
  isDraftCurrent: (payload: SignatureAgreementPayload) => boolean;
}

/** Fence receipts by component/document lifetime and never emit signature or application errors. */
export function useSignatureAgreement(options: AgreementOptions) {
  const { sourceKey, signed, isDraftCurrent, onSign, onSigned } = options;
  const controller = React.useMemo(() => new SignatureAgreementController(), [sourceKey]);
  const lifetime = React.useRef(controller);
  lifetime.current = controller;
  const latest = React.useRef({ isDraftCurrent, onSign, onSigned });
  latest.current = { isDraftCurrent, onSign, onSigned };
  const state = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const external = React.useMemo(() => {
    if (!signed) return { receipt: null, invalid: false };
    try { return { receipt: normalizeSignatureAgreementReceipt(signed), invalid: false }; }
    catch { return { receipt: null, invalid: true }; }
  }, [signed]);

  React.useEffect(() => { controller.activate(); return () => controller.retire(); }, [controller]);
  React.useEffect(() => { if (external.receipt) controller.acceptReceipt(external.receipt); }, [controller, external.receipt]);
  React.useEffect(() => {
    if (external.invalid) emitFrontendCode(OBS_CODES.FRONTEND_SIGNATURE_PAD_SAVE_FAILED, { metadata: { operation: 'agreement-sign' } });
  }, [external.invalid]);

  const sign = React.useCallback(async (payload: SignatureAgreementPayload) => {
    const callback = latest.current.onSign;
    if (!callback || external.invalid || external.receipt) return 'ignored' as const;
    const current = () => lifetime.current === controller && latest.current.isDraftCurrent(payload);
    const result = await controller.sign(payload, callback, current);
    if (result !== 'signed' || !current()) return result;
    const receipt = controller.getSnapshot().receipt;
    if (!receipt || !latest.current.onSigned) return result;
    try { await latest.current.onSigned(receipt); }
    catch {
      if (current()) emitFrontendCode(OBS_CODES.FRONTEND_SIGNATURE_PAD_CALLBACK_FAILED, { metadata: { operation: 'agreement-notify' } });
    }
    return result;
  }, [controller, external.invalid, external.receipt]);

  return { ...state, receipt: external.receipt ?? state.receipt, invalidReceipt: external.invalid, sign,
    clearError: () => controller.clearError() };
}
