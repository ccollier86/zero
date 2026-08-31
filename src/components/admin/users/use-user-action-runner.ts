'use client';

/**
 * use-user-action-runner.ts
 *
 * Serializes sensitive admin-user actions and confirmation dialogs. It owns UI
 * pending state only; operation authorization and transport remain elsewhere.
 */

import * as React from 'react';
import { toast } from 'sonner';
import { modals } from '../../../modals';

export interface UserActionConfirmation {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  holdToConfirm?: boolean;
}

/** Run at most one admin-user action or confirmation flow at a time. */
export function useUserActionRunner() {
  const busy = React.useRef(false);
  const [pending, setPending] = React.useState<string | null>(null);

  const reserve = React.useCallback(async (
    key: string,
    task: () => Promise<void>,
  ): Promise<boolean> => {
    if (busy.current) return false;
    busy.current = true;
    setPending(key);
    try {
      await task();
      return true;
    } finally {
      busy.current = false;
      setPending(null);
    }
  }, []);

  const confirmAndRun = React.useCallback((
    key: string,
    confirmation: UserActionConfirmation,
    task: () => Promise<void>,
  ) => reserve(key, async () => {
    const confirmed = await modals.confirm({
      title: confirmation.title,
      description: confirmation.description,
      confirmLabel: confirmation.confirmLabel,
      variant: confirmation.destructive ? 'destructive' : 'default',
      holdToConfirm: confirmation.holdToConfirm,
    });
    if (confirmed) await task();
  }), [reserve]);

  return React.useMemo(
    () => ({ pending, run: reserve, confirmAndRun }),
    [confirmAndRun, pending, reserve],
  );
}

export type UserActionRunner = ReturnType<typeof useUserActionRunner>;

/** Report an event-handler action failure without creating an unhandled promise. */
export function startUserAction(action: Promise<unknown>): void {
  void action.catch((error) => {
    toast.error(error instanceof Error ? error.message : 'Admin user action failed');
  });
}
