'use client';

import * as React from 'react';
import { normalizeNativeAuthContinuation } from '../../auth/native/continuation';

/** Read the validated native authorization continuation from this auth page. */
export function useNativeAuthContinuation(): string | null {
  const [continuation, setContinuation] = React.useState<string | null>(
    readNativeAuthContinuation
  );
  React.useEffect(() => {
    setContinuation(readNativeAuthContinuation());
  }, []);
  return continuation;
}

/** Preserve a pending native authorization across login/registration links. */
export function useNativeAuthRoute(href: string): string {
  const [resolved, setResolved] = React.useState(href);
  const continuation = useNativeAuthContinuation();
  React.useEffect(() => {
    const current = new URL(window.location.href);
    if (!continuation || href.startsWith('#')) return setResolved(href);
    const target = new URL(href, current.origin);
    if (target.origin !== current.origin) return setResolved(href);
    target.searchParams.set('redirect', continuation);
    const loginHint = current.searchParams.get('login_hint');
    if (loginHint && loginHint.length <= 254) target.searchParams.set('login_hint', loginHint);
    setResolved(`${target.pathname}${target.search}${target.hash}`);
  }, [continuation, href]);
  return resolved;
}

/** Read the provider-supplied identifier hint without trusting it as identity. */
export function useNativeLoginHint(): string {
  const [hint, setHint] = React.useState('');
  React.useEffect(() => {
    const value = new URL(window.location.href).searchParams.get('login_hint')?.trim() ?? '';
    setHint(value.length <= 254 && !/[\u0000-\u001f\u007f]/.test(value) ? value : '');
  }, []);
  return hint;
}

function readNativeAuthContinuation(): string | null {
  if (typeof window === 'undefined') return null;
  const current = new URL(window.location.href);
  return normalizeNativeAuthContinuation(current.searchParams.get('redirect'));
}
