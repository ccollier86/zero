'use client';

/** Synchronous operation admission and late-result fencing for one ACL editor lifetime. */

import * as React from 'react';
import type { AuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import { emitFrontendCode } from '../../frontend/client/observability';
import { OBS_CODES } from '../../observability/codes';

interface StoragePermissionOperationTicket {
  /** True only while this pending write still owns the readable editor. */
  isCurrent(): boolean;
  /** An accepted write stays accepted if an application notification fails. */
  notifyChanged(callback: (() => void) | undefined): void;
  /** Release this write without clearing a successor's pending state. */
  finish(): void;
}

/** Target, live administration availability and authority changes each retire old UI outcomes. */
export function useStoragePermissionOperationSession({ targetKey, canAdmin, boundary }: {
  readonly targetKey: string;
  readonly canAdmin: boolean;
  readonly boundary: AuthorizationScopeBoundary;
}): { readonly key: string; readonly busy: boolean; begin(): StoragePermissionOperationTicket | null } {
  const key = JSON.stringify([targetKey, canAdmin, boundary.key, boundary.ready]);
  const lifetime = React.useRef({ key, owner: {} });
  const active = React.useRef<StoragePermissionOperationTicket | null>(null);
  const mounted = React.useRef(false);
  const [busyOwner, setBusyOwner] = React.useState<object | null>(null);
  if (lifetime.current.key !== key) {
    lifetime.current = { key, owner: {} };
    active.current = null;
  }
  const owner = lifetime.current.owner;
  const enabled = React.useRef(false); enabled.current = canAdmin && boundary.ready;
  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; active.current = null; };
  }, []);

  const begin = React.useCallback((): StoragePermissionOperationTicket | null => {
    if (!mounted.current || !enabled.current || lifetime.current.owner !== owner || active.current) return null;
    const ticket: StoragePermissionOperationTicket = {
      isCurrent: () => mounted.current && enabled.current
        && lifetime.current.owner === owner && active.current === ticket,
      notifyChanged: callback => {
        if (!ticket.isCurrent()) return;
        try {
          const result: unknown = callback?.();
          if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
            void Promise.resolve(result).catch(reportCallbackFailure);
          }
        } catch { reportCallbackFailure(); }
      },
      finish: () => {
        if (active.current !== ticket) return;
        active.current = null;
        if (mounted.current && lifetime.current.owner === owner) setBusyOwner(null);
      },
    };
    active.current = ticket;
    setBusyOwner(owner);
    return ticket;
  }, [owner]);

  return { key, busy: !boundary.ready || (busyOwner === owner && active.current !== null && enabled.current), begin };
}

function reportCallbackFailure() {
  emitFrontendCode(OBS_CODES.FRONTEND_STORAGE_ACTION_FAILED, { metadata: { action: 'permissionChanged' } });
}
