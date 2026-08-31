/** Validated persistence limits for native authorization request admission. */

import { DEFAULT_NATIVE_REQUEST_POLICY } from '../native/policy-config';

export interface NativeRequestLimits {
  cleanupBatchSize: number;
  maxOutstandingGlobal: number;
  maxOutstandingPerClient: number;
  maxOutstandingPerSource: number;
  rollingWindowMs: number;
  maxAdmissionsGlobal: number;
  maxAdmissionsPerClient: number;
  maxAdmissionsPerSource: number;
}

export interface NativeRequestStoreOptions {
  limits?: Partial<NativeRequestLimits>;
  now?: () => number;
}

export const DEFAULT_NATIVE_REQUEST_LIMITS: NativeRequestLimits = {
  cleanupBatchSize: DEFAULT_NATIVE_REQUEST_POLICY.cleanupBatchSize,
  maxOutstandingGlobal: DEFAULT_NATIVE_REQUEST_POLICY.maxOutstandingGlobal,
  maxOutstandingPerClient: DEFAULT_NATIVE_REQUEST_POLICY.maxOutstandingPerClient,
  maxOutstandingPerSource: DEFAULT_NATIVE_REQUEST_POLICY.maxOutstandingPerSource,
  rollingWindowMs: DEFAULT_NATIVE_REQUEST_POLICY.rollingWindowMs,
  maxAdmissionsGlobal: DEFAULT_NATIVE_REQUEST_POLICY.maxAdmissionsGlobal,
  maxAdmissionsPerClient: DEFAULT_NATIVE_REQUEST_POLICY.maxAdmissionsPerClient,
  maxAdmissionsPerSource: DEFAULT_NATIVE_REQUEST_POLICY.maxAdmissionsPerSource,
};

export function resolveNativeRequestLimits(
  input: Partial<NativeRequestLimits> = {},
): NativeRequestLimits {
  const limits = Object.fromEntries(
    Object.entries(DEFAULT_NATIVE_REQUEST_LIMITS).map(([key, fallback]) => [
      key, input[key as keyof NativeRequestLimits] ?? fallback,
    ])
  ) as unknown as NativeRequestLimits;
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error('[native-auth] Request admission limits must be positive integers.');
    }
  }
  return limits;
}

export function nativeRequestCount(row: unknown): number {
  return Number((row as { count?: number } | null)?.count ?? 0);
}
