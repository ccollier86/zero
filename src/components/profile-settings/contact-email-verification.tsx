'use client';

/** Public email-link landing component. Explicit admission prevents one-time proof consumption twice under Strict Mode. */
import { useEffect, useRef, useState } from 'react';
import { MailCheck } from 'lucide-react';
import { useClientMaybe } from '../../frontend/client/client-context';
import type { InternalClient } from '../../frontend/client/sdk';
import { readAuthorizationScopeBoundaryKey } from '../../frontend/client/authorization-scope-hooks';
import { reportAuthClientActionFailure } from '../../frontend/client/auth-action-observability';
import { userContactError } from '../../frontend/client/user-contact-errors';
import type { EmailContactVerificationResult } from '../../auth/auth-user-contact-types';
import { Button } from '../ui/button';

export interface ContactEmailVerificationProps {
  /** Omit to read ?token= from the current link. Tokens are removed from browser history after capture. */
  token?: string;
  onVerified?(result: EmailContactVerificationResult): void | Promise<void>;
  onSignIn?(): void;
  className?: string;
}
export function ContactEmailVerification({ token, onVerified, onSignIn, className }: ContactEmailVerificationProps) {
  const client = useClientMaybe();
  const [linkProof] = useState(() => typeof window === 'undefined' ? '' : new URL(window.location.href).searchParams.get('token') ?? '');
  const proof = token ?? linkProof;
  const [pending, setPending] = useState(false), [result, setResult] = useState<EmailContactVerificationResult | null>(null), [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null), active = useRef(true), latest = useRef(onVerified); latest.current = onVerified;
  const latestProof = useRef(proof); latestProof.current = proof;
  useEffect(() => {
    request.current?.abort(); request.current = null; setResult(null); setError(null); setPending(false);
  }, [proof]);
  useEffect(() => {
    active.current = true;
    if (token === undefined) {
      const url = new URL(window.location.href); url.searchParams.delete('token');
      window.history.replaceState(window.history.state, '', url);
    }
    return () => { active.current = false; request.current?.abort(); };
  }, [token]);
  const verify = async () => {
    if (!client || !proof || request.current || result) return;
    const controller = new AbortController(), internal = client as InternalClient;
    const capturedUser = internal.auth?.user?.userId;
    const key = readAuthorizationScopeBoundaryKey(internal.auth, internal._authorizationDataBoundary?.revision ?? 0);
    request.current = controller; setPending(true); setError(null);
    const current = (accepted?: EmailContactVerificationResult) => active.current && latestProof.current === proof && !controller.signal.aborted && request.current === controller
      && (readAuthorizationScopeBoundaryKey(internal.auth, internal._authorizationDataBoundary?.revision ?? 0) === key
        || accepted?.requiresSignIn && accepted.userId === capturedUser && !internal.auth?.user);
    try {
      const accepted = await client.userContacts.completeEmail(proof, controller.signal);
      if (!current(accepted)) return;
      setResult(accepted);
      try { await latest.current?.(accepted); }
      catch (cause) { if (current(accepted)) reportAuthClientActionFailure('contactEmailAcceptedCallback', cause, { codeOnly: true }); }
    } catch (cause) {
      if (!current()) return;
      reportAuthClientActionFailure('contactEmailVerification', cause, { codeOnly: true }); setError(userContactError(cause));
    } finally { if (request.current === controller) { request.current = null; if (active.current) setPending(false); } }
  };
  return <section className={className} aria-label="Email contact verification">
    <h1 className="text-lg font-semibold">Verify your email</h1>
    {result ? <><p role="status" className="text-sm">{result.requiresSignIn ? 'Your new email is verified and your sign-in address has changed. Sign in again to continue.' : 'Your email ownership has been verified.'}</p>
      {result.requiresSignIn && onSignIn && <Button type="button" size="sm" onClick={onSignIn}>Sign in</Button>}</>
      : <><p className="text-sm text-muted-foreground">{proof ? 'Confirm the email verification you requested. This link can be used only once.' : 'This verification link is missing its proof. Request a new verification from your contact settings.'}</p>
        {error && <p role="alert" className="profile-settings__contact-error">{error}</p>}
        <Button type="button" size="sm" disabled={!client || !proof || pending} onClick={() => { void verify(); }}><MailCheck />{pending ? 'Verifying…' : 'Verify email'}</Button></>}
  </section>;
}
