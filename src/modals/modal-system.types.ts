/**
 * Public structured modal contracts: presentation and acknowledged UI actions.
 * These types describe the manager boundary; they own no transport, authority,
 * form validation, workflow execution or browser animation implementation.
 */
import type { ReactNode } from 'react';
import type { ModalMotionOptions } from './modal-motion-types';
import type { ModalCloseContext, ModalCustomSize, ModalSize } from './modal.types';

/** A user dismissal is distinct from accepted work and authoritative retirement. */
export type ModalCloseReason = 'escape' | 'backdrop' | 'close-button' | 'cancel'
  | 'programmatic' | 'parent-closed' | 'host-unmount';

/** Advisory admission; authoritative scope/host retirement always bypasses it. */
export type ModalBeforeCloseGuard = (context: ModalCloseContext) => boolean | Promise<boolean>;

/** Logical outcomes settle once, before optional visual exit cleanup completes. */
export type ModalResult<T = unknown> =
  | { readonly kind: 'accepted'; readonly value: T }
  | { readonly kind: 'dismissed'; readonly reason: ModalCloseReason }
  | { readonly kind: 'retired' };

/** Exact-ID handle. Descriptor updates retire old callbacks, not this result waiter. */
export interface ModalHandle<T = unknown> {
  readonly id: string;
  readonly result: Promise<ModalResult<T>>;
  close(value: T): boolean;
  dismiss(reason?: ModalCloseReason): Promise<boolean>;
  update(updates: Partial<ModalDescriptor<T>>): void;
}

/** Generation-owned callbacks cannot affect a replacement, retired or closed modal. */
export interface ModalContext<T = unknown> {
  readonly id: string;
  readonly signal: AbortSignal;
  accept(value: T): boolean;
  requestClose(reason?: ModalCloseReason): Promise<boolean>;
  /** Supply a safe, user-facing message; caught exception text is never shown automatically. */
  setError(message: string | null): void;
  setBusy(busy: boolean): void;
  setDirty(dirty: boolean): void;
  setActionDisabled(actionId: string, disabled: boolean): void;
  show<U>(descriptor: ModalDescriptor<U>): ModalHandle<U>;
}

/** A body uses the current owned context; it does not construct the dialog frame. */
export type ModalBody<T = unknown> = ReactNode | ((context: ModalContext<T>) => ReactNode);

/** One admitted action at a time. False or closes:false keeps the dialog open. */
export interface ModalAction<T = unknown> {
  readonly id: string;
  readonly label: string;
  readonly role?: 'cancel';
  readonly variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  readonly submit?: boolean;
  /** Native form target; the footer never guesses a parent or child form's writer. */
  readonly formId?: string;
  readonly disabled?: boolean;
  readonly holdToConfirm?: boolean;
  /** Real safety interval; modal animation pace never scales it. Default 1500ms. */
  readonly holdDuration?: number;
  readonly closes?: boolean;
  readonly value?: T;
  readonly onClick?: (context: ModalContext<T>) => T | false | void | Promise<T | false | void>;
}

/** A retained panel in horizontal tabs or grouped side navigation. */
export interface ModalSection<T = unknown> {
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly badge?: ReactNode;
  readonly group?: string;
  readonly body: ModalBody<T>;
}

/** Shared controlled-shell options; geometry remains bounded by the host viewport. */
export interface ModalDescriptorBase<T = unknown> {
  readonly title: string;
  readonly meta?: ReactNode;
  readonly description?: ReactNode;
  readonly icon?: ReactNode;
  readonly tone?: 'default' | 'info' | 'success' | 'danger';
  readonly size?: ModalSize;
  readonly customSize?: ModalCustomSize;
  readonly placement?: 'center' | 'left' | 'right' | 'bottom';
  readonly height?: 'auto' | 'fixed';
  readonly scrollbar?: 'auto' | 'thin' | 'hidden';
  readonly navScrollbar?: 'auto' | 'thin' | 'hidden';
  readonly dismissible?: boolean;
  /** Explicit newer-draft policy; default pending actions lock body editing. */
  readonly allowEditingWhilePending?: boolean;
  readonly closeOnClickOutside?: boolean;
  readonly closeOnEscape?: boolean;
  readonly guard?: boolean;
  readonly beforeClose?: ModalBeforeCloseGuard;
  readonly footer?: { readonly start?: ReactNode };
  readonly actions?: readonly ModalAction<T>[];
  readonly headerActions?: readonly {
    readonly id: string;
    readonly label: string;
    readonly icon: ReactNode;
    readonly onClick: (context: ModalContext<T>) => void | Promise<void>;
  }[];
  readonly motion?: ModalMotionOptions;
  /** Explicit initiating control; programmatic opens do not infer the last focused node. */
  readonly trigger?: Element | null;
  readonly initialFocus?: 'auto' | 'cancel' | 'primary' | string;
  readonly role?: 'dialog' | 'alertdialog';
  readonly className?: string;
  /** Stable component/test slot on the managed frame; does not replace its anatomy. */
  readonly dataSlot?: string;
  /** Optional existing owner; child descriptors normally use context.show instead. */
  readonly parentId?: string;
  readonly onClose?: () => void;
  /** Optional exact-owner focus policy; preventing default suppresses opener restoration. */
  readonly onCloseAutoFocus?: (event: Event) => void;
}

/** Content and section layouts are exclusive, at both type and runtime admission. */
export type ModalDescriptor<T = unknown> = ModalDescriptorBase<T> & (
  | { readonly layout?: 'content'; readonly body?: ModalBody<T>; readonly sections?: never; readonly initialSection?: never }
  | { readonly layout: 'tabs' | 'nav'; readonly body?: never; readonly sections: readonly ModalSection<T>[]; readonly initialSection?: string }
);

/** Live controlled presentation only; target/frame/guards require a deliberate generation change. */
export type ModalPresentationUpdate<T = unknown> = Partial<Pick<ModalDescriptorBase<T>,
  'title' | 'meta' | 'description' | 'icon' | 'tone' | 'footer' | 'actions' | 'headerActions'>>;

/** Immutable UI projection consumed by the shell, not a domain mutation controller. */
export interface ModalSystemState {
  readonly busy: boolean;
  readonly dirty: boolean;
  readonly error: string | null;
  readonly actionId: string | null;
  readonly disabledActions: Readonly<Record<string, boolean>>;
}

/** Common decision/alert presentation. Action confirmation waits for supplied work. */
export interface ModalDecisionOptions {
  readonly title: string;
  readonly description?: ReactNode;
  readonly icon?: ReactNode;
  readonly tone?: 'default' | 'info' | 'success' | 'danger';
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly holdToConfirm?: boolean;
  readonly holdDuration?: number;
  readonly motion?: ModalMotionOptions;
  readonly trigger?: Element | null;
}

/** No operation is inferred: the caller supplies the authorized acknowledged writer. */
export interface ModalActionConfirmOptions<T = unknown> extends ModalDecisionOptions {
  readonly onConfirm: (context: ModalContext<T>) => T | false | void | Promise<T | false | void>;
}
