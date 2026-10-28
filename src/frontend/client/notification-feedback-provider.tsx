'use client';
import { createContext, createElement, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useClientMaybe } from './client-context';
import { readAuthorizationScopeBoundaryKey, useAuthorizationScopeBoundary } from './authorization-scope-hooks';
import type { InternalClient } from './sdk';
import { useOnNewNotification } from './notification-hooks';
import type { Notification } from './notification-hooks';
import { NotificationFeedback } from './notification-feedback';
import { createNotificationAudio, notificationSoundOptions, type NotificationAudio, type NotificationSoundOptions, type NotificationSoundStatus } from './notification-audio';

interface FeedbackContext { feedback: NotificationFeedback; status: NotificationSoundStatus; muted: boolean; setMuted(value: boolean): void; unlock(): void }
const Context = createContext<FeedbackContext | null>(null);
export interface NotificationFeedbackProviderProps {
  /** Both sounds are off by default; true enables both categories, never both for one event. */
  sounds?: boolean | NotificationSoundOptions;
  children: ReactNode;
}
/** AppProvider installs one persistent owner. A custom ClientProvider host can install this explicitly. */
export function NotificationFeedbackProvider({ sounds, children }: NotificationFeedbackProviderProps) {
  const client = useClientMaybe() as InternalClient | null, boundary = useAuthorizationScopeBoundary(client);
  const latest = useRef(boundary); latest.current = boundary;
  const audio = useRef<NotificationAudio | null>(null);
  const [status, setStatus] = useState<NotificationSoundStatus>('disabled'), [muted, setMuted] = useState(false);
  const options = notificationSoundOptions(sounds), disabled = !boundary.ready || options.muted || muted;
  const feedback = useMemo(() => new NotificationFeedback(
    () => latest.current.ready && latest.current.key === boundary.key
      && readAuthorizationScopeBoundaryKey(client?.auth ?? null, (client as InternalClient | null)?._authorizationDataBoundary?.revision ?? 0) === boundary.key,
    kind => audio.current?.play(kind),
  ), [boundary.key, client]);
  useOnNewNotification(notification => feedback.observe(notification));
  useLayoutEffect(() => {
    const owner = createNotificationAudio({ ...options, muted: disabled }, setStatus); audio.current = owner;
    const retire = () => {
      if (readAuthorizationScopeBoundaryKey(client?.auth ?? null, (client as InternalClient | null)?._authorizationDataBoundary?.revision ?? 0) === boundary.key) return;
      if (audio.current === owner) audio.current = null; owner.dispose();
    };
    const offAuth = client?.auth?.subscribe(retire);
    const offData = (client as InternalClient | null)?._authorizationDataBoundary?.subscribe(retire);
    return () => { offAuth?.(); offData?.(); if (audio.current === owner) audio.current = null; owner.dispose(); };
  }, [boundary.key, client, disabled, options.chat, options.notifications, options.volume]);
  const unlock = useCallback(() => audio.current?.unlock(), []);
  const value = useMemo(() => ({ feedback, status, muted: disabled, setMuted, unlock }), [feedback, status, disabled, unlock]);
  return createElement(Context.Provider, { value }, children);
}
/** Optional for low-level compositions. It never creates a second audio owner. */
export function useNotificationFeedbackMaybe(): FeedbackContext | null { return useContext(Context); }
/** Pair controls with application preferences; unlock must run from a user gesture. No old sounds are replayed. */
export function useNotificationSounds(): Omit<FeedbackContext, 'feedback'> {
  const context = useContext(Context);
  if (!context) throw new Error('useNotificationSounds requires AppProvider or NotificationFeedbackProvider.');
  const { feedback: _, ...state } = context; return state;
}
/** Apply native quiet-chat policy to a host-owned desktop alert. Does not create an alert or grant its permission. */
export function useNotificationInterruption(): (notification: Notification) => boolean {
  const context = useContext(Context);
  const allow = useCallback((notification: Notification) => context?.feedback.allowInterruption(notification) ?? false, [context?.feedback]);
  if (!context) throw new Error('useNotificationInterruption requires AppProvider or NotificationFeedbackProvider.');
  return allow;
}
/** Internal primitive also available to custom native conversation compositions. Does not mark anything read. */
export function useNotificationConversation(conversationId: string | null, active: () => boolean): void {
  const context = useContext(Context), current = useRef(active); current.current = active;
  useLayoutEffect(() => {
    if (!context || !conversationId) return;
    return context.feedback.registerConversation(conversationId, () => current.current());
  }, [context?.feedback, conversationId]);
}
