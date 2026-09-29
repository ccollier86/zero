'use client';

import * as React from 'react';
import type {
  AuthDomainOnboardingAdmissionResult,
  AuthDomainOnboardingCompletion,
  AuthDomainOnboardingStatus,
  AuthTenantDomainAdministration,
  AuthTenantDomainClaim,
  AuthTenantDomainDnsChallenge,
  AuthTenantDomainReleaseResult,
} from './auth-domain-types';
import { reportAuthClientActionFailure } from './auth-action-observability';
import { useAuth } from './auth-hooks';
import { useAuthorizationScopeBoundary } from './authorization-scope-hooks';
import { useClientMaybe } from './client-context';
import type { InternalClient } from './sdk';
import {
  isTenantAdministrationScopeStable,
  TenantAdministrationBoundaryFence,
  tenantAdministrationBoundaryKey,
} from './tenant-administration-hooks';

export interface UseTenantDomainAdministrationOptions {
  enabled?: boolean;
}

export interface UseTenantDomainAdministrationResult {
  administration: AuthTenantDomainAdministration | null;
  claims: readonly AuthTenantDomainClaim[];
  challenge: AuthTenantDomainDnsChallenge | null;
  challengeClaimId: string | null;
  isLoading: boolean;
  isMutating: boolean;
  error: string | null;
  reload(): void;
  dismissChallenge(): void;
  createClaim(domain: string): Promise<AuthTenantDomainClaim>;
  issueChallenge(claimId: string): Promise<AuthTenantDomainClaim>;
  verifyClaim(claimId: string): Promise<AuthTenantDomainClaim>;
  updatePolicy(
    claimId: string,
    update: { enabled: boolean; requestRoleKey: string | null },
  ): Promise<AuthTenantDomainClaim>;
  releaseClaim(
    claimId: string,
    confirmDomain: string,
  ): Promise<AuthTenantDomainReleaseResult['release']>;
}

