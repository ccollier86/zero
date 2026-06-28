import type { ReactNode } from 'react';
import type { DialogFlipDirection } from '@/components/animate-ui/primitives/radix/dialog';

// ─── Size Presets ────────────────────────────────────────────────────────────

export type ModalSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'full';

/** Tailwind width classes for each size preset — uses min() for safe fixed-position sizing */
export const MODAL_SIZE_CLASSES: Record<ModalSize, string> = {
  xs: 'w-[min(20rem,calc(100vw-2rem))]',
  sm: 'w-[min(24rem,calc(100vw-2rem))]',
  md: 'w-[min(32rem,calc(100vw-2rem))]',
  lg: 'w-[min(40rem,calc(100vw-2rem))]',
  xl: 'w-[min(48rem,calc(100vw-2rem))]',
  full: 'w-[calc(100vw-2rem)]',
};

// ─── Modal Types ─────────────────────────────────────────────────────────────

export type ModalType = 'content' | 'confirm' | 'context';

// ─── Scroll / Overflow ───────────────────────────────────────────────────────

export type ModalOverflow = 'auto' | 'scroll' | 'hidden' | 'visible';

// ─── Custom Sizing ───────────────────────────────────────────────────────────

export interface ModalCustomSize {
  /** CSS width value (e.g., '600px', '80vw'). Overrides size preset. */
  width?: string;
  /** CSS max-width value. */
  maxWidth?: string;
  /** CSS height value (e.g., '400px', '80vh'). */
  height?: string;
  /** CSS max-height value. Default: 'calc(100vh - 2rem)' */
  maxHeight?: string;
  /** Body overflow behavior. Default: 'auto' */
  overflow?: ModalOverflow;
}

// ─── Confirm Options ─────────────────────────────────────────────────────────

export interface ConfirmModalOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
  /** Enable hold-to-confirm for destructive actions */
  holdToConfirm?: boolean;
  /** Hold duration in ms. Default: 1500 */
  holdDuration?: number;
}

// ─── Modal Instance ──────────────────────────────────────────────────────────

export interface ModalInstance {
  /** Unique modal ID */
  id: string;
  /** Modal type */
  type: ModalType;
  /** Content to render inside the modal body */
  content?: ReactNode;
  /** Size preset. Default: 'md' */
  size?: ModalSize;
  /** Custom sizing overrides */
  customSize?: ModalCustomSize;
  /** Flip animation direction. Default: 'top' */
  from?: DialogFlipDirection;
  /** Show close button. Default: true */
  showCloseButton?: boolean;
  /** Close on overlay click. Default: true */
  closeOnClickOutside?: boolean;
  /** Close on Escape key. Default: true */
  closeOnEscape?: boolean;
  /** Title (used by all types) */
  title?: string;
  /** Additional CSS class for the content container */
  className?: string;
  /** Confirm-specific options (only for type: 'confirm') */
  confirmOptions?: ConfirmModalOptions;
  /** Callback when modal closes */
  onClose?: () => void;
  /** Promise resolver for confirm modals */
  _resolve?: (value: boolean) => void;
}

// ─── Open Options (user-facing, without internal fields) ─────────────────────

export type OpenModalOptions = Omit<ModalInstance, 'id' | 'type' | '_resolve'>;

export type OpenConfirmOptions = ConfirmModalOptions & {
  size?: ModalSize;
  customSize?: ModalCustomSize;
  from?: DialogFlipDirection;
  className?: string;
};

// ─── Store State ─────────────────────────────────────────────────────────────

export interface ModalStoreState {
  /** Stack of open modals */
  modals: ModalInstance[];
  /** Index of the modal currently animating out (-1 = none) */
  closingIndex: number;
}
