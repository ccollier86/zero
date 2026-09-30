import { AuthError } from './types';

export function apiKeysUnavailable(message = 'API keys are unavailable'): AuthError {
  return new AuthError(message, 'AUTH_API_KEYS_UNAVAILABLE', 404);
}

export function apiKeyValidation(message: string): AuthError {
  return new AuthError(message, 'AUTH_API_KEY_VALIDATION_FAILED', 422);
}

export function apiKeyNotFound(): AuthError {
  return new AuthError('API key not found', 'AUTH_API_KEY_NOT_FOUND', 404);
}

export function apiKeyConflict(): AuthError {
  return new AuthError(
    'API key changed; reload and retry',
    'AUTH_API_KEY_CONFLICT',
    409,
  );
}

export function apiKeyLimitReached(): AuthError {
  return new AuthError(
    'Active API key limit reached',
    'AUTH_API_KEY_LIMIT_REACHED',
    409,
  );
}

export function apiKeySubjectUnavailable(): AuthError {
  return new AuthError(
    'API key subject is unavailable',
    'AUTH_API_KEY_SUBJECT_UNAVAILABLE',
    404,
  );
}

export function apiKeySubjectIneligible(): AuthError {
  return new AuthError(
    'User is not eligible for API keys',
    'AUTH_API_KEY_SUBJECT_INELIGIBLE',
    403,
  );
}

export function apiKeyForbidden(): AuthError {
  return new AuthError('Forbidden', 'FORBIDDEN', 403);
}

export function apiKeyAuthorityChanged(): AuthError {
  return new AuthError(
    'Authorization changed before the API key operation could commit',
    'AUTHORIZATION_CHANGED',
    409,
  );
}
