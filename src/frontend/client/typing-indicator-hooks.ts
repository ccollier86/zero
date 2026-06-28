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
 * Publish and read "user is typing" state for a room, thread, or document.
 *
 * Typing state is sent through ephemeral sync with a TTL, so it is never
 * persisted and stale entries expire even if a browser disconnects suddenly.
 */
export function useTypingIndicator(
  scope: string,
  options: UseTypingIndicatorOptions = {},
): UseTypingIndicatorReturn {
  const client = useClient() as InternalClient;
  const { user } = useAuth();
  const anonymousIdRef = useRef<string | null>(null);
  if (!anonymousIdRef.current) anonymousIdRef.current = createAnonymousActorId();

  const topic = options.topic ?? `typing:${scope}`;
  const actorId = options.userId ?? user?.userId ?? user?.username ?? anonymousIdRef.current;
  const label = options.label ?? getUserLabel(user) ?? actorId;
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

  const clearLocalTimer = useCallback(() => {
    if (!clearTimerRef.current) return;
    window.clearTimeout(clearTimerRef.current);
    clearTimerRef.current = null;
  }, []);

  const clearTyping = useCallback(() => {
    clearLocalTimer();
    setIsTypingState(false);
    sinceRef.current = 0;
    client.ephemeral.delete(topic, key);
  }, [clearLocalTimer, client.ephemeral, key, topic]);

  const scheduleIdleClear = useCallback(() => {
    clearLocalTimer();
    clearTimerRef.current = window.setTimeout(clearTyping, idleMs);
  }, [clearLocalTimer, clearTyping, idleMs]);

  const setTyping = useCallback((typing: boolean) => {
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
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    return () => {
      if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current);
      client.ephemeral.delete(topic, key);
    };
  }, [client.ephemeral, key, topic]);

  const typingUsers = useMemo(() => {
    const cutoff = now - idleMs;
    return Object.entries(entries)
      .map(([entryKey, entry]) => readTypingMember(entryKey, entry.value))
      .filter((member): member is TypingIndicatorMember => {
        if (!member) return false;
        if (!includeSelf && member.userId === actorId) return false;
        return member.updatedAt >= cutoff;
      })
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }, [actorId, entries, idleMs, includeSelf, now]);

  return {
    topic,
    key,
    isTyping,
    isAnyoneTyping: typingUsers.length > 0,
    typingUsers,
    markTyping,
    setTyping,
    clearTyping,
  };
}
