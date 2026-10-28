'use client';
/** Text-free, non-replayed visitor activity over the app's native transient pool. The same freshness model drives the staff UI. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupportChatClient } from '../../messaging/visitor-client';
import type { MessagingActivity } from '../../messaging/presentation';
import type { EphemeralEntryClient } from '../../sync/client/ephemeral-store';
import { typingIndicatorMembers } from '../../frontend/client/typing-indicator-model';
import { conversationActivityMembers, type ConversationActivityMember } from '../../messaging/activity';
export interface MessagingWorkspaceTyping {
  readonly participants: readonly ConversationActivityMember[]; readonly error: string | null;
  markTyping(activity?: MessagingActivity): void; clearTyping(): void;
  onTextChange(text: string): void; onCompositionStart(): void; onCompositionEnd(text: string): void;
}
export function useSupportTyping(client: SupportChatClient | null): MessagingWorkspaceTyping {
  const [snapshot, setSnapshot] = useState<{ client: SupportChatClient; entries: Record<string, EphemeralEntryClient> } | null>(null), [failure, setFailure] = useState<SupportChatClient | null>(null), [, tick] = useState(0);
  const tab = useRef(''); if (!tab.current && typeof crypto !== 'undefined') tab.current = [...crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, '0')).join('');
  const owner = useRef(client); owner.current = client;
  const last = useRef(0), idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), composing = useRef(false), foreground = useRef(true), published = useRef(false);
  const clearTyping = useCallback(() => {
    clearTimeout(idle.current); last.current = 0; if (!client?.active || !published.current) return; published.current = false;
    void client.typing.set(tab.current, null).catch(() => {});
  }, [client]);
  const markTyping = useCallback((activity: MessagingActivity = 'typing') => {
    if (!client?.active || owner.current !== client || !foreground.current || composing.current || document.visibilityState !== 'visible' || !document.hasFocus()) return;
    clearTimeout(idle.current); idle.current = setTimeout(clearTyping, 3500);
    if (Date.now() - last.current < 750) return; last.current = Date.now(); published.current = true;
    void client.typing.set(tab.current, activity).then(() => { if (owner.current === client) setFailure(null); }, () => { if (owner.current === client) { published.current = false; setFailure(client); } });
  }, [client, clearTyping]);
  useEffect(() => {
    if (!client) return; last.current = 0; published.current = false;
    const abort = new AbortController();
    const stop = client.typing.watch(entries => { if (owner.current !== client || abort.signal.aborted) return;
      const observedAt = performance.now(); setSnapshot({ client, entries: Object.fromEntries(Object.entries(entries).map(([key, entry]) => [key, { ...entry, observedAt }])) }); setFailure(null);
    }, { signal: abort.signal, onError() { if (owner.current === client && !abort.signal.aborted) { setSnapshot(null); setFailure(client); } } });
    const timer = setInterval(() => tick(value => value + 1), 500);
    const blur = () => { foreground.current = false; clearTyping(); }, focus = () => { foreground.current = true; }, visibility = () => { foreground.current = document.visibilityState === 'visible' && document.hasFocus(); if (!foreground.current) clearTyping(); };
    visibility(); window.addEventListener('blur', blur); window.addEventListener('focus', focus); window.addEventListener('pagehide', blur); document.addEventListener('visibilitychange', visibility);
    return () => { clearTyping(); abort.abort(); stop(); clearInterval(timer); clearTimeout(idle.current); window.removeEventListener('blur', blur); window.removeEventListener('focus', focus); window.removeEventListener('pagehide', blur); document.removeEventListener('visibilitychange', visibility); };
  }, [client]);
  const members = client && snapshot?.client === client ? typingIndicatorMembers(snapshot.entries, { now: Date.now(), monotonicNow: performance.now(), idleMs: 3500, actorId: client.userId }) : [];
  return { participants: conversationActivityMembers(members), error: client && failure === client ? 'Live typing is unavailable. Message delivery has its own authorization.' : null,
    markTyping, clearTyping, onTextChange(text) {
      // A fresh editable-input event can restore focus admission after a tab
      // switch even when the host did not deliver a separate window-focus event.
      // Timers never do this, and hidden/unfocused documents still cannot publish.
      if (document.visibilityState === 'visible' && document.hasFocus() && document.activeElement?.matches('textarea,input,[contenteditable=true]')) foreground.current = true;
      if (text.trim()) markTyping(); else clearTyping();
    }, onCompositionStart() { composing.current = true; clearTyping(); }, onCompositionEnd(text) { composing.current = false; if (text.trim()) markTyping(); } };
}
