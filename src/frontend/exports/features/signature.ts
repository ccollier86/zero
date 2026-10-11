/** Signature capture and acknowledged agreement composition. Curated client-safe re-exports only; implementation/context ownership stays with the existing modules. */

// SVG signatures, acknowledged agreement cards and compact per-clause initials.
export {
  SignaturePad, SignaturePadArea, SignaturePadGuide, SignaturePadPlaceholder,
  SignaturePadControls, SignaturePadClear, SignaturePadUndo, SignaturePadRedo,
  SignaturePadSave, SignaturePadPreview, useSignaturePad, SignatureAgreementCard,
  ClauseInitials, getSignaturePadStrokePath, getSignaturePadBounds,
  signaturePadToSVG, signaturePadToDataURL, signaturePadToBlob, serializeSignaturePad,
  snapshotSignaturePadStrokes, hasSignaturePadInk,
} from '../../../components/signature-pad';
export type {
  SignaturePadProps, SignaturePadAreaProps, SignaturePadSaveProps, SignaturePadApi,
  SignaturePadPoint, SignaturePadStroke, SignaturePadFormat, SignaturePadExportOptions,
  SignaturePadPointerType, SignaturePadSizing, SignatureAgreementCardProps, ClauseInitialsProps,
  SignatureAgreementPayload, SignatureAgreementAcknowledgement, SignatureAgreementReceipt,
  SignatureAgreementSignedValue, SignatureClause, ClauseInitialsValue,
} from '../../../components/signature-pad';
