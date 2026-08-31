/** Deployment-aware controls for public native authorization traffic. */
export interface NativeAuthorizationRequestPolicyConfig {
  cleanupBatchSize?: number;
  maxOutstandingGlobal?: number;
  maxOutstandingPerClient?: number;
  maxOutstandingPerSource?: number;
  rollingWindow?: string;
  maxAdmissionsGlobal?: number;
  maxAdmissionsPerClient?: number;
  maxAdmissionsPerSource?: number;
  /** Proxy address/CIDR ranges allowed to supply the forwarded client chain. */
  trustedProxyRanges?: readonly string[];
  /** Forwarded client-chain header. Defaults to x-forwarded-for. */
  forwardedForHeader?: string;
  sourceKey?: NativeAuthorizationSourceResolver;
}

export interface ResolvedNativeAuthorizationRequestPolicy {
  cleanupBatchSize: number;
  maxOutstandingGlobal: number;
  maxOutstandingPerClient: number;
  maxOutstandingPerSource: number;
  rollingWindowMs: number;
  maxAdmissionsGlobal: number;
  maxAdmissionsPerClient: number;
  maxAdmissionsPerSource: number;
  trustedProxyRanges: string[];
  forwardedForHeader: string;
  sourceKey?: NativeAuthorizationSourceResolver;
}

/** Resolve a deployment-trusted source identifier, such as a proxy-vetted IP. */
export type NativeAuthorizationSourceResolver = (
  context: NativeAuthorizationSourceContext,
) => string | null | undefined;

export interface NativeAuthorizationSourceContext {
  request: Request;
  clientId: string;
  /** Direct socket peer reported by Bun, before forwarded headers are considered. */
  peerAddress?: string | null;
}

/** Rotation/storage controls for native refresh-token families. */
export interface NativeRefreshRotationPolicyConfig {
  cleanupBatchSize?: number;
  minRotationInterval?: string;
  maxRotationsPerFamily?: number;
  maxActiveFamiliesPerUserClient?: number;
}

export interface ResolvedNativeRefreshRotationPolicy {
  cleanupBatchSize: number;
  minRotationIntervalMs: number;
  maxRotationsPerFamily: number;
  maxActiveFamiliesPerUserClient: number;
}
