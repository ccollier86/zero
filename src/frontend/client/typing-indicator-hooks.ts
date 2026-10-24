/**
 * typing-indicator-hooks.ts
 *
 * Provides a shared typing indicator on top of Zero ephemeral sync. This file
 * owns typing presence state only; it does not persist messages, render chat
 * UI, or make backend authorization decisions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JsonValue } from '../../sync/types';
import { useEphemeralTopic } from '../../sync/client/ephemeral-hooks';
import { useClient } from './client-context';
import { useAuth } from './auth-hooks';
import { useAuthorizationScopeBoundary } from './authorization-scope-hooks';
import type { AuthUser } from './auth-client';
import type { InternalClient } from './sdk';
import { typingIndicatorMembers, type TypingIndicatorMember } from './typing-indicator-model';
export type { TypingIndicatorMember } from './typing-indicator-model';

export interface UseTypingIndicatorOptions {
  topic?: string;
  userId?: string;
  label?: string;
  ttlMs?: number;
  idleMs?: number;
  throttleMs?: number;
  includeSelf?: boolean;
  metadata?: Record<string, JsonValue>;
  /** Separate session keys avoid one tab clearing a sibling tab's activity. */
  sessionId?: string;
}

export interface UseTypingIndicatorReturn {
  topic: string;
  key: string;
  isTyping: boolean;
  isAnyoneTyping: boolean;
  typingUsers: TypingIndicatorMember[];
  markTyping: () => void;
  setTyping: (typing: boolean) => void;
  clearTyping: () => void;
}

const DEFAULT_TTL_MS = 5_000;
const DEFAULT_IDLE_MS = 3_500;
const DEFAULT_THROTTLE_MS = 750;

function createAnonymousActorId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `anonymous:${crypto.randomUUID()}`;
  }
  return `anonymous:${Date.now().toString(36)}:${Math.random().toString(16).slice(2)}`;
}

function getUserLabel(user: AuthUser | null): string | null {
  if (!user) return null;
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return fullName || user.username || user.email || user.userId;
}

/**
 * Publish and read "user is typing" state. The default `typing:<scope>` topic
 * treats `scope` as a Zero room ID and is authorized by live membership.
 * Non-room scopes require an explicit `topic` plus an app topic policy.
 *
 * Typing state is sent through ephemeral sync with a TTL, so it is never
 * persisted and stale entries expire even if a browser disconnects suddenly.
 */
