export { ModalManager } from './modal-manager';
export type { ModalManagerProps } from './modal-manager';

export { modals } from './modal-events';

export { HoldButton } from './hold-button';
export type { HoldButtonProps } from './hold-button';

export { ConfirmModalContent } from './confirm-modal';

export type {
  ModalSize,
  ModalType,
  ModalOverflow,
  ModalCustomSize,
  ModalInstance,
  ConfirmModalOptions,
  OpenModalOptions,
  OpenConfirmOptions,
  ModalStoreState,
  ModalCloseContext,
  ModalCloseOptions,
} from './modal.types';
export { MODAL_SIZE_CLASSES } from './modal.types';
export type * from './modal-system.types';
export type * from './modal-motion-types';
export { MODAL_MOTION_DEFAULTS, MODAL_MOTION_EASING, MODAL_MOTION_TIMINGS, MODAL_MOTION_GEOMETRY,
  MODAL_MOTION_TIMING_TOKENS, resolveModalMotion } from './modal-motion';
export { useModalForm, createModalFormGuard } from './modal-form';
export type { UseModalFormOptions } from './modal-form';
export { ModalWorkflowProgress } from './modal-workflow-progress';
export type * from './modal-workflow-progress.types';
export { ControlledModal } from './modal-controlled';
export type { ControlledModalProps } from './modal-controlled';
export type { ModalPromptOptions } from './modal-prompt';
