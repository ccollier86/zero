'use client';

/** Owns one password-link form lifecycle. Server/SDK own proof validation and atomic credential replacement. */
import * as React from 'react';
import { useAuth } from '../../frontend/client/auth-hooks';
import { useClientMaybe } from '../../frontend/client/client-context';
import type { AuthActionTokenInfo } from '../../frontend/client/auth-types';
import { AUTH_REQUEST_LIMITS } from '../../auth/auth-request-limits';
import { reportAuthClientActionFailure } from '../../frontend/client/auth-action-observability';
import { resolvePasswordAction } from './password-action-policy';
import { isAuthFlowContinuationResult, type AuthFlowContinuationResult } from './auth-continuation';
import { isConfirmedPasswordUpdate, isPasswordActionInspection, passwordActionFailure, passwordActionProblem, type PasswordActionProblem } from './password-action-recovery';
import { rememberPasswordActionCompletion, usePasswordActionCompletion } from './password-action-completion';

// Retire callbacks when React commits removal, not after a later passive effect.
const useCommitEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

type Mode = 'auto' | 'reset' | 'setup';
type Phase = 'checking' | 'ready' | 'submitting' | 'problem' | 'complete' | 'continuation';
interface Owner { active: boolean; inFlight: boolean; settled: boolean }
interface Snapshot {
  owner: Owner; phase: Phase; info: AuthActionTokenInfo | null; password: string; confirm: string;
  error: string | null; problem: PasswordActionProblem | null; continuation: AuthFlowContinuationResult | null;
}

/** Retire old links/clients and late callbacks; a manual Retry performs inspection only, never a password write. */
export function usePasswordAction(token: string, mode: Mode, onSuccess?: () => void) {
  const client = useClientMaybe();
  const auth = useAuth();
  const completion = usePasswordActionCompletion(client, token, mode);
  const retainedContinuation = isAuthFlowContinuationResult(auth.authenticationContinuation)
    ? auth.authenticationContinuation : null;
  const owner = React.useMemo<Owner>(() => ({ active: false, inFlight: false, settled: false }), [client, token, mode]);
  const current = React.useRef<Owner | null>(null);
  const initial = React.useMemo<Snapshot>(() => ({ owner, phase: token ? 'checking' : 'problem', info: null,
    password: '', confirm: '', error: null, problem: token ? null : passwordActionProblem('missing'), continuation: null }), [owner]);
  const [stored, setStored] = React.useState(initial);
  const state = stored.owner === owner ? stored : initial;
  const latest = React.useRef(state);
  const success = React.useRef(onSuccess);
  const [inspection, setInspection] = React.useState(0);
  const isCurrent = () => current.current === owner && owner.active;
  const update = (change: Partial<Snapshot>) => {
    if (!isCurrent()) return;
    setStored(previous => ({ ...(previous.owner === owner ? previous : initial), ...change }));
  };
  useCommitEffect(() => {
    owner.active = true; current.current = owner;
    return () => { owner.active = false; if (current.current === owner) current.current = null; };
  }, [owner]);
  useCommitEffect(() => { latest.current = state; success.current = onSuccess; });

  React.useEffect(() => {
    if (!token || completion || retainedContinuation || owner.inFlight || owner.settled) return;
    if (token.length > AUTH_REQUEST_LIMITS.token) {
      update({ phase: 'problem', problem: passwordActionProblem('invalid') });
      return;
    }
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    update({ phase: 'checking', info: null, error: null, problem: null });
    void (async () => {
      try {
        const info = await auth.inspectActionToken(token, controller.signal);
        if (!active || !isCurrent()) return;
        if (info?.valid === false) return update({ phase: 'problem', problem: passwordActionProblem('invalid') });
        if (!isPasswordActionInspection(info)) return update({ phase: 'problem', problem: passwordActionProblem('unavailable') });
        if (!resolvePasswordAction(mode, info)) {
          return update({ phase: 'problem', problem: passwordActionProblem('mismatch') });
        }
        update({ phase: 'ready', info });
      } catch (cause) {
        if (!active || !isCurrent()) return;
        reportAuthClientActionFailure('inspectPasswordAction', cause, { codeOnly: true });
        update({ phase: 'problem', info: null, problem: passwordActionFailure(cause, 'inspection') });
      } finally { clearTimeout(timeout); }
    })();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
    // Healthy SDK policy snapshots can replace callback identities. They must
    // not silently retry a failed check or make its Retry button disappear.
    // A new link/client or an explicit retry starts the next current read.
  }, [owner, inspection, completion, retainedContinuation]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const before = latest.current;
    if (!isCurrent() || before.owner !== owner || before.phase !== 'ready' || owner.inFlight || owner.settled || !before.info) return;
    const action = resolvePasswordAction(mode, before.info);
    if (!action) return;
    if (before.password.length < 8) return update({ error: 'Password must be at least 8 characters.' });
    if (before.password.length > AUTH_REQUEST_LIMITS.password) return update({ error: 'Password is too long. Use at most 1,024 characters.' });
    if (before.password !== before.confirm) return update({ error: 'Passwords do not match.' });
    owner.inFlight = true;
    update({ phase: 'submitting', error: null });
    try {
      const result = action === 'setup'
        ? await auth.setupPassword(token, before.password)
        : await auth.resetPassword(token, before.password);
      // An intentional sign-out may already have retired this React view.
      // Only the matching accepted SDK continuation can inform its remount.
      rememberPasswordActionCompletion(client, token, action, before.info, result);
      if (!isCurrent()) return;
      owner.settled = true;
      if (isAuthFlowContinuationResult(result)) {
        update({ phase: 'continuation', continuation: result, password: '', confirm: '' });
        return;
      }
      if (!isConfirmedPasswordUpdate(result, before.info)) {
        update({ phase: 'problem', problem: passwordActionProblem('unknown'), password: '', confirm: '' });
        return;
      }
      update({ phase: 'complete', password: '', confirm: '' });
      // Host notification is not part of the accepted credential operation.
      try {
        void Promise.resolve(success.current?.()).catch(cause => {
          if (isCurrent()) reportAuthClientActionFailure('passwordActionSuccessCallback', cause, { codeOnly: true });
        });
      } catch (cause) { reportAuthClientActionFailure('passwordActionSuccessCallback', cause, { codeOnly: true }); }
    } catch (cause) {
      if (!isCurrent()) return;
      const problem = passwordActionFailure(cause, 'submission');
      owner.settled = problem.kind !== 'rejected';
      reportAuthClientActionFailure('completePasswordAction', cause, { codeOnly: true });
      update({ phase: 'problem', problem, password: '', confirm: '' });
    } finally { owner.inFlight = false; }
  }

  return { ...state, ...(completion ? { phase: 'complete' as const, password: '', confirm: '', error: null, problem: null }
    : retainedContinuation ? { phase: 'continuation' as const, continuation: retainedContinuation } : {}), submit,
    setPassword: (password: string) => update({ password, error: null }),
    setConfirm: (confirm: string) => update({ confirm, error: null }),
    retry() { if (isCurrent() && latest.current.problem?.retry && !owner.inFlight && !owner.settled) setInspection(value => value + 1); },
    clearContinuation() { auth.clearAuthenticationContinuation(); update({ phase: 'problem', continuation: null, problem: passwordActionProblem('used') }); },
  };
}
