import { describe, expect, test } from 'bun:test';
import {
  platformAdministrationPermissionDenied,
  platformAdministrationUnavailable,
  stalePlatformAdministrationOperation,
  stalePlatformAdministrationTarget,
} from './platform-administration-slice-utils';

describe('platform administration local errors', () => {
  test('uses the server-compatible unavailable error contract', () => {
    expect(platformAdministrationUnavailable()).toMatchObject({
      name: 'AuthClientError',
      status: 404,
      code: 'PLATFORM_ADMINISTRATION_UNAVAILABLE',
      body: null,
    });
  });

  test('uses the server-compatible permission error contract', () => {
    expect(platformAdministrationPermissionDenied()).toMatchObject({
      name: 'AuthClientError',
      status: 403,
      code: 'FORBIDDEN',
      body: null,
    });
  });

  test('uses the authorization-change contract for stale work', () => {
    for (const error of [
      stalePlatformAdministrationTarget(),
      stalePlatformAdministrationOperation(),
    ]) {
      expect(error).toMatchObject({
        name: 'AuthClientError',
        status: 409,
        code: 'AUTHORIZATION_CHANGED',
        body: null,
      });
    }
  });
});
