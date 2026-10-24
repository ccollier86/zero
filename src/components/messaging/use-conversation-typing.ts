'use client';

import * as React from 'react';
import { useTypingIndicator, type UseTypingIndicatorReturn } from '../../frontend/client/typing-indicator-hooks';
import { conversationActivityMembers, type ConversationActivityMember } from '../../messaging/activity';
import type { MessagingActivity } from '../../messaging/presentation';
import { useEphemeralErrors } from '../../sync/client/ephemeral-hooks';
import type { EphemeralErrorMessage } from '../../sync/ephemeral-policy';
import { useClient } from '../../frontend/client/client-context';
import type { InternalClient } from '../../frontend/client/sdk';
import { useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';

export interface UseConversationTypingOptions {
  /** Privacy control for publication; observation still requires room membership. */
  publish?: boolean;
  label?: string;
  activity?: MessagingActivity;
}

export interface UseConversationTypingReturn extends UseTypingIndicatorReturn {
  participants: ConversationActivityMember[];
  error: EphemeralErrorMessage | null;
  /** Re-prove admission after access is restored. True means dispatched, not authorized. */
  resetError(): boolean;
  onTextChange(text: string): void;
  onCompositionStart(): void;
  onCompositionEnd(text: string): void;
}

/** Real room ID required. No alternate topic or caller-selected actor can bypass Guardian. */
export function useConversationTyping(roomId: string, options: UseConversationTypingOptions = {}): UseConversationTypingReturn {
  const client = useClient() as InternalClient | null;
  if (typeof window !== 'undefined' && !client?.auth) {
    throw new Error('useConversationTyping requires auth-enabled Zero Client and Sync providers.');
  }
  const boundary = useAuthorizationScopeBoundary(client);
  const boundaryRef = React.useRef(boundary);
  boundaryRef.current = boundary;
  const session = React.useRef<string | null>(null);
  // getRandomValues also works on local HTTP origins where randomUUID is not
  // exposed. This key isolates tabs; it is never an authorization capability.
  if (!session.current) session.current = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  const metadata = React.useMemo(() => ({ activity: options.activity ?? 'typing' }), [options.activity]);
  const typing = useTypingIndicator(roomId, {
    sessionId: session.current, label: options.label, metadata,
    ttlMs: 5000, idleMs: 3500, throttleMs: 750,
  });
  const identity = JSON.stringify([boundary.key, typing.topic, typing.key]);
  const lifetime = React.useRef({ identity, epoch: 0 });
  if (lifetime.current.identity !== identity) {
    lifetime.current = { identity, epoch: lifetime.current.epoch + 1 };
  }
  const epoch = lifetime.current.epoch;
  const [failure, setFailure] = React.useState<{ epoch: number; value: EphemeralErrorMessage } | null>(null);
  const error = failure?.epoch === epoch ? failure.value : null;
  const failureRevision = React.useRef(0);
  const foreground = React.useRef({ visible: true, focused: true, activePage: true });
  const publishing = options.publish !== false;
  const gate = React.useRef({ publishing, error, epoch });
  gate.current = { publishing, error, epoch };
  const clear = typing.clearTyping;

  useEphemeralErrors(React.useCallback((value: EphemeralErrorMessage) => {
    if (gate.current.epoch !== epoch || value.topic !== typing.topic
      || value.operation === 'delete' || value.operation === 'unsubscribe'
      || value.key !== undefined && value.key !== typing.key) return;
    failureRevision.current++;
    gate.current.error = value;
    setFailure({ epoch, value });
  }, [epoch, typing.key, typing.topic]));

  React.useEffect(() => { if (error) clear(); }, [error, clear]);
  React.useEffect(() => {
    const visibility = () => {
      foreground.current.visible = document.visibilityState !== 'hidden';
      if (!foreground.current.visible) clear();
    };
    const blur = () => { foreground.current.focused = false; clear(); };
    const focus = () => { foreground.current.focused = true; };
    const hide = () => { foreground.current.activePage = false; clear(); };
    const show = () => { foreground.current.activePage = true; visibility(); };
    foreground.current.focused = document.hasFocus();
    visibility();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', blur);
    window.addEventListener('focus', focus);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', blur);
      window.removeEventListener('focus', focus);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
    };
  }, [clear]);
  React.useEffect(() => { if (!publishing) clear(); }, [clear, publishing]);

  const mark = React.useCallback(() => {
    if (gate.current.epoch === epoch && gate.current.publishing && !gate.current.error
      && foreground.current.visible && foreground.current.focused && foreground.current.activePage) {
      typing.markTyping();
    }
  }, [epoch, typing.markTyping]);
  const onTextChange = React.useCallback((text: string) => {
    if (text.trim()) mark(); else clear();
  }, [mark, clear]);
  const resetError = React.useCallback(() => {
    if (gate.current.epoch !== epoch || !boundaryRef.current.ready
      || boundaryRef.current.key !== boundary.key) return false;
    const revision = failureRevision.current;
    if (!client?.ephemeral.retrySubscription(typing.topic)) return false;
    if (failureRevision.current === revision) {
      gate.current.error = null;
      setFailure(null);
    }
    return true;
  }, [boundary.key, client?.ephemeral, epoch, typing.topic]);
  const setTyping = React.useCallback((active: boolean) => active ? mark() : clear(), [mark, clear]);

  return {
    ...typing, error,
    isTyping: !error && typing.isTyping,
    isAnyoneTyping: !error && typing.isAnyoneTyping,
    typingUsers: error ? [] : typing.typingUsers,
    participants: error ? [] : conversationActivityMembers(typing.typingUsers),
    resetError, markTyping: mark, setTyping,
    clearTyping: clear, onTextChange,
    onCompositionStart: mark, onCompositionEnd: onTextChange,
  };
}