/** Active-tenant verified-domain controls with identity/scope-safe caching. */
export function useTenantDomainAdministration(
  options: UseTenantDomainAdministrationOptions = {},
): UseTenantDomainAdministrationResult {
  const client = useClientMaybe() as InternalClient | null;
  const authClient = client?.auth ?? null;
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const auth = useAuth();
  const enabled = options.enabled !== false
    && Boolean(authClient && auth.isAuthenticated && auth.activeTenant)
    && isTenantAdministrationScopeStable(auth.sessionTransition);
  const boundaryKey = tenantAdministrationBoundaryKey(
    auth.user?.userId,
    auth.activeTenant?.tenantId,
    enabled,
    authorizationBoundary.key,
  );
  const fenceRef = React.useRef<TenantAdministrationBoundaryFence | null>(null);
  if (!fenceRef.current) fenceRef.current = new TenantAdministrationBoundaryFence();
  const fence = fenceRef.current;
  const boundaryRevision = fence.update(boundaryKey);
  const [administration, setAdministration] = React.useState<
    AuthTenantDomainAdministration | null
  >(null);
  const [challengeState, setChallengeState] = React.useState<{
    claimId: string;
    challenge: AuthTenantDomainDnsChallenge;
  } | null>(null);
  const [loadedBoundaryRevision, setLoadedBoundaryRevision] = React.useState(-1);
  const [isLoading, setLoading] = React.useState(enabled);
  const [isMutating, setMutating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadRevision, setReloadRevision] = React.useState(0);
  const queryRevision = React.useRef(0);
  const mutationRevision = React.useRef(0);

  React.useEffect(() => {
    const operationBoundary = boundaryRevision;
    const operationRevision = ++queryRevision.current;
    const abort = new AbortController();
    setLoadedBoundaryRevision(operationBoundary);
    setAdministration(null);
    setChallengeState(null);
    setMutating(false);
    if (!enabled || !authClient) {
      setLoading(false);
      setError(null);
      return () => abort.abort();
    }
    setLoading(true);
    setError(null);
    void authClient.getTenantDomainAdministration(abort.signal).then((result) => {
      if (fence.isCurrent(operationBoundary)
        && operationRevision === queryRevision.current) setAdministration(result);
    }).catch((cause) => {
      if (isAbortError(cause)) return;
      if (fence.isCurrent(operationBoundary)
        && operationRevision === queryRevision.current) setError(errorMessage(cause));
    }).finally(() => {
      if (fence.isCurrent(operationBoundary)
        && operationRevision === queryRevision.current) setLoading(false);
    });
    return () => abort.abort();
  }, [authClient, boundaryRevision, enabled, fence, reloadRevision]);

  const reload = React.useCallback(() => {
    if (fence.isCurrent(boundaryRevision)) {
      setReloadRevision((value) => value + 1);
    }
  }, [boundaryRevision, fence]);
  const mutate = React.useCallback(async <T,>(
    operation: () => Promise<T>,
    apply: (result: T) => void,
  ): Promise<T> => {
    const operationBoundary = boundaryRevision;
    if (!fence.isCurrent(operationBoundary)) throw staleDomainOperation();
    const operationRevision = ++mutationRevision.current;
    setMutating(true);
    setError(null);
    try {
      const result = await operation();
      if (!fence.isCurrent(operationBoundary)) throw staleDomainOperation();
      if (operationRevision === mutationRevision.current) apply(result);
      return result;
    } catch (cause) {
      if (!fence.isCurrent(operationBoundary)) throw staleDomainOperation();
      if (fence.isCurrent(operationBoundary)
        && operationRevision === mutationRevision.current) setError(errorMessage(cause));
      throw cause;
    } finally {
      if (fence.isCurrent(operationBoundary)
        && operationRevision === mutationRevision.current) setMutating(false);
    }
  }, [boundaryRevision, fence]);

  const hasCurrentData = enabled && loadedBoundaryRevision === boundaryRevision;
  const currentAdministration = hasCurrentData ? administration : null;

  const requireClaim = React.useCallback((claimId: string): AuthTenantDomainClaim => {
    const claim = currentAdministration?.claims.find((candidate) => (
      candidate.claimId === claimId
    ));
    if (!claim) throw staleDomainTarget();
    return claim;
  }, [currentAdministration]);

  return {
    administration: currentAdministration,
    claims: currentAdministration?.claims ?? [],
    challenge: hasCurrentData ? challengeState?.challenge ?? null : null,
    challengeClaimId: hasCurrentData ? challengeState?.claimId ?? null : null,
    isLoading: enabled && (!hasCurrentData || isLoading),
    isMutating: hasCurrentData && isMutating,
    error: hasCurrentData ? error : null,
    reload,
    dismissChallenge: React.useCallback(() => {
      if (fence.isCurrent(boundaryRevision)) setChallengeState(null);
    }, [boundaryRevision, fence]),
    createClaim: React.useCallback(async (domain: string) => {
      if (!authClient) throw domainUnavailable();
      const result = await mutate(
        () => authClient.createTenantDomainClaim(domain),
        (next) => {
          setAdministration((current) => current && ({
            ...current,
            claims: replaceClaim(current.claims, next.claim),
          }));
          setChallengeState({ claimId: next.claim.claimId, challenge: next.challenge });
        },
      );
      return result.claim;
    }, [authClient, mutate]),
    issueChallenge: React.useCallback(async (claimId: string) => {
      if (!authClient) throw domainUnavailable();
      const claim = requireClaim(claimId);
      const result = await mutate(
        () => authClient.issueTenantDomainChallenge(claimId, claim.revision),
        (next) => {
          setAdministration((current) => current && ({
            ...current,
            claims: replaceClaim(current.claims, next.claim),
          }));
          setChallengeState({ claimId: next.claim.claimId, challenge: next.challenge });
        },
      );
      return result.claim;
    }, [authClient, mutate, requireClaim]),
    verifyClaim: React.useCallback(async (claimId: string) => {
      if (!authClient) throw domainUnavailable();
      const claim = requireClaim(claimId);
      const result = await mutate(
        () => authClient.verifyTenantDomainClaim(claimId, claim.revision),
        (next) => {
          setAdministration((current) => current && ({
            ...current,
            claims: replaceClaim(current.claims, next.claim),
          }));
          setChallengeState(null);
        },
      );
      return result.claim;
    }, [authClient, mutate, requireClaim]),
    updatePolicy: React.useCallback(async (claimId, update) => {
      if (!authClient) throw domainUnavailable();
      const claim = requireClaim(claimId);
      const result = await mutate(
        () => authClient.updateTenantDomainPolicy(claimId, {
          ...update,
          expectedRevision: claim.policy.revision,
        }),
        (next) => setAdministration((current) => current && ({
          ...current,
          claims: replaceClaim(current.claims, next.claim),
        })),
      );
      return result.claim;
    }, [authClient, mutate, requireClaim]),
    releaseClaim: React.useCallback(async (claimId, confirmDomain) => {
      if (!authClient) throw domainUnavailable();
      const claim = requireClaim(claimId);
      const result = await mutate(
        () => authClient.releaseTenantDomainClaim(claimId, {
          expectedRevision: claim.revision,
          expectedPolicyRevision: claim.policy.revision,
          confirmDomain,
        }),
        (next) => {
          setAdministration((current) => current && removeReleasedDomainClaim(
            current,
            next.release.claimId,
          ));
          setChallengeState((current) => (
            current?.claimId === next.release.claimId ? null : current
          ));
        },
      );
      return result.release;
    }, [authClient, mutate, requireClaim]),
  };
}