export function useTypingIndicator(
  scope: string,
  options: UseTypingIndicatorOptions = {},
): UseTypingIndicatorReturn {
  const client = useClient() as InternalClient | null;
  const ephemeral = client?.ephemeral;
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const { user } = useAuth();
  const anonymousIdRef = useRef<string | null>(null);
  if (!anonymousIdRef.current) anonymousIdRef.current = createAnonymousActorId();

  const scopedUser = authorizationBoundary.ready ? user : null;
  const topic = options.topic ?? `typing:${scope}`;
  const actorId = topic.startsWith('typing:') && scopedUser?.userId
    ? scopedUser.userId
    : options.userId ?? scopedUser?.userId ?? scopedUser?.username ?? anonymousIdRef.current;
  const label = options.label ?? getUserLabel(scopedUser) ?? actorId;
  const sessionId = options.sessionId;
  if (sessionId !== undefined && !/^[A-Za-z0-9_-]{8,80}$/.test(sessionId)) throw new Error('Typing session ID must contain 8–80 letters, numbers, underscores or hyphens.');
  const key = `user:${actorId}${sessionId ? ':session:' + sessionId : ''}`;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
  const includeSelf = options.includeSelf ?? false;
  if (sessionId && (!Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > 15000 || !Number.isSafeInteger(idleMs) || idleMs < 250 || idleMs > ttlMs || !Number.isSafeInteger(throttleMs) || throttleMs < 100 || throttleMs >= idleMs)) throw new Error('Typing session timings require 1000–15000ms TTL and a shorter, positive throttle/idle interval.');
  const entries = useEphemeralTopic(topic);
  const [isTyping, setIsTypingState] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const lastSentRef = useRef<number | null>(null);
  const sinceRef = useRef(0);
  const publishedRef = useRef(false);
  const clearTimerRef = useRef<number | null>(null);
  const boundaryKeyRef = useRef(authorizationBoundary.key);
  const boundaryReadyRef = useRef(authorizationBoundary.ready);
  boundaryKeyRef.current = authorizationBoundary.key;
  boundaryReadyRef.current = authorizationBoundary.ready;
  const callbackBoundaryKey = authorizationBoundary.key;
  // A retained event callback must not publish into a room that has been left,
  // even if the actor's authorization family has not changed (or returns to it).
  const publicationIdentity = JSON.stringify([callbackBoundaryKey, topic, key]);
  const publication = useRef({ identity: publicationIdentity, epoch: 0, mounted: false });
  if (publication.current.identity !== publicationIdentity) {
    publication.current = { identity: publicationIdentity, epoch: publication.current.epoch + 1, mounted: false };
  }
  const callbackEpoch = publication.current.epoch;

  const clearLocalTimer = useCallback(() => {
    if (clearTimerRef.current === null) return;
    window.clearTimeout(clearTimerRef.current);
    clearTimerRef.current = null;
  }, []);

  const clearTyping = useCallback(() => {
    if (!boundaryReadyRef.current
      || boundaryKeyRef.current !== callbackBoundaryKey
      || !publication.current.mounted || publication.current.epoch !== callbackEpoch) return;
    clearLocalTimer();
    setIsTypingState(false);
    sinceRef.current = 0;
    lastSentRef.current = null;
    if (sessionId) {
      if (publishedRef.current) ephemeral?.deleteTransient(topic, key);
      publishedRef.current = false;
    } else ephemeral?.delete(topic, key);
  }, [callbackBoundaryKey, callbackEpoch, clearLocalTimer, ephemeral, key, sessionId, topic]);

  const scheduleIdleClear = useCallback(() => {
    clearLocalTimer();
    clearTimerRef.current = window.setTimeout(clearTyping, idleMs);
  }, [clearLocalTimer, clearTyping, idleMs]);

  const setTyping = useCallback((typing: boolean) => {
    if (!boundaryReadyRef.current
      || boundaryKeyRef.current !== callbackBoundaryKey
      || !publication.current.mounted || publication.current.epoch !== callbackEpoch) return;
    if (!typing) {
      clearTyping();
      return;
    }

    const timestamp = Date.now();
    if (!sinceRef.current) sinceRef.current = timestamp;
    setIsTypingState(true);
    scheduleIdleClear();

    const tick = performance.now();
    if (lastSentRef.current !== null && tick - lastSentRef.current < throttleMs) return;
    lastSentRef.current = tick;

    const value: Record<string, JsonValue> = {
      userId: actorId,
      label,
      since: sinceRef.current,
      updatedAt: timestamp,
    };
    if (options.metadata) value.metadata = options.metadata;
    if (sessionId) {
      if (ephemeral?.setTransient(topic, key, value, ttlMs)) publishedRef.current = true;
      else {
        clearLocalTimer(); setIsTypingState(false); sinceRef.current = 0; lastSentRef.current = null;
      }
    } else ephemeral?.set(topic, key, value, ttlMs);
  }, [
    actorId,
    clearLocalTimer,
    callbackBoundaryKey,
    callbackEpoch,
    clearTyping,
    ephemeral,
    key,
    label,
    options.metadata,
    scheduleIdleClear,
    sessionId,
    throttleMs,
    topic,
    ttlMs,
  ]);

  const markTyping = useCallback(() => {
    setTyping(true);
  }, [setTyping]);

  useEffect(() => {
    if (!authorizationBoundary.ready) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [authorizationBoundary.key, authorizationBoundary.ready]);

  useEffect(() => {
    publication.current.mounted = authorizationBoundary.ready;
    clearLocalTimer();
    setIsTypingState(false);
    sinceRef.current = 0;
    lastSentRef.current = null;
    publishedRef.current = false;
    setNow(Date.now());
    const effectBoundaryKey = authorizationBoundary.key;
    return () => {
      if (publication.current.epoch === callbackEpoch) publication.current.mounted = false;
      clearLocalTimer();
      if (boundaryReadyRef.current
        && boundaryKeyRef.current === effectBoundaryKey) {
        if (sessionId) {
          if (publishedRef.current) ephemeral?.deleteTransient(topic, key);
        } else ephemeral?.delete(topic, key);
      }
      publishedRef.current = false;
    };
  }, [
    authorizationBoundary.key,
    authorizationBoundary.ready,
    callbackEpoch,
    clearLocalTimer,
    ephemeral,
    key,
    sessionId,
    topic,
  ]);

  const typingUsers = useMemo(() => {
    if (!authorizationBoundary.ready) return [];
    return typingIndicatorMembers(entries, { now, idleMs, actorId, includeSelf, customKeys: !topic.startsWith('typing:') });
  }, [actorId, authorizationBoundary.ready, entries, idleMs, includeSelf, now, topic]);

  return {
    topic,
    key,
    isTyping: authorizationBoundary.ready && publication.current.mounted && isTyping,
    isAnyoneTyping: typingUsers.length > 0,
    typingUsers,
    markTyping,
    setTyping,
    clearTyping,
  };
}
