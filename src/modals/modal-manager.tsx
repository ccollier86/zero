'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogClose,
  DialogTitle,
} from '@/components/animate-ui/primitives/radix/dialog';
import { AnimateIcon, X } from '@/components/animate-ui/icons';
import { cn } from '@/lib/utils';
import { modalStore } from './modal-store';
import { modals } from './modal-events';
import { ConfirmModalContent } from './confirm-modal';
import type { ModalInstance, ModalStoreState } from './modal.types';
import { MODAL_SIZE_CLASSES } from './modal.types';

// ─── Store Hook ──────────────────────────────────────────────────────────────

function useModalStore(): ModalStoreState {
  return useSyncExternalStore(
    (cb) => {
      const sub = modalStore.subscribe(cb);
      return sub.unsubscribe;
    },
    () => modalStore.getSnapshot().context,
    () => modalStore.getSnapshot().context,
  );
}

// ─── Single Modal Renderer ───────────────────────────────────────────────────

function ModalRenderer({
  modal,
  isClosing,
}: {
  modal: ModalInstance;
  isClosing: boolean;
}) {
  const isOpen = !isClosing;

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) modals.close(modal.id);
    },
    [modal.id],
  );

  const handleConfirmResult = useCallback(
    (confirmed: boolean) => {
      modal._resolve?.(confirmed);
      // Clear the resolver so close doesn't double-resolve
      modal._resolve = undefined;
      modals.close(modal.id);
    },
    [modal],
  );

  // After exit animation completes, remove from stack
  const handleAnimationComplete = useCallback(() => {
    if (isClosing) {
      modalStore.send({ type: 'remove', id: modal.id });
    }
  }, [isClosing, modal.id]);

  // Build size class
  const sizeClass = modal.customSize?.width
    ? undefined
    : MODAL_SIZE_CLASSES[modal.size ?? 'md'];

  // Build inline styles for custom sizing
  const customStyle: React.CSSProperties = {};
  if (modal.customSize?.width) customStyle.width = modal.customSize.width;
  if (modal.customSize?.maxWidth) customStyle.maxWidth = modal.customSize.maxWidth;
  if (modal.customSize?.height) customStyle.height = modal.customSize.height;
  if (modal.customSize?.maxHeight) {
    customStyle.maxHeight = modal.customSize.maxHeight;
  } else {
    customStyle.maxHeight = 'calc(100vh - 2rem)';
  }
  if (modal.customSize?.overflow) {
    customStyle.overflow = modal.customSize.overflow;
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={handleOpenChange}
    >
      <DialogPortal>
        <DialogOverlay
          className="fixed inset-0 z-50 bg-black/50"
          onClick={
            modal.closeOnClickOutside !== false
              ? () => handleOpenChange(false)
              : undefined
          }
        />
        <DialogContent
          from={modal.from ?? 'top'}
          onAnimationComplete={handleAnimationComplete}
          onEscapeKeyDown={
            modal.closeOnEscape !== false
              ? undefined
              : (e) => e.preventDefault()
          }
          onPointerDownOutside={
            modal.closeOnClickOutside !== false
              ? undefined
              : (e) => e.preventDefault()
          }
          aria-describedby={undefined}
          className={cn(
            'bg-background text-foreground fixed top-[50%] left-[50%] z-50 grid translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg',
            sizeClass,
            !modal.customSize?.overflow && 'overflow-auto',
            modal.className,
          )}
          style={customStyle}
        >
          {/* Accessible title — visually hidden, satisfies Radix DialogContent requirement */}
          <DialogTitle className="sr-only">
            {modal.title ?? modal.confirmOptions?.title ?? 'Dialog'}
          </DialogTitle>

          {/* Close button */}
          {modal.showCloseButton !== false && (
            <AnimateIcon asChild animateOnHover animateOnTap>
              <DialogClose
                className="ring-offset-background focus:ring-ring absolute top-4 right-4 inline-flex size-8 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                <X className="size-4" />
                <span className="sr-only">Close</span>
              </DialogClose>
            </AnimateIcon>
          )}

          {/* Content */}
          {modal.type === 'confirm' ? (
            <ConfirmModalContent
              modal={modal}
              onResult={handleConfirmResult}
            />
          ) : (
            modal.content
          )}
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

// ─── Provider ────────────────────────────────────────────────────────────────

export interface ModalManagerProps {
  children: ReactNode;
}

/**
 * Renders all open modals as a stack. Place once near the root of your app
 * (inside AppProvider or alongside it).
 *
 * Modals are opened/closed via the `modals` event API — no React context needed.
 *
 * @example
 * ```tsx
 * // In your layout:
 * <ModalManager>
 *   <App />
 * </ModalManager>
 *
 * // Anywhere in your app:
 * import { modals } from '@zero/framework/react';
 *
 * modals.open({ title: 'Hello', content: <p>World</p> });
 * const ok = await modals.confirm({ title: 'Sure?', variant: 'destructive', holdToConfirm: true });
 * ```
 */
export function ModalManager({ children }: ModalManagerProps) {
  const state = useModalStore();

  // Close topmost modal on Escape (handled by Radix, but belt-and-suspenders for stacked modals)
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape' && state.modals.length > 0) {
        const topModal = state.modals[state.modals.length - 1]!;
        if (topModal.closeOnEscape !== false) {
          modals.close(topModal.id);
        }
      }
    }
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [state.modals]);

  return (
    <>
      {children}
      {state.modals.map((modal) => (
        <ModalRenderer
          key={modal.id}
          modal={modal}
          isClosing={state.closingIds.includes(modal.id)}
        />
      ))}
    </>
  );
}
