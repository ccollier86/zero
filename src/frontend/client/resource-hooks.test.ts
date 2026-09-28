/**
 * resource-hooks.test.ts
 *
 * Covers the request gate shared by list and record resource hooks. Transport
 * behavior remains covered by resource-client tests.
 */

import { describe, expect, test } from 'bun:test';
import { shouldRunResourceLoad } from './resource-hooks';

describe('resource hook loading', () => {
  test('autoLoad false defers the automatic request', () => {
    expect(shouldRunResourceLoad(false, 'automatic')).toBe(false);
  });

  test('manual refresh remains available when autoLoad is false', () => {
    expect(shouldRunResourceLoad(false, 'manual')).toBe(true);
  });

  test('automatic loading remains the default', () => {
    expect(shouldRunResourceLoad(undefined, 'automatic')).toBe(true);
    expect(shouldRunResourceLoad(true, 'automatic')).toBe(true);
  });
});
