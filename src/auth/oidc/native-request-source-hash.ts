/** Process-pseudonymous hashing keeps source identifiers out of durable storage. */

import { createHmac, randomBytes } from 'node:crypto';

const SOURCE_HASH_KEY = randomBytes(32);

export function hashNativeRequestSource(value: string): string {
  return createHmac('sha256', SOURCE_HASH_KEY).update(value).digest('hex');
}
