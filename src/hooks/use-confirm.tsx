'use client';

/**
 * use-confirm.tsx
 *
 * Adapts the single-slot confirmation hook to Zero's owned modal manager.
 * Supersession/unmount settle false; callers still own the confirmed operation.
 */

import * as React from 'react';
import { createContext, useContext, useCallback, useEffect, useRef } from 'react';
import { modals } from '../modals/modal-events';
import { ModalManager } from '../modals/modal-manager';
import { useModalHostPresent } from '../modals/modal-host-context';
import type { ModalHandle } from '../modals/modal-system.types';
import { useOverlayScope } from '../components/overlays/overlay-scope';
import { modalStore } from '../modals/modal-store';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
  /** Optional deliberate hold; motion pace never scales its safety interval. */
  holdToConfirm?: boolean;
  holdDuration?: number;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;
type OwnedConfirmFn = (options: ConfirmOptions, parentId?: string) => Promise<boolean>;

// ─── Context ────────────────────────────────────────────────────────────────

const ConfirmContext = createContext<OwnedConfirmFn | null>(null);

// ─── Provider ───────────────────────────────────────────────────────────────

/**
 * Render one shared confirmation dialog. Replaced or unmounted requests settle
 * false; accepting settles only that request. Callers still own the action.
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const inheritedHost = useModalHostPresent();
  const pendingRef = useRef<{
    requestId: number;
    resolve: (value: boolean) => void;
    handle: ModalHandle<boolean>;
    returnFocus?: Element;
  } | null>(null);
  const nextRequestId = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const pending = pendingRef.current;
      pendingRef.current = null;
      pending?.resolve(false);
      if (pending) modals.disposeHost([pending.handle.id]);
    };
  }, []);

  const confirm = useCallback<OwnedConfirmFn>((options, parentId) => {
    if (!mountedRef.current) return Promise.resolve(false);
    if (parentId) {
      const state = modalStore.getSnapshot().context;
      if (!modals.getContext(parentId) || !state.modals.some(modal => modal.id === parentId)
        || state.closingIds.includes(parentId)) return Promise.resolve(false);
    }
    // This provider has one dialog, not a queue. A new request safely cancels
    // the previous one instead of leaving its awaiting caller suspended.
    const previous = pendingRef.current;
    pendingRef.current = null;
    previous?.resolve(false);
    if (previous) modals.disposeHost([previous.handle.id]);
    const requestId = ++nextRequestId.current;
    const returnFocus = previous?.returnFocus
      ?? (typeof document !== 'undefined' && document.activeElement
        ? document.activeElement
        : undefined);
    return new Promise<boolean>((resolve) => {
      const destructive = options.variant === 'destructive';
      const handle = modals.show<boolean>({ title: options.title,
        parentId,
        description: options.description ?? 'Choose Confirm to continue, or Cancel to stop.',
        trigger: returnFocus, role: 'alertdialog', size: 'sm', tone: destructive ? 'danger' : 'default',
        guard: false, initialFocus: destructive ? 'cancel' : 'primary', actions: [
          { id: 'cancel', label: options.cancelLabel ?? 'Cancel', role: 'cancel' },
          { id: 'confirm', label: options.confirmLabel ?? 'Confirm', variant: destructive ? 'danger' : 'primary',
            value: true, holdToConfirm: options.holdToConfirm, holdDuration: options.holdDuration },
        ] });
      const request = { requestId, resolve, returnFocus, handle };
      pendingRef.current = request;
      void handle.result.then(result => {
        if (pendingRef.current !== request || !mountedRef.current) { resolve(false); return; }
        pendingRef.current = null;
        resolve(result.kind === 'accepted' && result.value === true);
      });
    });
  }, []);
  const content = <ConfirmContext.Provider value={confirm}>{children}</ConfirmContext.Provider>;
  return inheritedHost ? content : <ModalManager>{content}</ModalManager>;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Return the shared confirmation function from `ConfirmProvider`.
 */
export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext), owner = useOverlayScope();
  const scoped = useCallback<ConfirmFn>(options => confirm!(options, owner?.id), [confirm, owner?.id]);
  if (!confirm) {
    throw new Error('useConfirm must be used within a <ConfirmProvider>');
  }
  return scoped;
}
