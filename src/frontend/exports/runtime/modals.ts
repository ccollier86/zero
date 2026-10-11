/** Structured modal manager and form/motion contracts. Curated client-safe re-exports only; implementation/context ownership stays with the existing modules. */

// ─── Modal Manager ──────────────────────────────────────────────────────
export { ModalManager, ControlledModal, modals, HoldButton, useModalForm, createModalFormGuard, ModalWorkflowProgress,
  MODAL_MOTION_DEFAULTS, MODAL_MOTION_EASING, MODAL_MOTION_TIMINGS, MODAL_MOTION_GEOMETRY,
  MODAL_MOTION_TIMING_TOKENS, resolveModalMotion } from '../../../modals';
export type * from '../../../modals/modal-system.types';
export type * from '../../../modals/modal-motion-types';
export type * from '../../../modals/modal-workflow-progress.types';
export type { UseModalFormOptions } from '../../../modals/modal-form';
export type { ControlledModalProps } from '../../../modals/modal-controlled';
export type { ModalPromptOptions } from '../../../modals/modal-prompt';
