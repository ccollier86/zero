/** Safely invokes the deployment-owned native authorization source resolver. */

import { NativeAuthorizationError } from '../native';
import type { ResolvedNativeAuthorizationRequestPolicy } from '../native/policy-types';
import { createNativePeerSourceResolver } from '../native/trusted-proxy-source';

export function resolveNativeRequestSource(
  policy: ResolvedNativeAuthorizationRequestPolicy,
  request: Request | undefined,
  clientId: string,
  peerAddress?: string | null,
): string | null {
  if (!request) return null;
  const resolver = policy.sourceKey ?? createNativePeerSourceResolver(policy);
  let value: unknown;
  try {
    value = resolver({ request, clientId, peerAddress });
  } catch {
    throw new NativeAuthorizationError(
      'temporarily_unavailable', 'Authorization is temporarily unavailable.', 503,
    );
  }
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new NativeAuthorizationError(
      'temporarily_unavailable', 'Authorization is temporarily unavailable.', 503,
    );
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 512) {
    throw new NativeAuthorizationError(
      'temporarily_unavailable', 'Authorization is temporarily unavailable.', 503,
    );
  }
  return normalized;
}
