/** Strict contact policy normalization; no provider, schema or transport side effects. */
import { assertOnlyKeys, assertOptionalBoolean, assertPlainRecord } from './auth-config-validation';
import type { AuthUserContactConfig, ResolvedAuthUserContactConfig } from './auth-user-contact-types';

export function normalizeAuthUserContacts(input: AuthUserContactConfig = {}): ResolvedAuthUserContactConfig {
  assertPlainRecord(input, 'User contacts config');
  assertOnlyKeys(input, ['enabled', 'email', 'phone', 'verificationPath', 'challengeTTL', 'resendCooldown', 'maxAttempts'], 'User contacts config');
  assertOptionalBoolean(input.enabled, 'User contacts enabled');
  const email = input.email ?? {};
  const phone = input.phone ?? {};
  assertPlainRecord(email, 'User email contact config');
  assertOnlyKeys(email, ['verify', 'change'], 'User email contact config');
  assertPlainRecord(phone, 'User phone contact config');
  assertOnlyKeys(phone, ['enabled', 'editable', 'verify'], 'User phone contact config');
  for (const [key, value] of Object.entries({ ...email, ...phone })) assertOptionalBoolean(value, `User contact ${key}`);
  if ((phone.editable || phone.verify) && !phone.enabled) throw new Error('[auth] Phone contact editing or verification requires phone.enabled.');
  const path = input.verificationPath ?? '/verify-contact';
  if (typeof path !== 'string' || path.length > 512 || !/^\/(?!\/)[A-Za-z0-9/_-]*$/.test(path)) {
    throw new Error('[auth] User contact verificationPath must be a safe relative application path.');
  }
  const challengeTTL = input.challengeTTL ?? '15m';
  const resendCooldown = input.resendCooldown ?? '1m';
  const ttl = duration(challengeTTL, 60_000, 3_600_000, 'challengeTTL');
  const cooldown = duration(resendCooldown, 1_000, 3_600_000, 'resendCooldown');
  if (cooldown >= ttl) throw new Error('[auth] Contact resendCooldown must be shorter than challengeTTL.');
  const attempts = input.maxAttempts ?? 5;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) throw new Error('[auth] Contact maxAttempts must be an integer from 1 to 10.');
  return Object.freeze({
    enabled: input.enabled ?? false,
    email: Object.freeze({ verify: email.verify ?? false, change: email.change ?? false }),
    phone: Object.freeze({ enabled: phone.enabled ?? false, editable: phone.editable ?? false, verify: phone.verify ?? false }),
    verificationPath: path, challengeTTL, challengeTTLms: ttl,
    resendCooldown, resendCooldownMs: cooldown, maxAttempts: attempts,
  });
}

function duration(value: unknown, min: number, max: number, name: string): number {
  const match = typeof value === 'string' ? /^(\d{1,6})(s|m|h)$/.exec(value) : null;
  const amount = match ? Number(match[1]) * ({ s: 1_000, m: 60_000, h: 3_600_000 }[match[2] as 's' | 'm' | 'h']) : NaN;
  if (!Number.isSafeInteger(amount) || amount < min || amount > max) throw new Error(`[auth] Contact ${name} must be a bounded seconds, minutes or hours duration.`);
  return amount;
}
