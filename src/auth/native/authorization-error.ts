import type {
  NativeAuthorizationErrorCode,
  NativeAuthorizationErrorPayload,
} from './types';
import { isValidNativeIssuer } from './issuer';

const ERROR_CODES = new Set<NativeAuthorizationErrorCode>([
  'invalid_request',
  'unauthorized_client',
  'access_denied',
  'interaction_required',
  'unsupported_response_type',
  'invalid_scope',
  'invalid_target',
  'server_error',
  'temporarily_unavailable',
]);

export class NativeAuthorizationError extends Error {
  constructor(
    public readonly code: NativeAuthorizationErrorCode,
    public readonly description: string,
    public readonly status = 400
  ) {
    super(description);
    this.name = 'NativeAuthorizationError';
  }
}

export function isNativeAuthorizationErrorCode(
  value: string
): value is NativeAuthorizationErrorCode {
  return ERROR_CODES.has(value as NativeAuthorizationErrorCode);
}

export function toNativeAuthorizationErrorParams(
  error: NativeAuthorizationError,
  context: { state?: string; issuer?: string } = {}
): URLSearchParams {
  const params = new URLSearchParams({
    error: error.code,
    error_description: error.description,
  });
  if (context.state) params.set('state', context.state);
  if (context.issuer) params.set('iss', context.issuer);
  return params;
}

export function parseNativeAuthorizationError(
  input: URL | URLSearchParams
): NativeAuthorizationErrorPayload | null {
  const params = input instanceof URL ? input.searchParams : input;
  if (hasDuplicateFields(params)) return null;
  const error = single(params, 'error');
  if (!error || !isNativeAuthorizationErrorCode(error)) return null;
  return {
    error,
    errorDescription: limited(single(params, 'error_description')),
    errorUri: safeErrorUri(single(params, 'error_uri')),
    state: limited(single(params, 'state')),
    issuer: safeIssuer(single(params, 'iss')),
  };
}

function single(params: URLSearchParams, key: string): string | undefined {
  const values = params.getAll(key);
  return values.length === 1 && values[0] ? values[0] : undefined;
}

function limited(value: string | undefined): string | undefined {
  return value && value.length <= 512 ? value : undefined;
}

function safeErrorUri(value: string | undefined): string | undefined {
  if (!value || value.length > 2_048 || value.includes('#')) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      ? value : undefined;
  } catch {
    return undefined;
  }
}

function safeIssuer(value: string | undefined): string | undefined {
  return value && value.length <= 2_048 && isValidNativeIssuer(value)
    ? value : undefined;
}

function hasDuplicateFields(params: URLSearchParams): boolean {
  return ['error', 'error_description', 'error_uri', 'state', 'iss']
    .some((key) => params.getAll(key).length > 1);
}
