'use client';
import * as React from 'react';
import { useClientMaybe } from '../../frontend/client/client-context';
import { useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import type { EmailInboxSource } from '../../email/inbox/contracts';
import { EmailInboxController, initialEmailInboxState } from './email-inbox-controller';

export interface UseEmailInboxOptions {
  source?: EmailInboxSource;
  /** Required for an external source outside AppProvider. Change it before changing the authenticated identity. */
  scopeKey?: string;
  markSeenOnOpen?: boolean;
}
const EMPTY = initialEmailInboxState();
export function useEmailInbox(options: UseEmailInboxOptions = {}) {
  const client = useClientMaybe();
  const boundary = useAuthorizationScopeBoundary(client);
  const source = options.source ?? client?.emailInbox;
  // An explicit adapter key adds to Guardian's boundary; it never disables it.
  const scopeKey = options.scopeKey ? JSON.stringify([boundary.key, options.scopeKey]) : boundary.key;
  if (options.source && !client && !options.scopeKey && typeof window !== 'undefined') throw new Error('An external EmailInbox source requires its owner’s scopeKey.');
  const controller = React.useMemo(() => source ? new EmailInboxController(source, scopeKey, { markSeenOnOpen: options.markSeenOnOpen }) : null,
    [source, scopeKey, options.markSeenOnOpen]);
  const state = React.useSyncExternalStore(controller?.subscribe ?? noopSubscribe, controller?.getSnapshot ?? empty, empty);
  React.useEffect(() => {
    if (!controller || !boundary.ready) return;
    void controller.start(); return () => controller.dispose();
  }, [controller, boundary.ready, options.source]);
  React.useEffect(() => {
    const draft = state.draft;
    if (!controller || !draft?.dirty || draft.status !== 'editing') return;
    const timer = setTimeout(() => { void controller.saveDraft().catch(() => {}); }, 800);
    return () => clearTimeout(timer);
  }, [controller, state.draft]);
  React.useEffect(() => {
    if (!state.draft?.dirty && state.draft?.status !== 'unknown') return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', prevent); return () => window.removeEventListener('beforeunload', prevent);
  }, [state.draft?.dirty, state.draft?.status]);
  return { controller, state: !boundary.ready ? EMPTY : state };
}
function empty() { return EMPTY; }
function noopSubscribe() { return () => {}; }
