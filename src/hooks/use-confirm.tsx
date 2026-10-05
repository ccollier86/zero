'use client';

/**
 * use-confirm.tsx
 *
 * Provides a promise-based confirmation dialog hook and provider. This file
 * owns confirmation UI state only; callers own the action being confirmed.
 */

import * as React from 'react';
import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '#zero/components/animate-ui/components/radix/alert-dialog';
import { buttonVariants } from '#zero/components/ui/button';
import { cn } from '#zero/lib/utils';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

// ─── Context ────────────────────────────────────────────────────────────────

const ConfirmContext = createContext<ConfirmFn | null>(null);

// ─── Provider ───────────────────────────────────────────────────────────────

interface ConfirmState extends ConfirmOptions {
  open: boolean;
  requestId: number;
  returnFocus?: HTMLElement;
}

/**
 * Render one shared confirmation dialog. Replaced or unmounted requests settle
 * false; accepting settles only that request. Callers still own the action.
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConfirmState>({
    open: false,
    title: '',
    requestId: 0,
  });

  const pendingRef = useRef<{
    requestId: number;
    resolve: (value: boolean) => void;
    returnFocus?: HTMLElement;
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
    };
  }, []);

  const confirm = useCallback<ConfirmFn>((options) => {
    if (!mountedRef.current) return Promise.resolve(false);
    // This provider has one dialog, not a queue. A new request safely cancels
    // the previous one instead of leaving its awaiting caller suspended.
    const previous = pendingRef.current;
    pendingRef.current = null;
    previous?.resolve(false);
    const requestId = ++nextRequestId.current;
    const returnFocus = previous?.returnFocus
      ?? (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined);
    return new Promise<boolean>((resolve) => {
      pendingRef.current = { requestId, resolve, returnFocus };
      setState({ ...options, open: true, requestId, returnFocus });
    });
  }, []);

  const handleResult = useCallback((result: boolean) => {
    const pending = pendingRef.current;
    if (!pending || pending.requestId !== state.requestId) return;
    pendingRef.current = null;
    setState((prev) => prev.requestId === pending.requestId
      ? { ...prev, open: false }
      : prev);
    pending.resolve(result);
  }, [state.requestId]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog
        open={state.open}
        onOpenChange={(open) => { if (!open) handleResult(false); }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            // Programmatic confirmations have no Radix Trigger. Restore their
            // actual opener, unless another request or scope has replaced it.
            if (pendingRef.current || nextRequestId.current !== state.requestId) return;
            if (state.returnFocus?.isConnected) state.returnFocus.focus({ preventScroll: true });
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{state.title}</AlertDialogTitle>
            <AlertDialogDescription className={state.description ? undefined : 'sr-only'}>
              {state.description ?? 'Choose Confirm to continue, or Cancel to stop.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => handleResult(false)}>
              {state.cancelLabel ?? 'Cancel'}
            </AlertDialogCancel>
            <AlertDialogAction
              className={cn(
                state.variant === 'destructive' && buttonVariants({ variant: 'destructive' }),
              )}
              onClick={() => handleResult(true)}
            >
              {state.confirmLabel ?? 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Return the shared confirmation function from `ConfirmProvider`.
 */
export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) {
    throw new Error('useConfirm must be used within a <ConfirmProvider>');
  }
  return confirm;
}
