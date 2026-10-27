'use client';
/** React owns mounting only. The native facade owns data, authorization and durable command receipts. */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useClientMaybe } from '../../frontend/client/client-context';
import { readAuthorizationScopeBoundaryKey, useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import type { InternalClient } from '../../frontend/client/sdk';
import type { MessagingClient } from '../../messaging/client-contracts';
import { MessagingWorkspaceController } from './messaging-workspace-controller';
import { initialMessagingWorkspaceState } from './workspace-state';
import { useNavigationGuard } from '../../frontend/client/router-context';
import { modals } from '../../modals';
export interface UseMessagingWorkspaceOptions {
  /** Native SDK by default. An external facade must supply its current identity and scope key. */
  source?: MessagingClient; scopeKey?: string; userId?: string; maxMessages?: number;
  /** Default true under Zero's router; a custom host can own its own leave admission. */
  guardNavigation?: boolean;
}
const EMPTY = Object.freeze(initialMessagingWorkspaceState()), getEmpty = () => EMPTY, noSubscribe = () => () => {};
export function useMessagingWorkspace(options: UseMessagingWorkspaceOptions = {}) {
  const client = useClientMaybe() as InternalClient | null, boundary = useAuthorizationScopeBoundary(client);
  const source = options.source ?? client?.messaging, userId = options.userId ?? client?.user?.userId ?? '';
  const key = JSON.stringify([boundary.key, options.scopeKey ?? null, userId, options.maxMessages ?? 500]);
  const latest = useRef({ key, source }); latest.current = { key, source };
  if (typeof window !== 'undefined' && (!source || !client?.auth && (!options.source || !options.scopeKey || !options.userId))) {
    throw new Error('MessagingWorkspace requires auth-enabled Zero providers, or an explicit scoped source and userId.');
  }
  const [owner, setOwner] = useState<{ key: string; source: MessagingClient; controller: MessagingWorkspaceController } | null>(null);
  const controller = boundary.ready && owner?.key === key && owner.source === source ? owner.controller : null;
  const snapshot = useSyncExternalStore(controller?.subscribe ?? noSubscribe, controller?.getSnapshot ?? getEmpty, getEmpty);
  useNavigationGuard(async () => {
    if (!controller?.hasUnfinished()) return true;
    const leave = await modals.confirm({ title: 'Leave messages?', confirmLabel: 'Leave messages', cancelLabel: 'Keep messaging', variant: 'destructive',
      description: 'Unsent drafts and staged files are kept only in this workspace. An unconfirmed send or change may already be accepted; leaving does not cancel it or prove it failed.' });
    return controller.current() && leave;
  }, !!controller && boundary.ready && options.guardNavigation !== false);
  useEffect(() => {
    if (!controller) return;
    const leaving = (event: BeforeUnloadEvent) => { if (controller.hasUnfinished()) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', leaving); return () => window.removeEventListener('beforeunload', leaving);
  }, [controller]);
  useEffect(() => {
    if (!source || !userId || !boundary.ready) return;
    // Create inside the effect: StrictMode's cleanup retires the old owner;
    // its second setup receives a fresh owner, never a disposed singleton.
    const value = new MessagingWorkspaceController(source, userId, { maxMessages: options.maxMessages, isCurrent: () => latest.current.key === key && latest.current.source === source
      && (!client || readAuthorizationScopeBoundaryKey(client.auth, client._authorizationDataBoundary?.revision ?? 0) === boundary.key) });
    setOwner({ key, source, controller: value }); void value.start(); return () => value.dispose();
  }, [source, userId, key, boundary.ready, client, boundary.key, options.maxMessages]);
  return { controller, state: controller && boundary.ready ? snapshot : EMPTY };
}
