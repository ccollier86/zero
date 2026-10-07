'use client';

/**
 * Presents a safe retry for an unavailable post-purge authorization projection.
 * This rendering boundary consumes AuthClient's existing authorization read;
 * it never rotates credentials, changes organization, or renders old data.
 */
import { useEffect, useRef, useState } from 'react';
import type { AuthClient } from './auth-client';
import { reportAuthClientActionFailure } from './auth-action-observability';
import { Button } from '../../components/ui/button';
import { AuthSessionRecoveryRequest } from './auth-session-recovery-request';
import { readAuthorizationScopeIdentityKey } from './authorization-scope-hooks';
import type { AuthorizationDataBoundarySource } from './authorization-data-boundary';

/** Retry only the current family's access hint while its application stays masked. */
export function AuthorizationHintRecovery({ auth, dataBoundary, checking }: {
  auth: AuthClient;
  dataBoundary: AuthorizationDataBoundarySource;
  checking: boolean;
}) {
  const [pending, setPending] = useState(false);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const requestRef = useRef<AuthSessionRecoveryRequest | null>(null);
  const generationRef = useRef(0);
  useEffect(() => {
    generationRef.current += 1;
    mounted.current = true;
    inFlight.current = false;
    setPending(false);
    return () => {
      mounted.current = false;
      generationRef.current += 1;
      requestRef.current?.cancel();
      requestRef.current = null;
      inFlight.current = false;
    };
  }, [auth, dataBoundary]);
  const retry = async () => {
    if (!mounted.current || inFlight.current) return;
    const identityKey = readAuthorizationScopeIdentityKey(auth), revision = dataBoundary.revision;
    const transitionRevision = auth.sessionTransition.revision;
    const generation = generationRef.current;
    const current = () => mounted.current && generationRef.current === generation
      && readAuthorizationScopeIdentityKey(auth) === identityKey
      && dataBoundary.revision === revision && auth.sessionTransition.revision === transitionRevision;
    const request = new AuthSessionRecoveryRequest();
    requestRef.current = request;
    inFlight.current = true;
    setPending(true);
    try {
      const result = await request.run(signal => auth.refreshAuthorization(signal));
      if (!result && current()) {
        reportAuthClientActionFailure('authorizationHintRecovery', new Error('Current access unavailable'), { codeOnly: true });
      }
    } catch (cause) {
      if (current()) {
        reportAuthClientActionFailure('authorizationHintRecovery', cause, { codeOnly: true });
      }
    } finally {
      request.cancel();
      if (requestRef.current === request) {
        requestRef.current = null;
        inFlight.current = false;
        if (current()) setPending(false);
      }
    }
  };
  return <main role="alert" data-zero-authorization-recovery
    className="grid min-h-screen place-content-center gap-4 px-6 py-10 text-foreground">
    <h1 className="text-lg font-semibold tracking-tight">Unable to refresh access</h1>
    <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
      Current access could not be confirmed. Retry to check it safely before continuing.
    </p>
    <Button type="button" size="sm" disabled={pending || checking} onClick={() => { void retry(); }}>
      {pending || checking ? 'Checking access…' : 'Retry access'}
    </Button>
  </main>;
}
