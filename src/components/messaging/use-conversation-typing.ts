'use client';

import * as React from 'react';
import { useTypingIndicator } from '../../frontend/client/typing-indicator-hooks';
import { conversationActivityMembers } from '../../messaging/activity';
import type { MessagingActivity } from '../../messaging/presentation';
import { useEphemeralErrors } from '../../sync/client/ephemeral-hooks';
import type { EphemeralErrorMessage } from '../../sync/ephemeral-policy';
import { useClient } from '../../frontend/client/client-context';
import type { InternalClient } from '../../frontend/client/sdk';
import { useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';

export interface UseConversationTypingOptions {
  /** Privacy control for publishing this client's activity; still observes admitted peers. */
  publish?: boolean;
  label?: string;
  activity?: MessagingActivity;
}

/** Real room ID required. No alternate topic or caller-selected actor can bypass Guardian. */
export function useConversationTyping(roomId: string, options: UseConversationTypingOptions = {}) {
  const client = useClient() as InternalClient;
  const boundary = useAuthorizationScopeBoundary(client);
  const boundaryRef = React.useRef(boundary);
  boundaryRef.current = boundary;
  const session = React.useRef<string | null>(null);
  if (!session.current) session.current = crypto.randomUUID();
  const metadata = React.useMemo(() => ({ activity: options.activity ?? 'typing' }), [options.activity]);
  const typing = useTypingIndicator(roomId, { sessionId: session.current, label: options.label, metadata, ttlMs: 5000, idleMs: 3500, throttleMs: 750 });
  const [error, setError] = React.useState<EphemeralErrorMessage | null>(null);
  const visible = React.useRef(true), publishing = options.publish !== false;
  const gate = React.useRef({ publishing, error, topic: typing.topic });
  gate.current = { publishing, error, topic: typing.topic };
  const clear = typing.clearTyping;
  useEphemeralErrors(React.useCallback((failure: EphemeralErrorMessage) => {
    if (failure.topic === typing.topic && gate.current.topic === typing.topic && failure.operation !== 'delete' && failure.operation !== 'unsubscribe') {
      gate.current.error = failure;
      setError(failure);
    }
  }, [typing.topic]));
  React.useEffect(() => { setError(null); }, [typing.key, typing.topic]);
  React.useEffect(() => { if (error) clear(); }, [error, clear]);
  React.useEffect(() => {
    const hidden = () => { visible.current = document.visibilityState !== 'hidden'; if (!visible.current) clear(); };
    const pause = () => clear();
    hidden(); document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', pause); window.addEventListener('blur', pause);
    return () => { document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', pause); window.removeEventListener('blur', pause); };
  }, [clear]);
  React.useEffect(() => { if (!publishing) clear(); }, [clear, publishing]);
  const mark = React.useCallback(() => { if (gate.current.publishing && !gate.current.error && visible.current) typing.markTyping(); }, [typing.markTyping]);
  const onTextChange = React.useCallback((text: string) => { if (text.trim()) mark(); else clear(); }, [mark, clear]);
  const resetError = React.useCallback(() => {
    if (gate.current.topic !== typing.topic || !boundaryRef.current.ready || boundaryRef.current.key !== boundary.key) return;
    // The server must re-prove admission. Merely clearing the visible error
    // would leave a rejected subscription unregistered until a future remount.
    const unsubscribe = client.ephemeral.subscribe(typing.topic, () => {});
    unsubscribe();
    gate.current.error = null;
    setError(null);
  }, [boundary.key, client.ephemeral, typing.topic]);
  return { ...typing, error, isTyping: !error && typing.isTyping, isAnyoneTyping: !error && typing.isAnyoneTyping, typingUsers: error ? [] : typing.typingUsers, resetError, markTyping: mark, setTyping: (active: boolean) => active ? mark() : clear(), clearTyping: clear,
    onTextChange, onCompositionStart: mark, onCompositionEnd: onTextChange,
    participants: error ? [] : conversationActivityMembers(typing.typingUsers) };
}
