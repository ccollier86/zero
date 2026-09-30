export const IDENTITY_PROJECTION_ERROR_CODES = Object.freeze([
  'IDENTITY_PROJECTION_NOT_READY',
  'IDENTITY_PROJECTION_CONFLICT',
  'IDENTITY_PROJECTION_QUARANTINED',
  'IDENTITY_PROJECTION_SCHEMA_INVALID',
  'IDENTITY_PROJECTION_TARGET_MISMATCH',
  'IDENTITY_PROJECTION_LEASE_LOST',
] as const);

export type IdentityProjectionErrorCode =
  (typeof IDENTITY_PROJECTION_ERROR_CODES)[number];

const RETRYABLE_CODES: ReadonlySet<IdentityProjectionErrorCode> = new Set([
  'IDENTITY_PROJECTION_NOT_READY',
  'IDENTITY_PROJECTION_LEASE_LOST',
]);

/** Stable, privacy-safe failure shared by projection stores and adapters. */
export class IdentityProjectionError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code: IdentityProjectionErrorCode,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = 'IdentityProjectionError';
    this.retryable = RETRYABLE_CODES.has(code);
  }
}

export function identityProjectionError(
  code: IdentityProjectionErrorCode,
  options: ErrorOptions = {},
): IdentityProjectionError {
  return new IdentityProjectionError(code, safeMessage(code), options);
}

function safeMessage(code: IdentityProjectionErrorCode): string {
  switch (code) {
    case 'IDENTITY_PROJECTION_NOT_READY':
      return 'Identity projection is not ready';
    case 'IDENTITY_PROJECTION_CONFLICT':
      return 'Identity anchor conflicts with retained application data';
    case 'IDENTITY_PROJECTION_QUARANTINED':
      return 'Identity projection target is quarantined';
    case 'IDENTITY_PROJECTION_SCHEMA_INVALID':
      return 'Identity projection schema is incompatible';
    case 'IDENTITY_PROJECTION_TARGET_MISMATCH':
      return 'Identity projection target binding does not match';
    case 'IDENTITY_PROJECTION_LEASE_LOST':
      return 'Identity projection delivery lease is no longer owned';
  }
}
