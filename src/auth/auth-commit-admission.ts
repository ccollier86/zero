/** Framework-private fair admission before a synchronous auth mutation. */
import { withReactiveDBCommitAdmission } from '../sync/reactive-db-commit-admission';
import type { UserStore } from './user-store';
import { AuthError } from './types';

type CommitOwner = UserStore | { getUserStore(): UserStore | null };

/** Existing services retain their own transactions and live authority checks. */
export function withAuthCommitAdmission<T>(owner: CommitOwner, operation: () => T, signal?: AbortSignal): Promise<T> {
  const store = 'getUserStore' in owner ? owner.getUserStore() : owner;
  if (!store) throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
  return withReactiveDBCommitAdmission(store, () => {
    store.assertCurrentProfile();
    return operation();
  }, { signal });
}
