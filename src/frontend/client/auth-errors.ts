/** Error normalization shared by browser auth transports. */

export const AUTH_DISABLED_MESSAGE =
  '[client] Auth is disabled for this SDK client. Enable auth in createApp({ auth: true }) and <AppProvider auth>, or remove auth-only UI/actions.';

/** Error thrown by AuthClient when an auth route returns a non-2xx response. */
export class AuthClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'AuthClientError';
  }
}

export function createAuthDisabledError(): Error {
  return new Error(AUTH_DISABLED_MESSAGE);
}

export function createAuthClientError(
  response: Response,
  body: unknown,
  fallback: string,
): AuthClientError {
  return new AuthClientError(
    getAuthResponseErrorMessage(response, body, fallback),
    response.status,
    getAuthResponseCode(body),
    body,
  );
}

function getAuthResponseErrorMessage(
  response: Response,
  body: unknown,
  fallback: string,
): string {
  if (body && typeof body === 'object' && 'error' in body) {
    return String((body as { error?: unknown }).error ?? fallback);
  }

  if (response.status === 404) {
    return '[client] Auth route not found. Enable auth in createApp({ auth: true }) or disable frontend auth.';
  }

  return `${fallback} (HTTP ${response.status})`;
}

function getAuthResponseCode(body: unknown): string | null {
  if (body && typeof body === 'object' && 'code' in body) {
    const code = (body as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}
