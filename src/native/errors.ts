/** Safe structured errors for native authentication operations. */

export class NativeAuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'NativeAuthError';
  }
}

/** Normalize unknown failures without copying secret-bearing response bodies. */
export function toNativeAuthError(
  error: unknown,
  fallbackCode = 'NATIVE_AUTH_FAILED',
): NativeAuthError {
  if (error instanceof NativeAuthError) return error;
  return new NativeAuthError('Native authentication failed.', fallbackCode, undefined, {
    cause: error,
  });
}
