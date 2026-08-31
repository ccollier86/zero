/**
 * auth-token-generation.ts
 *
 * Maps and validates the generation claim carried by stateless auth tokens.
 */

import type { UserStore } from './user-store';

/** Read a safe generation claim while accepting legacy generation-zero JWTs. */
export function readAuthGeneration(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

/** Return the generation embedded in newly issued tokens. */
export function currentAuthGeneration(store: UserStore | null, userId: string): number {
  return store?.getAuthGeneration(userId) ?? 0;
}

/** Check that a stateless token has not crossed a revocation boundary. */
export function isCurrentAuthGeneration(
  store: UserStore,
  userId: string,
  tokenGeneration: number
): boolean {
  return store.getAuthGeneration(userId) === tokenGeneration;
}
