/**
 * signature-agreement-model.ts
 *
 * Defines validated signature snapshots and acknowledgement receipts for the
 * agreement UI. It never establishes identity, timestamps a legal record, or
 * stores agreement data; an application-owned server does those jobs.
 */
import { signaturePadToSVG } from './signature-export';
import { hasSignaturePadInk, snapshotSignaturePadStrokes } from './signature-model';
import type { SignaturePadStroke } from './signature-pad.types';

/** Exact submitted drawing and the display name supplied by the UI. */
export interface SignatureAgreementPayload {
  readonly svg: string;
  readonly strokes: readonly SignaturePadStroke[];
  readonly signerName: string;
}

/** Application-owned acknowledgement; the server owns the signed date and identity. */
export interface SignatureAgreementAcknowledgement {
  readonly signedAt: string;
  readonly signerName?: string;
}

/** Acknowledged drawing snapshot, suitable for the read-only agreement view. */
export interface SignatureAgreementReceipt extends SignatureAgreementAcknowledgement {
  readonly svg: string;
  readonly strokes: readonly SignaturePadStroke[];
}

/** Prefilled receipt. Supplied SVG is never trusted for rendering; strokes are validated. */
export interface SignatureAgreementSignedValue extends SignatureAgreementAcknowledgement {
  readonly strokes: readonly SignaturePadStroke[];
  readonly svg?: string;
}

/** Bounded UI failures omit application exceptions, names, and signature contents. */
export interface SignatureAgreementError {
  readonly code: 'SIGNATURE_AGREEMENT_REQUIRED' | 'SIGNATURE_AGREEMENT_RECEIPT_INVALID' | 'SIGNATURE_AGREEMENT_SAVE_FAILED';
  readonly message: string;
}

/** Capture immutable ink and canonical SVG before asking an application to sign. */
export function createSignatureAgreementPayload(
  strokes: readonly SignaturePadStroke[],
  signerName: string,
): SignatureAgreementPayload {
  const snapshot = snapshotSignaturePadStrokes(strokes);
  if (!hasSignaturePadInk(snapshot)) throw new TypeError('A signature is required.');
  if (typeof signerName !== 'string') throw new TypeError('Signer name must be text.');
  return Object.freeze({ strokes: snapshot, svg: signaturePadToSVG(snapshot), signerName: signerName.trim() });
}

function validateAcknowledgement(value: SignatureAgreementAcknowledgement): void {
  if (!value || typeof value.signedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value.signedAt)
    || !Number.isFinite(Date.parse(value.signedAt))
    || new Date(value.signedAt).toISOString().slice(0, 19) !== value.signedAt.slice(0, 19)
    || (value.signerName !== undefined && typeof value.signerName !== 'string')) {
    throw new TypeError('A valid signed-date acknowledgement is required.');
  }
}

/** Bind an accepted server acknowledgement to the exact submitted drawing. */
export function acknowledgeSignatureAgreement(
  payload: SignatureAgreementPayload,
  acknowledgement: SignatureAgreementAcknowledgement,
): SignatureAgreementReceipt {
  validateAcknowledgement(acknowledgement);
  const canonical = createSignatureAgreementPayload(payload.strokes, payload.signerName);
  return Object.freeze({
    signedAt: acknowledgement.signedAt,
    signerName: acknowledgement.signerName ?? canonical.signerName,
    svg: canonical.svg,
    strokes: canonical.strokes,
  });
}

/** Normalize a prefilled receipt without rendering untrusted SVG or retaining mutable ink. */
export function normalizeSignatureAgreementReceipt(value: SignatureAgreementSignedValue): SignatureAgreementReceipt {
  validateAcknowledgement(value);
  const payload = createSignatureAgreementPayload(value.strokes, value.signerName ?? '');
  return acknowledgeSignatureAgreement(payload, value);
}