/** Apply a committed release receipt without exposing retired private history. */
export function removeReleasedDomainClaim(
  administration: AuthTenantDomainAdministration,
  releasedClaimId: string,
): AuthTenantDomainAdministration {
  return Object.freeze({
    ...administration,
    claims: Object.freeze(administration.claims.filter((claim) => (
      claim.claimId !== releasedClaimId
    ))),
  });
}

export interface UseDomainOnboardingOptions {
  enabled?: boolean;
  /** Pre-session identity proof from the shared completion flow, when present. */
  identityContinuation?: string;
}

export interface UseDomainOnboardingResult {
  status: AuthDomainOnboardingStatus;
  completion: AuthDomainOnboardingCompletion | null;
  admission: AuthDomainOnboardingAdmissionResult | null;
  error: string | null;
  start(): Promise<void>;
  complete(proofToken: string): Promise<AuthDomainOnboardingCompletion>;
  admit(): Promise<AuthDomainOnboardingAdmissionResult>;
  reset(): void;
}

/** Generic-before-proof verified-domain request-to-join state machine. */
export function useDomainOnboarding(
  options: UseDomainOnboardingOptions = {},
): UseDomainOnboardingResult {
  const client = useClientMaybe() as InternalClient | null;
  const authClient = client?.auth ?? null;
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const auth = useAuth();
  const enabled = options.enabled !== false && Boolean(authClient)
    && isTenantAdministrationScopeStable(auth.sessionTransition);
  const boundaryKey = domainOnboardingBoundaryKey(
    auth.user?.userId,
    auth.activeTenant?.tenantId,
    options.identityContinuation,
    enabled,
    authorizationBoundary.key,
  );
  const fenceRef = React.useRef<TenantAdministrationBoundaryFence | null>(null);
  if (!fenceRef.current) fenceRef.current = new TenantAdministrationBoundaryFence();
  const fence = fenceRef.current;
  const boundaryRevision = fence.update(boundaryKey);
  const [state, setState] = React.useState<{
    boundaryRevision: number;
    status: AuthDomainOnboardingStatus;
    completion: AuthDomainOnboardingCompletion | null;
    admission: AuthDomainOnboardingAdmissionResult | null;
    error: string | null;
  }>({
    boundaryRevision,
    status: 'idle',
    completion: null,
    admission: null,
    error: null,
  });
  const operationRevision = React.useRef(0);

  React.useEffect(() => {
    operationRevision.current += 1;
    setState({
      boundaryRevision,
      status: 'idle',
      completion: null,
      admission: null,
      error: null,
    });
  }, [boundaryRevision, fence]);

  const current = state.boundaryRevision === boundaryRevision && enabled
    ? state
    : {
        boundaryRevision,
        status: 'idle' as const,
        completion: null,
        admission: null,
        error: null,
      };

  const reset = React.useCallback(() => {
    if (!fence.isCurrent(boundaryRevision)) return;
    operationRevision.current += 1;
    setState({
      boundaryRevision,
      status: 'idle',
      completion: null,
      admission: null,
      error: null,
    });
  }, [boundaryRevision, fence]);

  const run = React.useCallback(async <T,>(
    status: AuthDomainOnboardingStatus,
    operation: () => Promise<T>,
    apply: (result: T) => Omit<typeof state, 'boundaryRevision'>,
  ): Promise<T> => {
    if (!authClient || !enabled) throw domainUnavailable();
    const expectedBoundary = boundaryRevision;
    if (!fence.isCurrent(expectedBoundary)) throw staleDomainOperation();
    const expectedOperation = ++operationRevision.current;
    setState({
      boundaryRevision: expectedBoundary,
      status,
      completion: current.completion,
      admission: current.admission,
      error: null,
    });
    try {
      const result = await operation();
      if (!fence.isCurrent(expectedBoundary)
        || expectedOperation !== operationRevision.current) throw staleDomainOperation();
      setState({ boundaryRevision: expectedBoundary, ...apply(result) });
      return result;
    } catch (cause) {
      if (!fence.isCurrent(expectedBoundary)) throw staleDomainOperation();
      if (fence.isCurrent(expectedBoundary)
        && expectedOperation === operationRevision.current) {
        setState({
          boundaryRevision: expectedBoundary,
          status: 'error',
          completion: null,
          admission: null,
          error: errorMessage(cause),
        });
      }
      throw cause;
    }
  }, [authClient, boundaryRevision, current, enabled, fence]);

  return {
    status: current.status,
    completion: current.completion,
    admission: current.admission,
    error: current.error,
    start: React.useCallback(async () => {
      await run(
        'starting',
        () => authClient!.startDomainOnboarding(options.identityContinuation),
        () => ({
          status: 'proof-pending',
          completion: null,
          admission: null,
          error: null,
        }),
      );
    }, [authClient, options.identityContinuation, run]),
    complete: React.useCallback((proofToken: string) => run(
      'completing',
      () => authClient!.completeDomainOnboarding(proofToken),
      (completion) => ({
        status: completion.option.action === 'request-pending' ? 'submitted' : 'ready',
        completion,
        admission: null,
        error: null,
      }),
    ), [authClient, run]),
    admit: React.useCallback(async () => {
      const completion = current.completion;
      if (!completion || !('continuation' in completion)
        || completion.option.action !== 'request-to-join') {
        throw new Error('Complete company email verification before requesting access');
      }
      const continuation = completion.continuation;
      return run(
        'admitting',
        () => authClient!.admitDomainOnboarding(
          continuation,
          options.identityContinuation,
        ),
        (admission) => ({
          status: 'submitted',
          completion: null,
          admission,
          error: null,
        }),
      );
    }, [authClient, current.completion, options.identityContinuation, run]),
    reset,
  };
}

