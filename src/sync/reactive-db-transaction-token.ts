/**
 * Opaque identity shared by every tracked mutation in one root ReactiveDB
 * transaction. Tokens are process-local observations, not authorization
 * capabilities, and are retired before committed change delivery begins.
 */

declare const reactiveDBTransactionTokenBrand: unique symbol;

export interface ReactiveDBTransactionToken {
  readonly [reactiveDBTransactionTokenBrand]: true;
}

const activeTokens = new WeakSet<object>();

/** @internal Create one fresh identity for an outer ReactiveDB transaction. */
export function createReactiveDBTransactionToken(): ReactiveDBTransactionToken {
  const token = Object.freeze(Object.create(null)) as ReactiveDBTransactionToken;
  activeTokens.add(token as object);
  return token;
}

/** @internal Reject an identity retained beyond its owning transaction. */
export function assertReactiveDBTransactionTokenActive(
  token: ReactiveDBTransactionToken,
): void {
  if (!activeTokens.has(token as object)) {
    throw new Error('ReactiveDB transaction token is no longer active');
  }
}

/** @internal Retire a root identity after either commit or rollback. */
export function retireReactiveDBTransactionToken(
  token: ReactiveDBTransactionToken,
): void {
  activeTokens.delete(token as object);
}
