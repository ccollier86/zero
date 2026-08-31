/** Clones broker state across an untrusted mutation boundary such as IPC. */

import type { NativeAuthState } from './client-types';

export function cloneNativeAuthState(state: NativeAuthState): NativeAuthState {
  const aud: string | string[] | null = state.identity
    ? Array.isArray(state.identity.aud) ? [...state.identity.aud] : state.identity.aud
    : null;
  if (Array.isArray(aud)) Object.freeze(aud);
  const identity = state.identity
    ? Object.freeze({
        ...state.identity,
        aud: aud!,
      })
    : null;
  const error = state.error ? Object.freeze({ ...state.error }) : null;
  return Object.freeze({ status: state.status, identity, error });
}

export function sameNativeAuthState(left: NativeAuthState, right: NativeAuthState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
