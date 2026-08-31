/** HTTP validation schema for canonical email input. */

import { t } from 'elysia';
import {
  canonicalizeEmail,
  EMAIL_MAX_LENGTH,
  EMAIL_PATTERN_SOURCE,
} from './auth-email-identity';

/**
 * Validate a whitespace-tolerant email shape, then canonicalize it.
 *
 * A regular `format: 'email'` schema rejects surrounding whitespace before a
 * handler can trim it. The outer pattern rejects malformed input as a normal
 * 422 validation error; the decode step only receives valid values.
 */
export const canonicalEmailSchema = t.Transform(t.String({
  minLength: 1,
  maxLength: EMAIL_MAX_LENGTH,
  pattern: `^\\s*${EMAIL_PATTERN_SOURCE}\\s*$`,
}))
  .Decode(canonicalizeEmail)
  .Encode(canonicalizeEmail);
