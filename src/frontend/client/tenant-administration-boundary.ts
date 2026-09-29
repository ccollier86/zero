import type { AuthSessionTransitionState } from './auth-types';

/** @internal Identity + tenant boundary used by tenant-scoped hook caches. */
export function tenantAdministrationBoundaryKey(
  userId: string | undefined,
  tenantId: string | undefined,
  enabled = true,
  authorizationScopeKey?: string,
): string | null {
  return enabled && userId && tenantId
    ? JSON.stringify([authorizationScopeKey ?? null, userId, tenantId])
    : null;
}

/** @internal Only committed/recoverable session scopes may back tenant UI. */
export function isTenantAdministrationScopeStable(
  transition: AuthSessionTransitionState,
): boolean {
  return transition.phase === 'idle' || transition.phase === 'recovery-required';
}

/** @internal Monotonic fence for suppressing async work from a prior boundary. */
export class TenantAdministrationBoundaryFence {
  private key: string | null | undefined;
  private revision = 0;

  update(key: string | null): number {
    if (key !== this.key) {
      this.key = key;
      this.revision += 1;
    }
    return this.revision;
  }

  isCurrent(revision: number): boolean {
    return revision === this.revision;
  }
}
