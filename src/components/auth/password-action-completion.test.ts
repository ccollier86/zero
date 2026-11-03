/** Memory-only confirmation cannot cross links, clients, actions, accounts or replaced SDK continuations. */
import { expect, test } from 'bun:test';
import type { Client } from '../../frontend/client/sdk';
import type { AuthActionTokenInfo, AuthCompletionResult, AuthPasswordUpdatedResult } from '../../frontend/client/auth-types';
import { readPasswordActionCompletion, rememberPasswordActionCompletion } from './password-action-completion';

function fixture() {
  const info = { valid: true, type: 'password_reset', expiresAt: Date.now() + 1000,
    user: { userId: 'fixture', username: 'fixture', email: 'fixture@example.test' } } as AuthActionTokenInfo;
  const result = { passwordUpdated: true, signInRequired: true, user: { userId: 'fixture' } } as AuthPasswordUpdatedResult;
  const auth = { isAuthenticated: false, authenticationContinuation: result as AuthCompletionResult | null };
  const client = { auth } as unknown as Client;
  return { info, result, auth, client };
}
test('only the exact completed SDK response and consumed link can inform a remounted form', () => {
  const f = fixture();
  rememberPasswordActionCompletion(f.client, 'consumed-proof', 'reset', f.info, f.result);
  expect(readPasswordActionCompletion(f.client, 'consumed-proof', 'reset')).toBe(f.result);
  expect(readPasswordActionCompletion(f.client, 'consumed-proof', 'auto')).toBe(f.result);
  expect(readPasswordActionCompletion(f.client, 'other-proof', 'reset')).toBeNull();
  expect(readPasswordActionCompletion(f.client, 'consumed-proof', 'setup')).toBeNull();
  expect(readPasswordActionCompletion(fixture().client, 'consumed-proof', 'reset')).toBeNull();
  expect(JSON.stringify(f.auth.authenticationContinuation)).not.toContain('consumed-proof');
  f.auth.authenticationContinuation = { ...f.result };
  expect(readPasswordActionCompletion(f.client, 'consumed-proof', 'reset')).toBeNull();
  f.auth.authenticationContinuation = null;
  expect(readPasswordActionCompletion(f.client, 'consumed-proof', 'reset')).toBeNull();
});
test('unknown, unrelated-account or uncommitted results never create a success receipt', () => {
  for (const result of [null, {} as AuthCompletionResult, { ...fixture().result, user: { userId: 'other' } } as AuthPasswordUpdatedResult]) {
    const f = fixture(); f.auth.authenticationContinuation = result;
    rememberPasswordActionCompletion(f.client, 'proof', 'reset', f.info, result);
    expect(readPasswordActionCompletion(f.client, 'proof', 'reset')).toBeNull();
  }
  const f = fixture(); f.auth.isAuthenticated = true;
  rememberPasswordActionCompletion(f.client, 'proof', 'reset', f.info, f.result);
  expect(readPasswordActionCompletion(f.client, 'proof', 'reset')).toBeNull();
});
test('a client retains at most its last confirmation, not an unbounded log of used proofs', () => {
  const f = fixture(); rememberPasswordActionCompletion(f.client, 'first', 'reset', f.info, f.result);
  const second = { ...f.result }; f.auth.authenticationContinuation = second;
  rememberPasswordActionCompletion(f.client, 'second', 'reset', f.info, second);
  expect(readPasswordActionCompletion(f.client, 'second', 'reset')).toBe(second);
  expect(readPasswordActionCompletion(f.client, 'first', 'reset')).toBeNull();
  f.auth.isAuthenticated = true;
  expect(readPasswordActionCompletion(f.client, 'second', 'reset')).toBeNull();
});
