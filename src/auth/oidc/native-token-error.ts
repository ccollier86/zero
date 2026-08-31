/** RFC 6749-style token endpoint errors with deliberately generic grant failures. */

export type NativeTokenErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unsupported_grant_type'
  | 'temporarily_unavailable';

export class NativeTokenError extends Error {
  constructor(
    public readonly code: NativeTokenErrorCode,
    description: string,
    public readonly status = code === 'temporarily_unavailable' ? 429 : 400,
    public readonly authenticate?: string,
  ) {
    super(description);
    this.name = 'NativeTokenError';
  }
}

export function nativeTokenErrorResponse(error: NativeTokenError): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
  };
  if (error.authenticate) headers['WWW-Authenticate'] = error.authenticate;
  return new Response(JSON.stringify({
    error: error.code,
    error_description: error.message,
  }), {
    status: error.status,
    headers,
  });
}
