import type {
  AuthMfaMethodType,
  AuthPublicConfig,
  AuthUserPropertyConfig,
} from './auth-types';
import { isUserProfileCapabilities } from './auth-user-profile-parser';

type UnknownRecord = Record<string, unknown>;

/** Validate the public config boundary before mode-aware UI consumes it. */
export function isAuthPublicConfig(value: unknown): value is AuthPublicConfig {
  const config = record(value);
  if (!config || !isRegistration(config.registration)) return false;

  return optional(config.tenancy, isTenancy)
    && optional(config.authorization, isAuthorization)
    && optional(config.apiKeys, isApiKeys)
    && optional(config.bootstrap, isBootstrap)
    && optional(config.accountEmails, isAccountEmails)
    && optional(config.account, isAccount)
    && optional(config.mfa, isMfa)
    && optional(config.userProfile, isUserProfileCapabilities)
    && optional(config.userProperties, isUserProperties)
    && optionalBoolean(config.strictUserProperties);
}

function isRegistration(value: unknown): boolean {
  const registration = record(value);
  return Boolean(registration)
    && oneOf(registration!.mode, ['public', 'admin-only', 'disabled'])
    && typeof registration!.bootstrapRequired === 'boolean'
    && optionalBoolean(registration!.registrationEnabled)
    && typeof registration!.publicRegistrationEnabled === 'boolean'
    && optionalNonNegativeInteger(registration!.userCount);
}

function isTenancy(value: unknown): boolean {
  const tenancy = record(value);
  if (!tenancy || !oneOf(tenancy.mode, ['single', 'multi'])) return false;
  return optional(tenancy.terminology, (candidate) => {
    const terminology = record(candidate);
    return Boolean(terminology)
      && typeof terminology!.singular === 'string'
      && typeof terminology!.plural === 'string';
  }) && optional(tenancy.creation, (candidate) => {
    const creation = record(candidate);
    return Boolean(creation)
      && oneOf(creation!.mode, ['authenticated', 'platform-admin', 'disabled']);
  }) && optional(tenancy.onboarding, isOnboarding);
}

function isOnboarding(value: unknown): boolean {
  const onboarding = record(value);
  if (!onboarding) return false;
  const invitations = record(onboarding.invitations);
  const delivery = record(invitations?.delivery);
  const joinRequests = record(onboarding.joinRequests);
  return Boolean(invitations && delivery && joinRequests)
    && typeof invitations!.enabled === 'boolean'
    && typeof invitations!.accountCreation === 'boolean'
    && oneOf(delivery!.default, ['manual', 'email'])
    && typeof delivery!.manual === 'boolean'
    && typeof delivery!.email === 'boolean'
    && typeof joinRequests!.enabled === 'boolean'
    && optional(onboarding.verifiedDomains, (candidate) => {
      const domains = record(candidate);
      return Boolean(domains)
        && typeof domains!.enabled === 'boolean'
        && domains!.admission === 'request-to-join';
    });
}

function isAuthorization(value: unknown): boolean {
  const authorization = record(value);
  return Boolean(authorization)
    && oneOf(authorization!.mode, ['simple', 'advanced']);
}

function isApiKeys(value: unknown): boolean {
  const apiKeys = record(value);
  const defaultTTL = durationMilliseconds(apiKeys?.defaultTTL);
  const maxTTL = durationMilliseconds(apiKeys?.maxTTL);
  return Boolean(apiKeys)
    && typeof apiKeys!.enabled === 'boolean'
    && typeof apiKeys!.selfService === 'boolean'
    && typeof apiKeys!.administratorIssuance === 'boolean'
    && defaultTTL !== null
    && maxTTL !== null
    && defaultTTL <= maxTTL
    && typeof apiKeys!.maxActivePerUser === 'number'
    && Number.isSafeInteger(apiKeys!.maxActivePerUser)
    && (apiKeys!.maxActivePerUser as number) >= 1
    && (apiKeys!.maxActivePerUser as number) <= 100;
}

function durationMilliseconds(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d+)(s|m|h|d)$/.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  const multiplier = match[2] === 's'
    ? 1_000
    : match[2] === 'm'
      ? 60_000
      : match[2] === 'h'
        ? 3_600_000
        : 86_400_000;
  const milliseconds = amount * multiplier;
  return Number.isSafeInteger(milliseconds) && milliseconds > 0
    ? milliseconds
    : null;
}

function isBootstrap(value: unknown): boolean {
  const bootstrap = record(value);
  return Boolean(bootstrap)
    && typeof bootstrap!.required === 'boolean'
    && oneOf(bootstrap!.mode, ['secret', 'public', 'disabled'])
    && typeof bootstrap!.available === 'boolean'
    && typeof bootstrap!.secretRequired === 'boolean';
}

function isAccountEmails(value: unknown): boolean {
  const emails = record(value);
  return Boolean(emails)
    && typeof emails!.adminCreatedUser === 'boolean'
    && typeof emails!.passwordReset === 'boolean'
    && typeof emails!.passwordChangedNotice === 'boolean'
    && optionalBoolean(emails!.emailVerification);
}

function isAccount(value: unknown): boolean {
  const account = record(value);
  return Boolean(account)
    && typeof account!.requireEmailVerification === 'boolean'
    && typeof account!.emailVerificationPath === 'string'
    && typeof account!.emailVerificationReady === 'boolean';
}

function isMfa(value: unknown): boolean {
  const mfa = record(value);
  return Boolean(mfa)
    && typeof mfa!.enabled === 'boolean'
    && oneOf(mfa!.policy, ['optional', 'required', 'admin-required'])
    && isMfaMethods(mfa!.methods)
    && isMfaMethods(mfa!.availableMethods)
    && typeof mfa!.allowUserChoice === 'boolean'
    && typeof mfa!.allowMultipleMethods === 'boolean'
    && typeof mfa!.rememberDevice === 'boolean'
    && typeof mfa!.recoveryCodes === 'boolean'
    && typeof mfa!.ready === 'boolean';
}

function isMfaMethods(value: unknown): value is AuthMfaMethodType[] {
  return Array.isArray(value)
    && value.every((method) => method === 'email' || method === 'totp');
}

function isUserProperties(value: unknown): boolean {
  const properties = record(value);
  return Boolean(properties)
    && Object.values(properties!).every(isUserProperty);
}

function isUserProperty(value: unknown): value is AuthUserPropertyConfig {
  const property = record(value);
  return Boolean(property)
    && typeof property!.key === 'string'
    && oneOf(property!.type, ['string', 'enum', 'boolean', 'number'])
    && optionalString(property!.label)
    && optionalStringArray(property!.values)
    && optionalString(property!.default)
    && oneOf(property!.editableBy, ['user', 'admin', 'system', 'none'])
    && optionalBoolean(property!.useInPolicies)
    && optionalString(property!.description);
}

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function optional(
  value: unknown,
  predicate: (candidate: unknown) => boolean,
): boolean {
  return value === undefined || predicate(value);
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function optionalStringArray(value: unknown): boolean {
  return value === undefined
    || (Array.isArray(value) && value.every((item) => typeof item === 'string'));
}

function optionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined
    || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}

function oneOf<const TValue extends string>(
  value: unknown,
  allowed: readonly TValue[],
): value is TValue {
  return typeof value === 'string' && allowed.includes(value as TValue);
}