/** @internal Identity/proof boundary for generic-before-proof onboarding state. */
export function domainOnboardingBoundaryKey(
  userId?: string,
  tenantId?: string,
  identityContinuation?: string,
  enabled = true,
  authorizationScopeKey?: string,
): string | null {
  return enabled ? JSON.stringify([
    authorizationScopeKey ?? null,
    userId ?? null,
    tenantId ?? null,
    identityContinuation ?? null,
  ]) : null;
}

function replaceClaim(
  claims: readonly AuthTenantDomainClaim[],
  claim: AuthTenantDomainClaim,
): readonly AuthTenantDomainClaim[] {
  const next = claims.filter((candidate) => candidate.claimId !== claim.claimId);
  return Object.freeze([...next, claim]);
}

function errorMessage(cause: unknown): string {
  reportAuthClientActionFailure(
    'verifiedDomainOnboarding',
    cause,
    { codeOnly: true },
  );
  return cause instanceof Error ? cause.message : 'Verified-domain request failed';
}

function domainUnavailable(): Error {
  return new Error('Verified-domain onboarding is unavailable');
}

function staleDomainTarget(): Error {
  return new Error('Reload verified domains before changing this claim');
}

function staleDomainOperation(): Error {
  return new Error('The identity or tenant scope changed before this request completed');
}

function isAbortError(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null
    && 'name' in cause && cause.name === 'AbortError';
}
