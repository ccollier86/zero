/**
 * use-idle.ts
 *
 * Provides user inactivity detection for reusable UI flows. This file owns
 * browser activity event tracking only; it does not enforce auth logout or
 * server session policy.
 */

import { useEffect, useState } from 'react';

export interface UseIdleOptions {
  /** Browser events that reset the idle timer. */
  events?: readonly string[];
  /** Initial state used before the hook mounts. */
  initialState?: boolean;
  /** Disable listeners without changing hook order. */
  disabled?: boolean;
}

const DEFAULT_IDLE_EVENTS = [
  'mousemove',
  'mousedown',
  'keydown',
  'touchstart',
  'wheel',
  'scroll',
  'pointerdown',
  'visibilitychange',
] as const;

/**
 * Return true after the user has had no configured activity for `timeoutMs`.
 *
 * The hook is SSR-safe and returns `initialState` until mounted. It is useful
 * for idle warnings, auto-lock UI, paused animations, and low-priority polling.
 */
export function useIdle(timeoutMs = 20_000, options: UseIdleOptions = {}): boolean {
  const [idle, setIdle] = useState(options.initialState ?? false);
  const events = options.events ?? DEFAULT_IDLE_EVENTS;
  const disabled = options.disabled ?? false;

  useEffect(() => {
    if (disabled || typeof window === 'undefined') return;

    if (timeoutMs <= 0) {
      setIdle(true);
      return;
    }

    const rootDocument = typeof document === 'undefined' ? null : document;
    let timeoutId: number | null = null;

    const clearTimer = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const scheduleIdle = () => {
      clearTimer();
      timeoutId = window.setTimeout(() => setIdle(true), timeoutMs);
    };

    const markActive = (event?: Event) => {
      if (event?.type === 'visibilitychange' && rootDocument?.hidden) {
        setIdle(true);
        clearTimer();
        return;
      }

      setIdle(false);
      scheduleIdle();
    };

    events.forEach((eventName) => {
      const target: Window | Document | null =
        eventName === 'visibilitychange' ? rootDocument : window;
      if (!target) return;

      target.addEventListener(eventName, markActive, { passive: true });
    });
    markActive();

    return () => {
      clearTimer();
      events.forEach((eventName) => {
        const target: Window | Document | null =
          eventName === 'visibilitychange' ? rootDocument : window;
        if (!target) return;

        target.removeEventListener(eventName, markActive);
      });
    };
  }, [disabled, events, timeoutMs]);

  return idle;
}
