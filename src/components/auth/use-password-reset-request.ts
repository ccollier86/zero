/** Native reset-request interaction and local resend guidance; server/outbox policy remains authoritative. */
import * as React from 'react';
import { useClientMaybe } from '../../frontend/client/client-context';
import { getAuthDisplayMessage, reportAuthUiError } from './auth-error';

const useLifetimeEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;
/** Use the uniform public policy, with the historical five-minute guidance for older servers. */
export function passwordResetRequestCooldown(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 300_000;
}

/** Own duplicate-submit, countdown and callback lifetime without storing email addresses or issuing automatic resends. */
export function usePasswordResetRequest(input: {
  submit: (email: string, nativeContinuation?: string) => Promise<void>;
  nativeContinuation: string | null;
  enabled: boolean;
  cooldownMs: number;
}) {
  const client = useClientMaybe();
  const owner = React.useMemo(() => ({ alive: true, pending: false, nextAllowedAt: 0 }), [client, input.nativeContinuation]);
  const [state, setState] = React.useState({ owner, loading: false, sent: false, error: null as string | null, now: 0 });
  const current = state.owner === owner ? state : { owner, loading: false, sent: false, error: null, now: 0 };
  useLifetimeEffect(() => { owner.alive = true; return () => { owner.alive = false; }; }, [owner]);
  React.useEffect(() => {
    if (!current.sent || owner.nextAllowedAt <= Date.now()) return;
    const timer = setInterval(() => {
      if (!owner.alive) return;
      const now = Date.now();
      setState(previous => previous.owner === owner ? { ...previous, now } : previous);
      if (now >= owner.nextAllowedAt) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [owner, current.sent, owner.nextAllowedAt]);
  const remainingSeconds = current.sent ? Math.max(0, Math.ceil((owner.nextAllowedAt - current.now) / 1000)) : 0;
  async function request(email: string) {
    if (!owner.alive || owner.pending || !input.enabled || owner.nextAllowedAt > Date.now()) return;
    owner.pending = true;
    setState({ ...current, owner, loading: true, error: null });
    try {
      await input.submit(email, input.nativeContinuation ?? undefined);
      if (!owner.alive) return;
      const now = Date.now();
      owner.nextAllowedAt = Math.min(Number.MAX_SAFE_INTEGER, now + input.cooldownMs);
      setState({ owner, loading: false, sent: true, error: null, now });
    } catch (error) {
      if (!owner.alive) return;
      reportAuthUiError('forgotPassword', error);
      setState({ ...current, owner, loading: false, error: getAuthDisplayMessage(error, 'The reset request could not be confirmed. Please try again.') });
    } finally { owner.pending = false; }
  }
  return { loading: current.loading, sent: current.sent, error: current.error, remainingSeconds, request };
}
