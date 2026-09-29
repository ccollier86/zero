/** Strict normalization shared by public auth role-selection boundaries. */

const ROLE_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const ROLE_KEY_MAX_LENGTH = 64;

export interface AuthRoleSelectionNormalizationOptions {
  minimum: number;
  maximum: number;
  invalid: () => Error;
}

/**
 * Normalize an explicitly supplied role set without changing its meaning.
 *
 * In particular, holes, non-strings, blank entries, malformed keys, and
 * duplicates are rejected instead of being filtered or deduplicated into a
 * different grant. Callers choose whether an empty set is meaningful through
 * `minimum` and retain ownership of their public error contract.
 */
export function normalizeAuthRoleSelection(
  input: unknown,
  options: AuthRoleSelectionNormalizationOptions,
): readonly string[] {
  if (!Array.isArray(input)
    || input.length < options.minimum
    || input.length > options.maximum) {
    throw options.invalid();
  }

  const normalized: string[] = [];
  for (let index = 0; index < input.length; index += 1) {
    // JSON cannot contain sparse arrays, but headless service callers can.
    // Requiring an own element prevents a hole (or inherited value) from
    // disappearing into a smaller or empty grant.
    if (!Object.hasOwn(input, index)) throw options.invalid();
    const candidate: unknown = input[index];
    if (typeof candidate !== 'string') throw options.invalid();
    const roleKey = candidate.trim();
    if (roleKey.length < 1
      || roleKey.length > ROLE_KEY_MAX_LENGTH
      || !ROLE_KEY_PATTERN.test(roleKey)) {
      throw options.invalid();
    }
    normalized.push(roleKey);
  }

  if (new Set(normalized).size !== normalized.length) {
    throw options.invalid();
  }
  return Object.freeze(normalized.sort(compareKeys));
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
