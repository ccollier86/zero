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

export interface TypingIndicatorMember {
  userId: string;
  label: string;
  since: number;
  updatedAt: number;
  metadata?: Record<string, JsonValue>;
}

export interface UseTypingIndicatorOptions {
  topic?: string;
  userId?: string;
  label?: string;
  ttlMs?: number;
  idleMs?: number;
  throttleMs?: number;
  includeSelf?: boolean;
  metadata?: Record<string, JsonValue>;
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

function isRecord(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readTypingMember(key: string, value: JsonValue): TypingIndicatorMember | null {
  if (!key.startsWith('user:') || !isRecord(value)) return null;

  const userId = typeof value.userId === 'string' ? value.userId : key.slice(5);
  const label = typeof value.label === 'string' ? value.label : userId;
  const since = typeof value.since === 'number' ? value.since : 0;
  const updatedAt = typeof value.updatedAt === 'number' ? value.updatedAt : since;
  const metadata = isRecord(value.metadata) ? value.metadata : undefined;

  return {
    userId,
    label,
    since,
    updatedAt,
    metadata,
  };
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
  const client = useClient() as InternalClient;
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
  const key = `user:${actorId}`;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
  const includeSelf = options.includeSelf ?? false;
  const entries = useEphemeralTopic(topic);
  const [isTyping, setIsTypingState] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const lastSentRef = useRef(0);
  const sinceRef = useRef(0);
  const clearTimerRef = useRef<number | null>(null);
  const boundaryKeyRef = useRef(authorizationBoundary.key);
  const boundaryReadyRef = useRef(authorizationBoundary.ready);
  boundaryKeyRef.current = authorizationBoundary.key;
  boundaryReadyRef.current = authorizationBoundary.ready;
  const callbackBoundaryKey = authorizationBoundary.key;

  const clearLocalTimer = useCallback(() => {
    if (clearTimerRef.current === null) return;
    window.clearTimeout(clearTimerRef.current);
    clearTimerRef.current = null;
  }, []);

  const clearTyping = useCallback(() => {
    if (!boundaryReadyRef.current
      || boundaryKeyRef.current !== callbackBoundaryKey) return;
    clearLocalTimer();
    setIsTypingState(false);
    sinceRef.current = 0;
    lastSentRef.current = 0;
    client.ephemeral.delete(topic, key);
  }, [callbackBoundaryKey, clearLocalTimer, client.ephemeral, key, topic]);

  const scheduleIdleClear = useCallback(() => {
    clearLocalTimer();
    clearTimerRef.current = window.setTimeout(clearTyping, idleMs);
  }, [clearLocalTimer, clearTyping, idleMs]);

  const setTyping = useCallback((typing: boolean) => {
    if (!boundaryReadyRef.current
      || boundaryKeyRef.current !== callbackBoundaryKey) return;
    if (!typing) {
      clearTyping();
      return;
    }

    const timestamp = Date.now();
    if (!sinceRef.current) sinceRef.current = timestamp;
    setIsTypingState(true);
    scheduleIdleClear();

    if (timestamp - lastSentRef.current < throttleMs) return;
    lastSentRef.current = timestamp;

    const value: Record<string, JsonValue> = {
      userId: actorId,
      label,
      since: sinceRef.current,
      updatedAt: timestamp,
    };
    if (options.metadata) value.metadata = options.metadata;
    client.ephemeral.set(topic, key, value, ttlMs);
  }, [
    actorId,
    callbackBoundaryKey,
    clearTyping,
    client.ephemeral,
    key,
    label,
    options.metadata,
    scheduleIdleClear,
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
    clearLocalTimer();
    setIsTypingState(false);
    sinceRef.current = 0;
    lastSentRef.current = 0;
    setNow(Date.now());
    const effectBoundaryKey = authorizationBoundary.key;
    return () => {
      clearLocalTimer();
      if (boundaryReadyRef.current
        && boundaryKeyRef.current === effectBoundaryKey) {
        client.ephemeral.delete(topic, key);
      }
    };
  }, [
    authorizationBoundary.key,
    clearLocalTimer,
    client.ephemeral,
    key,
    topic,
  ]);

  const typingUsers = useMemo(() => {
    if (!authorizationBoundary.ready) return [];
    const cutoff = now - idleMs;
    return Object.entries(entries)
      .map(([entryKey, entry]) => readTypingMember(entryKey, entry.value))
      .filter((member): member is TypingIndicatorMember => {
        if (!member) return false;
        if (!includeSelf && member.userId === actorId) return false;
        return member.updatedAt >= cutoff;
      })
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }, [actorId, authorizationBoundary.ready, entries, idleMs, includeSelf, now]);

  return {
    topic,
    key,
    isTyping: authorizationBoundary.ready && isTyping,
    isAnyoneTyping: typingUsers.length > 0,
    typingUsers,
    markTyping,
    setTyping,
    clearTyping,
  };
}
