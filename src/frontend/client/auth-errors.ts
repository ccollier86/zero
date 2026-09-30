/** Error normalization shared by browser auth transports. */

export const AUTH_DISABLED_MESSAGE =
  '[client] Auth is disabled for this SDK client. Enable auth in createApp({ auth: true }) and <AppProvider auth>, or remove auth-only UI/actions.';

/** Error thrown by AuthClient when an auth route returns a non-2xx response. */
export class AuthClientError extends Error {
  readonly retryable: boolean;

  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'AuthClientError';
    this.retryable = getAuthResponseRetryable(body);
  }
}

/**
 * Resolve an authenticated browser request against the configured Zero server
 * and reject any target that could send credentials to another origin.
 */
export function resolveAuthRequestUrl(baseUrl: string, requestUrl: string): string {
  try {
    const fallback = typeof location !== 'undefined' ? location.href : undefined;
    const server = fallback ? new URL(baseUrl, fallback) : new URL(baseUrl);
    if (server.protocol !== 'http:' && server.protocol !== 'https:') {
      throw new TypeError('Unsupported Zero server protocol');
    }

    server.hash = '';
    server.search = '';
    if (!server.pathname.endsWith('/')) server.pathname += '/';

    const target = new URL(requestUrl, server);
    if (
      (target.protocol !== 'http:' && target.protocol !== 'https:')
      || target.origin !== server.origin
    ) {
      throw new TypeError('Authenticated request origin did not match');
    }

    return target.href;
  } catch (error) {
    if (error instanceof AuthClientError) throw error;
    throw new AuthClientError(
      'Authenticated requests must target the configured Zero server origin.',
      0,
      'AUTH_REQUEST_ORIGIN_MISMATCH',
      null,
    );
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

function getAuthResponseRetryable(body: unknown): boolean {
  return Boolean(
    body
    && typeof body === 'object'
    && 'retryable' in body
    && (body as { retryable?: unknown }).retryable === true,
  );
}
