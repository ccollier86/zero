import { describe, expect, test } from 'bun:test';

import {
  normalizeAbsoluteLocalPath,
  normalizeConfiguredLocalPath,
} from './local-path';

describe('local auth paths', () => {
  test('canonicalizes safe root-relative and configured paths', () => {
    expect(normalizeAbsoluteLocalPath('/app/../dashboard?tab=home#today'))
      .toBe('/dashboard?tab=home#today');
    expect(normalizeConfiguredLocalPath('dashboard')).toBe('/dashboard');
  });

  test('rejects external and canonicalized protocol-relative paths', () => {
    for (const value of [
      'https://attacker.example',
      '//attacker.example',
      '/\\attacker.example',
      '/%2e%2e//attacker.example',
      '/a/%2e%2e//attacker.example',
      '/%2f%2fattacker.example',
      '/%5cattacker.example',
    ]) {
      expect(normalizeAbsoluteLocalPath(value)).toBeNull();
      expect(normalizeConfiguredLocalPath(value)).toBeNull();
    }
  });
});
