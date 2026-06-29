/**
 * server-matcher.test.ts
 *
 * Verifies pure backend matcher normalization and applicability. These tests
 * do not mount Elysia or auth so matcher behavior stays independent from
 * middleware policy enforcement.
 */

import { describe, expect, test } from 'bun:test';

import {
  evaluateMiddlewareApplicability,
  inheritMatcherAuth,
  normalizeMiddlewareMatcher,
  type ZeroMiddlewareMatcher,
} from './server-matcher';

describe('server matcher', () => {
  test('normalizes legacy path and auth aliases', () => {
    const matcher = normalizeMiddlewareMatcher({
      path: '/api/*',
      auth: 'user',
    });

    expect(matcher).toEqual({
      path: '/api/*',
      auth: 'user',
    });
  });

  test('keeps explicit matcher fields ahead of legacy aliases', () => {
    const matcher = normalizeMiddlewareMatcher({
      path: '/legacy/*',
      auth: 'user',
      matcher: {
        path: '/modern/*',
        auth: 'admin',
      },
    });

    expect(matcher.path).toBe('/modern/*');
    expect(matcher.auth).toBe('admin');
  });

  test('inherits router auth only when matcher auth is omitted', () => {
    expect(inheritMatcherAuth({}, 'user')).toEqual({ auth: 'user' });
    expect(inheritMatcherAuth({ auth: false }, 'user')).toEqual({ auth: false });
    expect(inheritMatcherAuth({}, 'optional')).toEqual({});
  });

  test('matches exact, prefix, rest, parameter, regex, and function paths', async () => {
    const globalRegex = /^\/reports\/\d+$/g;

    await expect(applies({ path: '/api/customers' }, '/api/customers')).resolves.toBe(true);
    await expect(applies({ path: '/api/customers' }, '/api/customers/1')).resolves.toBe(false);
    await expect(applies({ path: '/api/*' }, '/api/customers')).resolves.toBe(true);
    await expect(applies({ path: '/api/:path*' }, '/api/customers/1')).resolves.toBe(true);
    await expect(applies({ path: '/users/:userId' }, '/users/u_1')).resolves.toBe(true);
    await expect(applies({ path: '/users/:userId' }, '/users/u_1/settings')).resolves.toBe(false);
    await expect(applies({ path: /^\/reports\/\d+$/ }, '/reports/42')).resolves.toBe(true);
    await expect(applies({ path: globalRegex }, '/reports/42')).resolves.toBe(true);
    await expect(applies({ path: globalRegex }, '/reports/42')).resolves.toBe(true);
    await expect(applies({ path: ({ request }) => new URL(request.url).pathname.endsWith('/ok') }, '/status/ok')).resolves.toBe(true);
  });

  test('matches methods independently from paths', async () => {
    await expect(applies({ method: 'POST' }, '/api/customers', 'POST')).resolves.toBe(true);
    await expect(applies({ method: ['POST', 'PATCH'] }, '/api/customers', 'PATCH')).resolves.toBe(true);
    await expect(applies({ method: ['POST', 'PATCH'] }, '/api/customers', 'GET')).resolves.toBe(false);
  });

  test('evaluates predicates after path and method applicability', async () => {
    let calls = 0;
    const matcher: ZeroMiddlewareMatcher = {
      path: '/api/*',
      method: 'POST',
      predicate() {
        calls += 1;
        return false;
      },
    };

    const pathMiss = await evaluateMiddlewareApplicability(matcher, context('/admin', 'POST'));
    const methodMiss = await evaluateMiddlewareApplicability(matcher, context('/api/customers', 'GET'));
    const predicateMiss = await evaluateMiddlewareApplicability(matcher, context('/api/customers', 'POST'));

    expect(pathMiss).toMatchObject({ applies: false, reason: 'path' });
    expect(methodMiss).toMatchObject({ applies: false, reason: 'method' });
    expect(predicateMiss).toMatchObject({ applies: false, reason: 'predicate' });
    expect(calls).toBe(1);
  });
});

async function applies(
  matcher: ZeroMiddlewareMatcher,
  pathname: string,
  method = 'GET'
): Promise<boolean> {
  const result = await evaluateMiddlewareApplicability(matcher, context(pathname, method));
  return result.applies;
}

function context(pathname: string, method = 'GET') {
  return {
    request: new Request(`http://localhost${pathname}`, { method }),
  };
}
