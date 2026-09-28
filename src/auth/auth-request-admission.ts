/** HTTP source resolution and route-facing public auth admission helpers. */

import { canonicalizeEmail, isEmailLoginIdentifier } from './auth-email-identity';
import type { AuthRequestAdmissionService } from './auth-request-admission-service';
import type { AuthRequestAdmissionFlow } from './auth-request-admission-types';
import { AuthError } from './types';

export function admitAuthRequest(input: {
  service: AuthRequestAdmissionService | null;
  request: Request;
  peerAddress?: string | null;
  flow: AuthRequestAdmissionFlow;
  subject?: string | null;
}): void {
  if (!input.service || !input.service.config.enabled) return;
  let source: unknown;
  try {
    source = input.service.config.sourceKey({
      request: input.request,
      flow: input.flow,
      peerAddress: input.peerAddress,
    });
  } catch {
    throw new AuthError(
      'Authentication request admission is temporarily unavailable',
      'AUTH_ADMISSION_UNAVAILABLE',
      503,
    );
  }
  if (source !== null && source !== undefined && typeof source !== 'string') {
    throw new AuthError(
      'Authentication request admission is temporarily unavailable',
      'AUTH_ADMISSION_UNAVAILABLE',
      503,
    );
  }
  input.service.admit({
    flow: input.flow,
    source,
    subject: normalizeAdmissionSubject(input.flow, input.subject),
  });
}

function normalizeAdmissionSubject(
  flow: AuthRequestAdmissionFlow,
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  if (flow === 'bootstrap' || flow === 'registration'
    || isEmailLoginIdentifier(value)) {
    return canonicalizeEmail(value);
  }
  return value.trim();
}
