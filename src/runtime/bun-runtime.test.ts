/** Native runtime compatibility contract; no configuration, services or persistent state are opened. */
import { describe, expect, test } from 'bun:test';
import manifest from '../../package.json';
import {
  assertSupportedBunRuntime,
  BUN_ENGINE_RANGE,
  getUnsupportedBunRuntimeError,
  isSupportedBunVersion,
  MINIMUM_BUN_VERSION,
  UnsupportedBunRuntimeError,
} from './bun-runtime';

describe('supported Bun runtime', () => {
  test('rejects affected, malformed and unqualified prerelease versions', () => {
    for (const version of [null, undefined, 140, '', 'unknown', '1.3.14', '1.3.99', '1.4.0-canary.1', '1.5.0-beta.1', 'x'.repeat(129)]) {
      expect(isSupportedBunVersion(version)).toBe(false);
    }
  });

  test('accepts the fixed minimum and newer stable builds', () => {
    for (const version of ['1.4.0', '1.4.0+34cbb9a40', '1.4.4', '1.5.0', '2.0.0']) {
      expect(isSupportedBunVersion(version)).toBe(true);
    }
    expect(isSupportedBunVersion(Bun.version)).toBe(true);
    expect(getUnsupportedBunRuntimeError()).toBeNull();
    expect(() => assertSupportedBunRuntime()).not.toThrow();
  });

  test('keeps package requirements aligned with the actual startup check', () => {
    expect(manifest.engines.bun).toBe(BUN_ENGINE_RANGE);
    expect(manifest.packageManager).toBe(`bun@${MINIMUM_BUN_VERSION}`);
  });

  test('provides a stable actionable error without application context', () => {
    const failure = new UnsupportedBunRuntimeError('1.3.14');
    expect(failure.code).toBe('ZERO_BUN_RUNTIME_UNSUPPORTED');
    expect(failure.message).toContain(MINIMUM_BUN_VERSION);
    expect(failure.message).toContain('1.3.14');
    expect(failure.message).toContain('rebuild any compiled server');
    expect(new UnsupportedBunRuntimeError(null).message).toContain('unavailable');
  });
});
