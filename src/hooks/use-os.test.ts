/**
 * use-os.test.ts
 *
 * Verifies the pure operating-system parser used by the browser hook. This
 * file owns hook helper contract tests only.
 */

import { describe, expect, it } from 'bun:test';
import { getOS } from './use-os';

describe('getOS', () => {
  it('detects common desktop platforms', () => {
    expect(getOS({ platform: 'MacIntel' })).toBe('macos');
    expect(getOS({ platform: 'Win32' })).toBe('windows');
    expect(getOS({ platform: 'Linux x86_64' })).toBe('linux');
  });

  it('detects mobile and ChromeOS platforms before generic linux/mac matches', () => {
    expect(getOS({ userAgent: 'Mozilla/5.0 (Linux; Android 14)' })).toBe('android');
    expect(getOS({ userAgent: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)' })).toBe('chromeos');
    expect(getOS({ platform: 'MacIntel', maxTouchPoints: 5 })).toBe('ios');
  });

  it('returns undetermined when the input cannot identify an OS', () => {
    expect(getOS()).toBe('undetermined');
    expect(getOS({ userAgent: 'Unknown', platform: 'Unknown' })).toBe('undetermined');
  });
});
