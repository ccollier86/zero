import { parseTokenTTL } from '../tokens/token-utils';
import { decodeTenantInvitationWrappingKey } from './auth-tenant-invitation-envelope';
import type {
  AuthTenantOnboardingConfig,
  ResolvedAuthTenantOnboardingConfig,
} from './auth-tenant-onboarding-types';

const DEFAULT_TTL = '7d';
const DEFAULT_MAX_TTL = '30d';
const MAX_INVITATION_TTL_MS = 90 * 86_400_000;
const MAX_DOMAIN_DURATION_MS = 365 * 86_400_000;
const MAX_DNS_TIMEOUT_MS = 60_000;
const ROLE_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

export function resolveAuthTenantOnboardingConfig(
  input: AuthTenantOnboardingConfig | undefined,
): ResolvedAuthTenantOnboardingConfig {
  if (input !== undefined) assertRecord(input, 'Tenant onboarding config');
  assertKeys(
    input ?? {},
    ['invitations', 'joinRequests', 'verifiedDomains'],
    'Tenant onboarding config',
  );
  const invitations = input?.invitations;
  const joinRequests = input?.joinRequests;
  const verifiedDomains = input?.verifiedDomains;
  if (invitations !== undefined) {
    assertRecord(invitations, 'Tenant invitation config');
    assertKeys(
      invitations,
      ['enabled', 'defaultTTL', 'maxTTL', 'accountCreation', 'delivery'],
      'Tenant invitation config',
    );
  }
  if (joinRequests !== undefined) {
    assertRecord(joinRequests, 'Tenant join-request config');
    assertKeys(joinRequests, ['enabled'], 'Tenant join-request config');
  }
  if (verifiedDomains !== undefined) {
    assertRecord(verifiedDomains, 'Verified-domain onboarding config');
    assertKeys(verifiedDomains, [
      'enabled',
      'allowedRequestRoles',
      'defaultRequestRole',
      'challengeTTL',
      'dnsCheckCooldown',
      'reverifyInterval',
      'gracePeriod',
      'reverifyRetryInterval',
      'mailboxProofMaxAge',
      'mailboxLinkTTL',
      'admissionTTL',
      'deniedRetryCooldown',
      'mailboxLandingPath',
      'sharedMailboxDomains',
      'resolveTxt',
      'dnsTimeout',
      'maxTxtAnswers',
      'maxTxtBytes',
      'maxClaimsPerTenant',
    ], 'Verified-domain onboarding config');
  }
  assertOptionalBoolean(invitations?.enabled, 'invitations.enabled');
  assertOptionalBoolean(invitations?.accountCreation, 'invitations.accountCreation');
  assertOptionalBoolean(joinRequests?.enabled, 'joinRequests.enabled');
  assertOptionalBoolean(verifiedDomains?.enabled, 'verifiedDomains.enabled');

  const defaultTTLms = parseBoundedTTL(
    invitations?.defaultTTL ?? DEFAULT_TTL,
    'tenant invitation default TTL',
  );
  const maxTTLms = parseBoundedTTL(
    invitations?.maxTTL ?? DEFAULT_MAX_TTL,
    'tenant invitation maximum TTL',
  );
  if (defaultTTLms > maxTTLms) {
    throw new Error(
      '[auth] Tenant invitation defaultTTL cannot exceed maxTTL.',
    );
  }
  const delivery = invitations?.delivery;
  if (delivery !== undefined) {
    assertRecord(delivery, 'Tenant invitation delivery config');
    assertKeys(
      delivery,
      ['default', 'allowManual', 'email'],
      'Tenant invitation delivery config',
    );
  }
  const emailDelivery = delivery?.email;
  if (emailDelivery !== undefined) {
    assertRecord(emailDelivery, 'Tenant invitation email delivery config');
    assertKeys(
      emailDelivery,
      [
        'enabled',
        'landingPath',
        'encryptionKey',
        'previousEncryptionKeys',
        'template',
      ],
      'Tenant invitation email delivery config',
    );
  }
  assertOptionalBoolean(delivery?.allowManual, 'invitations.delivery.allowManual');
  assertOptionalBoolean(emailDelivery?.enabled, 'invitations.delivery.email.enabled');
  if (delivery?.default !== undefined
    && delivery.default !== 'manual' && delivery.default !== 'email') {
    throw new Error(
      '[auth] Tenant invitation delivery.default must be "manual" or "email".',
    );
  }
  if (emailDelivery?.template !== undefined
    && typeof emailDelivery.template !== 'function') {
    throw new Error('[auth] Tenant invitation email template must be a function.');
  }
  const emailEnabled = emailDelivery?.enabled ?? false;
  const emailEncryptionKey = emailDelivery?.encryptionKey;
  if (emailEncryptionKey !== undefined) assertEncryptionKey(
    emailEncryptionKey,
    'encryptionKey',
  );
  const previousEncryptionKeys = emailDelivery?.previousEncryptionKeys ?? [];
  if (!Array.isArray(previousEncryptionKeys) || previousEncryptionKeys.length > 3) {
    throw new Error(
      '[auth] Tenant invitation email previousEncryptionKeys must contain at most 3 keys.',
    );
  }
  const distinctKeys = new Set<string>();
  for (const [index, previous] of previousEncryptionKeys.entries()) {
    assertEncryptionKey(previous, `previousEncryptionKeys[${index}]`);
    if (previous === emailEncryptionKey || distinctKeys.has(previous)) {
      throw new Error(
        '[auth] Tenant invitation email encryption keys must be distinct.',
      );
    }
    distinctKeys.add(previous);
  }
  if (emailEnabled && !emailEncryptionKey) {
    throw new Error(
      '[auth] Tenant invitation email delivery requires an operator-managed encryptionKey.',
    );
  }
  const allowManual = delivery?.allowManual ?? true;
  const defaultDelivery = delivery?.default ?? (emailEnabled ? 'email' : 'manual');
  if (defaultDelivery === 'email' && !emailEnabled) {
    throw new Error(
      '[auth] Tenant invitation default email delivery requires email.enabled.',
    );
  }
  if (defaultDelivery === 'manual' && !allowManual) {
    throw new Error(
      '[auth] Tenant invitation default manual delivery requires allowManual.',
    );
  }
  if (!allowManual && !emailEnabled) {
    throw new Error('[auth] Tenant invitations require at least one delivery mode.');
  }
  const allowedRequestRoles = normalizeRoleKeys(
    verifiedDomains?.allowedRequestRoles ?? ['member'],
  );
  const defaultRequestRole = normalizeRoleKey(
    verifiedDomains?.defaultRequestRole ?? 'member',
    'verifiedDomains.defaultRequestRole',
  );
  if (!allowedRequestRoles.includes(defaultRequestRole)) {
    throw new Error(
      '[auth] verifiedDomains.defaultRequestRole must be included in allowedRequestRoles.',
    );
  }
  if (verifiedDomains?.resolveTxt !== undefined
    && typeof verifiedDomains.resolveTxt !== 'function') {
    throw new Error('[auth] verifiedDomains.resolveTxt must be a function.');
  }
  const sharedMailboxDomains = normalizeSharedMailboxDomains(
    verifiedDomains?.sharedMailboxDomains ?? [],
  );
  return Object.freeze({
    invitations: Object.freeze({
      enabled: invitations?.enabled ?? true,
      defaultTTLms,
      maxTTLms,
      accountCreation: invitations?.accountCreation ?? true,
      delivery: Object.freeze({
        default: defaultDelivery,
        allowManual,
        email: Object.freeze({
          enabled: emailEnabled,
          landingPath: normalizeLandingPath(emailDelivery?.landingPath),
          ...(emailEncryptionKey ? { encryptionKey: emailEncryptionKey } : {}),
          previousEncryptionKeys: Object.freeze([...previousEncryptionKeys]),
          ...(emailDelivery?.template ? { template: emailDelivery.template } : {}),
        }),
      }),
    }),
    joinRequests: Object.freeze({
      enabled: joinRequests?.enabled ?? true,
    }),
    verifiedDomains: Object.freeze({
      enabled: verifiedDomains?.enabled ?? false,
      admission: 'request-to-join' as const,
      allowedRequestRoles,
      defaultRequestRole,
      challengeTTLms: parseDomainDuration(
        verifiedDomains?.challengeTTL ?? '24h',
        'verifiedDomains.challengeTTL',
      ),
      dnsCheckCooldownMs: parseDomainDuration(
        verifiedDomains?.dnsCheckCooldown ?? '30s',
        'verifiedDomains.dnsCheckCooldown',
      ),
      reverifyIntervalMs: parseDomainDuration(
        verifiedDomains?.reverifyInterval ?? '7d',
        'verifiedDomains.reverifyInterval',
      ),
      gracePeriodMs: parseDomainDuration(
        verifiedDomains?.gracePeriod ?? '3d',
        'verifiedDomains.gracePeriod',
      ),
      reverifyRetryIntervalMs: parseDomainDuration(
        verifiedDomains?.reverifyRetryInterval ?? '1h',
        'verifiedDomains.reverifyRetryInterval',
      ),
      mailboxProofMaxAgeMs: parseDomainDuration(
        verifiedDomains?.mailboxProofMaxAge ?? '30m',
        'verifiedDomains.mailboxProofMaxAge',
      ),
      mailboxLinkTTLms: parseDomainDuration(
        verifiedDomains?.mailboxLinkTTL ?? '30m',
        'verifiedDomains.mailboxLinkTTL',
      ),
      admissionTTLms: parseDomainDuration(
        verifiedDomains?.admissionTTL ?? '10m',
        'verifiedDomains.admissionTTL',
      ),
      deniedRetryCooldownMs: parseDomainDuration(
        verifiedDomains?.deniedRetryCooldown ?? '7d',
        'verifiedDomains.deniedRetryCooldown',
      ),
      mailboxLandingPath: normalizeVerifiedDomainLandingPath(
        verifiedDomains?.mailboxLandingPath,
      ),
      sharedMailboxDomains,
      ...(verifiedDomains?.resolveTxt ? { resolveTxt: verifiedDomains.resolveTxt } : {}),
      dnsTimeoutMs: parseDomainDuration(
        verifiedDomains?.dnsTimeout ?? '5s',
        'verifiedDomains.dnsTimeout',
        MAX_DNS_TIMEOUT_MS,
      ),
      maxTxtAnswers: boundedInteger(
        verifiedDomains?.maxTxtAnswers,
        32,
        1,
        256,
        'verifiedDomains.maxTxtAnswers',
      ),
      maxTxtBytes: boundedInteger(
        verifiedDomains?.maxTxtBytes,
        8_192,
        128,
        65_536,
        'verifiedDomains.maxTxtBytes',
      ),
      maxClaimsPerTenant: boundedInteger(
        verifiedDomains?.maxClaimsPerTenant,
        20,
        1,
        100,
        'verifiedDomains.maxClaimsPerTenant',
      ),
    }),
  });
}

