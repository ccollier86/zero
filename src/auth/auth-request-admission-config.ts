/** Pure validation and defaults for public auth admission control. */

import { createNativePeerSourceResolver } from './native/trusted-proxy-source';
import type {
  AuthRequestAdmissionConfig,
  AuthRequestAdmissionFlow,
  AuthRequestAdmissionFlowConfig,
  AuthRequestSourceResolver,
  ResolvedAuthRequestAdmissionConfig,
  ResolvedAuthRequestAdmissionFlowConfig,
} from './auth-request-admission-types';

const MAX_LIMIT = 1_000_000;
const MAX_WINDOW_MS = 86_400_000;

const DEFAULT_FLOWS: Record<
  AuthRequestAdmissionFlow,
  ResolvedAuthRequestAdmissionFlowConfig
> = {
  bootstrap: {
    windowMs: 10 * 60_000,
    maxGlobal: 100,
    maxPerSource: 10,
    maxPerSubject: 5,
  },
  registration: {
    windowMs: 10 * 60_000,
    maxGlobal: 10_000,
    maxPerSource: 100,
    maxPerSubject: 5,
  },
  login: {
    windowMs: 5 * 60_000,
    maxGlobal: 100_000,
    maxPerSource: 100,
    maxPerSubject: 20,
  },
  invitation: {
    windowMs: 10 * 60_000,
    maxGlobal: 10_000,
    maxPerSource: 100,
    maxPerSubject: 20,
  },
  'join-request': {
    windowMs: 10 * 60_000,
    maxGlobal: 10_000,
    maxPerSource: 50,
    maxPerSubject: 10,
  },
  'domain-onboarding': {
    windowMs: 10 * 60_000,
    maxGlobal: 10_000,
    maxPerSource: 30,
    maxPerSubject: 5,
  },
};

export function resolveAuthRequestAdmissionConfig(
  input: AuthRequestAdmissionConfig = {},
): ResolvedAuthRequestAdmissionConfig {
  assertPlainRecord(input, 'Auth request admission config');
  assertOnlyKeys(input, [
    'enabled', 'cleanupBatchSize', 'trustedProxyRanges', 'forwardedForHeader',
    'sourceKey', 'bootstrap', 'registration', 'login', 'invitation', 'joinRequest',
    'domainOnboarding',
  ]);
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
    throw new Error('[auth] Request admission enabled must be a boolean.');
  }
  if (input.sourceKey !== undefined && typeof input.sourceKey !== 'function') {
    throw new Error('[auth] Request admission sourceKey must be a function.');
  }
  if (input.trustedProxyRanges !== undefined
    && (!Array.isArray(input.trustedProxyRanges)
      || input.trustedProxyRanges.some((value) => typeof value !== 'string'))) {
    throw new Error(
      '[auth] Request admission trustedProxyRanges must be an array of strings.',
    );
  }
  if (input.forwardedForHeader !== undefined
    && typeof input.forwardedForHeader !== 'string') {
    throw new Error('[auth] Request admission forwardedForHeader must be a string.');
  }
  if (input.sourceKey && (input.trustedProxyRanges?.length || input.forwardedForHeader)) {
    throw new Error(
      '[auth] Request admission sourceKey cannot be combined with '
      + 'trustedProxyRanges or forwardedForHeader.',
    );
  }
  if (input.forwardedForHeader && !input.trustedProxyRanges?.length) {
    throw new Error(
      '[auth] Request admission forwardedForHeader requires at least one trustedProxyRange.',
    );
  }
  const trustedProxyRanges = [...(input.trustedProxyRanges ?? [])];
  const forwardedForHeader = input.forwardedForHeader ?? 'x-forwarded-for';
  const peerResolver = createNativePeerSourceResolver({
    trustedProxyRanges,
    forwardedForHeader,
  });
  const sourceKey: AuthRequestSourceResolver = input.sourceKey ?? ((context) =>
    peerResolver({
      request: context.request,
      clientId: `auth:${context.flow}`,
      peerAddress: context.peerAddress,
    }));

  return Object.freeze({
    enabled: input.enabled ?? true,
    cleanupBatchSize: positive(
      input.cleanupBatchSize,
      100,
      'cleanupBatchSize',
      10_000,
    ),
    trustedProxyRanges: Object.freeze(trustedProxyRanges),
    forwardedForHeader,
    sourceKey,
    flows: Object.freeze({
      bootstrap: resolveFlow('bootstrap', input.bootstrap),
      registration: resolveFlow('registration', input.registration),
      login: resolveFlow('login', input.login),
      invitation: resolveFlow('invitation', input.invitation),
      'join-request': resolveFlow('join-request', input.joinRequest),
      'domain-onboarding': resolveFlow(
        'domain-onboarding',
        input.domainOnboarding,
      ),
    }),
  });
}

function resolveFlow(
  flow: AuthRequestAdmissionFlow,
  input: AuthRequestAdmissionFlowConfig | undefined,
): ResolvedAuthRequestAdmissionFlowConfig {
  if (input !== undefined) {
    assertPlainRecord(input, `Auth request admission ${flow}`);
    assertOnlyKeys(input, ['window', 'maxGlobal', 'maxPerSource', 'maxPerSubject']);
  }
  const defaults = DEFAULT_FLOWS[flow];
  return Object.freeze({
    windowMs: duration(input?.window, defaults.windowMs, `${flow}.window`),
    maxGlobal: positive(input?.maxGlobal, defaults.maxGlobal, `${flow}.maxGlobal`),
    maxPerSource: positive(
      input?.maxPerSource,
      defaults.maxPerSource,
      `${flow}.maxPerSource`,
    ),
    maxPerSubject: positive(
      input?.maxPerSubject,
      defaults.maxPerSubject,
      `${flow}.maxPerSubject`,
    ),
  });
}

function duration(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') {
    throw new Error(`[auth] Request admission ${label} must be a duration string.`);
  }
  const match = /^(\d+)(s|m|h|d)$/.exec(value);
  const amount = match ? Number(match[1]) : Number.NaN;
  const factor = match?.[2] === 's' ? 1_000
    : match?.[2] === 'm' ? 60_000
      : match?.[2] === 'h' ? 3_600_000
        : match?.[2] === 'd' ? 86_400_000
          : Number.NaN;
  const milliseconds = amount * factor;
  if (!Number.isSafeInteger(milliseconds)
    || milliseconds <= 0
    || milliseconds > MAX_WINDOW_MS) {
    throw new Error(
      `[auth] Request admission ${label} must be a positive duration no greater than 1d.`,
    );
  }
  return milliseconds;
}

function positive(
  value: number | undefined,
  fallback: number,
  label: string,
  maximum = MAX_LIMIT,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > maximum) {
    throw new Error(
      `[auth] Request admission ${label} must be an integer between 1 and ${maximum}.`,
    );
  }
  return resolved;
}

function assertPlainRecord(value: unknown, label: string): asserts value is object {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`[auth] ${label} must be an object.`);
  }
}

function assertOnlyKeys(value: object, keys: readonly string[]): void {
  const allowed = new Set(keys);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) {
    throw new Error(
      `[auth] Request admission config contains unsupported field "${unknown}".`,
    );
  }
}
