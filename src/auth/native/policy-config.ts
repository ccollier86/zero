import type {
  NativeAuthorizationRequestPolicyConfig,
  NativeRefreshRotationPolicyConfig,
  ResolvedNativeAuthorizationRequestPolicy,
  ResolvedNativeRefreshRotationPolicy,
} from './policy-types';
import { createNativePeerSourceResolver } from './trusted-proxy-source';

export const DEFAULT_NATIVE_REQUEST_POLICY: ResolvedNativeAuthorizationRequestPolicy = {
  cleanupBatchSize: 100,
  maxOutstandingGlobal: 1_000,
  maxOutstandingPerClient: 100,
  maxOutstandingPerSource: 20,
  rollingWindowMs: 60_000,
  maxAdmissionsGlobal: 300,
  maxAdmissionsPerClient: 60,
  maxAdmissionsPerSource: 20,
  trustedProxyRanges: [],
  forwardedForHeader: 'x-forwarded-for',
};

export const DEFAULT_NATIVE_REFRESH_POLICY: ResolvedNativeRefreshRotationPolicy = {
  cleanupBatchSize: 100,
  minRotationIntervalMs: 30_000,
  maxRotationsPerFamily: 4_096,
  maxActiveFamiliesPerUserClient: 10,
};

export function resolveNativeRequestPolicy(
  input: NativeAuthorizationRequestPolicyConfig = {},
): ResolvedNativeAuthorizationRequestPolicy {
  assertSourcePolicy(input);
  const trustedProxyRanges = [...(input.trustedProxyRanges ?? [])];
  const forwardedForHeader = input.forwardedForHeader ?? 'x-forwarded-for';
  return {
    cleanupBatchSize: positive(input.cleanupBatchSize, 100, 'cleanupBatchSize', 10_000),
    maxOutstandingGlobal: positive(input.maxOutstandingGlobal, 1_000, 'maxOutstandingGlobal'),
    maxOutstandingPerClient: positive(input.maxOutstandingPerClient, 100, 'maxOutstandingPerClient'),
    maxOutstandingPerSource: positive(input.maxOutstandingPerSource, 20, 'maxOutstandingPerSource'),
    rollingWindowMs: duration(input.rollingWindow ?? '1m', 'rollingWindow', 86_400_000),
    maxAdmissionsGlobal: positive(input.maxAdmissionsGlobal, 300, 'maxAdmissionsGlobal'),
    maxAdmissionsPerClient: positive(input.maxAdmissionsPerClient, 60, 'maxAdmissionsPerClient'),
    maxAdmissionsPerSource: positive(input.maxAdmissionsPerSource, 20, 'maxAdmissionsPerSource'),
    trustedProxyRanges,
    forwardedForHeader,
    sourceKey: input.sourceKey ?? createNativePeerSourceResolver({
      trustedProxyRanges, forwardedForHeader,
    }),
  };
}

function assertSourcePolicy(input: NativeAuthorizationRequestPolicyConfig): void {
  if (input.sourceKey && (input.trustedProxyRanges?.length || input.forwardedForHeader)) {
    throw new Error(
      '[native-auth] sourceKey cannot be combined with trustedProxyRanges or forwardedForHeader.',
    );
  }
  if (input.forwardedForHeader && !input.trustedProxyRanges?.length) {
    throw new Error('[native-auth] forwardedForHeader requires at least one trustedProxyRange.');
  }
}

export function resolveNativeRefreshPolicy(
  input: NativeRefreshRotationPolicyConfig = {},
): ResolvedNativeRefreshRotationPolicy {
  return {
    cleanupBatchSize: positive(input.cleanupBatchSize, 100, 'cleanupBatchSize', 10_000),
    minRotationIntervalMs: duration(
      input.minRotationInterval ?? '30s', 'minRotationInterval', 3_600_000, true,
    ),
    maxRotationsPerFamily: positive(
      input.maxRotationsPerFamily, 4_096, 'maxRotationsPerFamily', 100_000,
    ),
    maxActiveFamiliesPerUserClient: positive(
      input.maxActiveFamiliesPerUserClient, 10, 'maxActiveFamiliesPerUserClient', 1_000,
    ),
  };
}

export function duration(value: string, label: string, maxMs: number, allowZero = false): number {
  const match = value.match(/^(\d+)(s|m|h|d)$/);
  const amount = match ? Number(match[1]) : Number.NaN;
  const unit = match?.[2];
  const factor = unit === 's' ? 1_000 : unit === 'm' ? 60_000
    : unit === 'h' ? 3_600_000 : unit === 'd' ? 86_400_000 : Number.NaN;
  const milliseconds = amount * factor;
  if (!Number.isSafeInteger(milliseconds) || milliseconds > maxMs
    || (allowZero ? milliseconds < 0 : milliseconds <= 0)) {
    throw new Error(`[native-auth] ${label} must be a safe duration no greater than ${maxMs}ms.`);
  }
  return milliseconds;
}

function positive(value: number | undefined, fallback: number, label: string, max = 1_000_000) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > max) {
    throw new Error(`[native-auth] ${label} must be an integer between 1 and ${max}.`);
  }
  return resolved;
}