function normalizeRoleKeys(value: readonly string[]): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    throw new Error(
      '[auth] verifiedDomains.allowedRequestRoles must contain 1 to 32 role keys.',
    );
  }
  const result = [...new Set(value.map((key, index) => normalizeRoleKey(
    key,
    `verifiedDomains.allowedRequestRoles[${index}]`,
  )))].sort();
  return Object.freeze(result);
}

function normalizeRoleKey(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 64 || !ROLE_KEY_PATTERN.test(value)) {
    throw new Error(`[auth] ${label} must be a valid lowercase role key.`);
  }
  if (value === 'owner') {
    throw new Error('[auth] Verified-domain onboarding cannot grant the owner role.');
  }
  return value;
}

function normalizeSharedMailboxDomains(value: readonly string[]): readonly string[] {
  if (!Array.isArray(value) || value.length > 1_000) {
    throw new Error(
      '[auth] verifiedDomains.sharedMailboxDomains must contain at most 1000 domains.',
    );
  }
  const domains = value.map((domain, index) => {
    if (typeof domain !== 'string') {
      throw new Error(
        `[auth] verifiedDomains.sharedMailboxDomains[${index}] must be a domain string.`,
      );
    }
    const normalized = domain.trim().toLowerCase().replace(/\.$/, '');
    if (normalized.length < 3 || normalized.length > 253
      || !normalized.includes('.') || !/^[a-z0-9.-]+$/.test(normalized)) {
      throw new Error(
        `[auth] verifiedDomains.sharedMailboxDomains[${index}] is invalid.`,
      );
    }
    return normalized;
  });
  return Object.freeze([...new Set(domains)].sort());
}

