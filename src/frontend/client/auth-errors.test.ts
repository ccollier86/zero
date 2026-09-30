import { describe, expect, it } from 'bun:test';
import { createAuthClientError } from './auth-errors';

describe('createAuthClientError', () => {
  it('preserves structured auth failures', () => {
    const response = new Response(null, { status: 403 });
    const error = createAuthClientError(response, {
      error: 'Forbidden',
      code: 'FORBIDDEN',
    }, 'Auth failed');

    expect(error.message).toBe('Forbidden');
    expect(error.status).toBe(403);
    expect(error.code).toBe('FORBIDDEN');
    expect(error.retryable).toBe(false);
  });

  it('projects an explicit retryable auth conflict without guessing from status', () => {
    const response = new Response(null, { status: 409 });
    const error = createAuthClientError(response, {
      error: 'Authentication update conflicted; retry the request',
      code: 'AUTH_COMMIT_CONFLICT',
      retryable: true,
    }, 'Auth failed');

    expect(error.code).toBe('AUTH_COMMIT_CONFLICT');
    expect(error.retryable).toBe(true);
  });

  it('includes HTTP status when an upstream body is not structured', () => {
    const response = new Response(null, { status: 422 });
    const error = createAuthClientError(response, {
      type: 'validation',
      summary: 'body validation failed',
    }, 'Admin auth request failed');

    expect(error.message).toBe('Admin auth request failed (HTTP 422)');
    expect(error.status).toBe(422);
    expect(error.code).toBeNull();
  });

  it('preserves a structured resource-not-found failure instead of blaming auth setup', () => {
    const response = new Response(null, { status: 404 });
    const error = createAuthClientError(response, {
      error: 'User not found',
      code: 'USER_NOT_FOUND',
    }, 'Admin auth request failed');

    expect(error.message).toBe('User not found');
    expect(error.status).toBe(404);
    expect(error.code).toBe('USER_NOT_FOUND');
  });

  it('keeps the auth-setup hint for an unstructured missing route', () => {
    const response = new Response(null, { status: 404 });
    const error = createAuthClientError(response, null, 'Admin auth request failed');

    expect(error.message).toContain('Auth route not found');
    expect(error.status).toBe(404);
    expect(error.code).toBeNull();
  });
});
