/** Helpers for provisional administrator-created account state. */

import type { UserStore } from './user-store';

/** Create an unknown, high-entropy credential for email-driven setup. */
export function createTemporaryPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

/** Remove an account whose initial setup instructions were not delivered. */
export function rollbackProvisionedUser(
  store: UserStore,
  userId: string
): boolean {
  try {
    return store.deleteUser(userId) || store.getUserById(userId) === null;
  } catch {
    return false;
  }
}
