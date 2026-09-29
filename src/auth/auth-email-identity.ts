/**
 * Canonical email identity helpers shared by auth persistence and HTTP input.
 * Usernames intentionally do not use this normalization.
 */

/** Case-explicit source shared with transport schemas that cannot carry RegExp flags. */
export const EMAIL_PATTERN_SOURCE = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\\.)+[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?";

/** Practical RFC mailbox limit; also bounds identity lookup and queue inputs. */
export const EMAIL_MAX_LENGTH = 254;

const EMAIL_PATTERN = new RegExp(`^${EMAIL_PATTERN_SOURCE}$`);

/**
 * Normalize an email identity without changing arbitrary usernames.
 * Runtime-unknown adapter input returns an invalid empty canonical value so
 * the owning service can emit its stable validation error instead of leaking
 * a JavaScript TypeError.
 */
export function canonicalizeEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/** Validate the canonical form using the same shape accepted by Elysia email fields. */
export function isValidEmail(email: unknown): boolean {
  const canonical = canonicalizeEmail(email);
  return canonical.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(canonical);
}

/** Return true only when a login identifier is a valid email after normalization. */
export function isEmailLoginIdentifier(identifier: unknown): boolean {
  return isValidEmail(identifier);
}