function normalizeVerifiedDomainLandingPath(value: unknown): string {
  if (value === undefined) return '/domain-onboarding';
  if (typeof value !== 'string') {
    throw new Error('[auth] verifiedDomains.mailboxLandingPath must be a string.');
  }
  const path = value.trim();
  if (path.length < 1 || path.length > 200 || !path.startsWith('/')
    || path.startsWith('//') || /[\s?#]/.test(path)) {
    throw new Error(
      '[auth] verifiedDomains.mailboxLandingPath must be an app-relative path without a query or fragment.',
    );
  }
  return path;
}

function parseDomainDuration(
  value: unknown,
  label: string,
  maximum = MAX_DOMAIN_DURATION_MS,
): number {
  if (typeof value !== 'string') {
    throw new Error(`[auth] ${label} must be a duration string.`);
  }
  const milliseconds = parseTokenTTL(value, label);
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0
    || milliseconds > maximum) {
    throw new Error(
      `[auth] ${label} must be positive and no greater than ${maximum}ms.`,
    );
  }
  return milliseconds;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(
      `[auth] ${label} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return resolved;
}

function assertEncryptionKey(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new Error(
      `[auth] Tenant invitation email ${label} must be an unpadded base64url-encoded 32-byte key.`,
    );
  }
  decodeTenantInvitationWrappingKey(value, label);
}

function normalizeLandingPath(value: unknown): string {
  if (value === undefined) return '/accept-invitation';
  if (typeof value !== 'string') {
    throw new Error('[auth] Tenant invitation email landingPath must be a string.');
  }
  const path = value.trim();
  if (path.length < 1 || path.length > 200 || !path.startsWith('/')
    || path.startsWith('//') || /[\s?#]/.test(path)) {
    throw new Error(
      '[auth] Tenant invitation email landingPath must be an app-relative path without a query or fragment.',
    );
  }
  return path;
}

function parseBoundedTTL(value: unknown, label: string): number {
  if (typeof value !== 'string') {
    throw new Error(`[auth] ${label} must be a duration string.`);
  }
  const milliseconds = parseTokenTTL(value, label);
  if (!Number.isSafeInteger(milliseconds)
    || milliseconds <= 0
    || milliseconds > MAX_INVITATION_TTL_MS) {
    throw new Error(`[auth] ${label} must be positive and no greater than 90d.`);
  }
  return milliseconds;
}

function assertOptionalBoolean(value: unknown, label: string): void {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new Error(`[auth] Tenant onboarding ${label} must be a boolean.`);
  }
}

function assertRecord(value: unknown, label: string): asserts value is object {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`[auth] ${label} must be an object.`);
  }
}

function assertKeys(value: object, allowed: readonly string[], label: string): void {
  const keys = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !keys.has(key));
  if (unknown) throw new Error(`[auth] ${label} contains unsupported field "${unknown}".`);
}
