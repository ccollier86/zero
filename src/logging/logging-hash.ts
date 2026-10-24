/** Bun-owned hashing for internal deduplication; this is not an independent tamper-evidence claim. */
import { loggingCanonical } from './logging-validation';

export function loggingDigest(value: unknown): string {
  return new Bun.CryptoHasher('sha256').update(loggingCanonical(value)).digest('hex');
}
