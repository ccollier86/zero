import { describe, expect, test } from 'bun:test';

import {
  canonicalizeTenantName,
  canonicalizeTenantRoleKey,
  canonicalizeTenantSlug,
} from './tenancy-canonicalization';
import { TenancyError } from './tenancy-types';

describe('tenancy canonicalization boundary', () => {
  test.each([
    ['slug', canonicalizeTenantSlug, 'TENANT_INVALID_SLUG'],
    ['name', canonicalizeTenantName, 'TENANT_INVALID_NAME'],
    ['role', canonicalizeTenantRoleKey, 'TENANT_INVALID_ROLE'],
  ] as const)('rejects non-string %s input with a typed tenancy error', (
    _name,
    canonicalize,
    code,
  ) => {
    for (const value of [null, undefined, 42, {}, [], Symbol('invalid')]) {
      try {
        canonicalize(value);
        throw new Error('expected canonicalization to reject non-string input');
      } catch (error) {
        expect(error).toBeInstanceOf(TenancyError);
        expect(error).toMatchObject({ code });
      }
    }
  });
});
