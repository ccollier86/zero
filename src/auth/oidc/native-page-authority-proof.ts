/** Exact live browser authority used to fence native authorization mutations. */

import type { AuthContext, AuthContextAuthorityReference } from '../types';
import type { NativeServiceContext } from './native-service-context';
import {
  sameNativeAuthority,
  type NativeAuthoritySnapshot,
} from './native-tenant-authority';

export interface NativePageAuthorityProof {
  readonly reference: AuthContextAuthorityReference;
  readonly authority: NativeAuthoritySnapshot;
}

/** Capture the generation/session proof represented by one resolved page credential. */
export function captureNativePageAuthorityProof(
  context: NativeServiceContext,
  auth: AuthContext,
): NativePageAuthorityProof | null {
  const reference = context.tokens.captureAuthContextAuthority(auth);
  const authority = context.authority.capturePageAuthority(auth);
  return reference && authority
    ? Object.freeze({ reference, authority: Object.freeze({ ...authority }) })
    : null;
}

/** Re-resolve every user, session, tenant, membership, and role revision at commit. */
export function isNativePageAuthorityProofCurrent(
  context: NativeServiceContext,
  proof: NativePageAuthorityProof,
): boolean {
  const current = context.tokens.resolveAuthContextAuthority(proof.reference);
  const authority = current ? context.authority.capturePageAuthority(current) : null;
  return Boolean(authority && sameNativeAuthority(authority, proof.authority));
}
