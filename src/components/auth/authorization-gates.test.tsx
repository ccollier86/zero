import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AdministrationScopeGate,
  PermissionGate,
  PlatformAdminGate,
  TenantGate,
} from './authorization-gates';

describe('authorization gates', () => {
  test('fail closed during SSR without exposing protected children', () => {
    for (const element of [
      createElement(PermissionGate, {
        permission: 'records:read',
        fallback: 'denied',
        children: 'secret',
      }),
      createElement(TenantGate, { fallback: 'denied', children: 'secret' }),
      createElement(AdministrationScopeGate, {
        fallback: 'denied',
        children: 'secret',
      }),
      createElement(PlatformAdminGate, { fallback: 'denied', children: 'secret' }),
    ]) {
      const markup = renderToStaticMarkup(element);
      expect(markup).toContain('denied');
      expect(markup).not.toContain('secret');
    }
  });
});
