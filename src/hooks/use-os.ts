/**
 * use-os.ts
 *
 * Provides lightweight operating-system detection for frontend UI branching.
 * This file owns browser navigator parsing only; it does not perform feature
 * detection or platform authorization.
 */

import { useEffect, useState } from 'react';

export type OperatingSystem =
  | 'undetermined'
  | 'macos'
  | 'ios'
  | 'windows'
  | 'android'
  | 'linux'
  | 'chromeos';

export type UseOsReturnValue = OperatingSystem;

export interface OSDetectionInput {
  /** Browser user agent string. Defaults to an empty string for pure tests. */
  userAgent?: string;
  /** Browser platform string or UA Client Hints platform. */
  platform?: string;
  /** Touch point count used to detect iPadOS devices that report as macOS. */
  maxTouchPoints?: number;
}

export interface UseOsOptions {
  /**
   * Detect the OS after mount to avoid hydration differences.
   *
   * Set false when client-only rendering needs the value during the first
   * browser render. Server rendering still returns `undetermined`.
   */
  getValueInEffect?: boolean;
}

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    platform?: string;
  };
};

/**
 * Detect an operating system from user-agent style inputs.
 *
 * Pass explicit strings in tests or call with no arguments in browser-only
 * code through `useOs()`.
 */
export function getOS(input: OSDetectionInput = {}): OperatingSystem {
  const userAgent = (input.userAgent ?? '').toLowerCase();
  const platform = (input.platform ?? '').toLowerCase();
  const maxTouchPoints = input.maxTouchPoints ?? 0;

  if (userAgent.includes('cros') || platform.includes('chrome os')) return 'chromeos';
  if (userAgent.includes('android')) return 'android';
  if (
    userAgent.includes('iphone') ||
    userAgent.includes('ipad') ||
    userAgent.includes('ipod') ||
    (platform.includes('mac') && maxTouchPoints > 1)
  ) {
    return 'ios';
  }
  if (platform.includes('win') || userAgent.includes('windows')) return 'windows';
  if (platform.includes('mac') || userAgent.includes('mac os')) return 'macos';
  if (platform.includes('linux') || userAgent.includes('linux')) return 'linux';

  return 'undetermined';
}

function getBrowserOS(): OperatingSystem {
  if (typeof navigator === 'undefined') return 'undetermined';

  const browserNavigator = navigator as NavigatorWithUserAgentData;
  return getOS({
    userAgent: browserNavigator.userAgent,
    platform: browserNavigator.userAgentData?.platform ?? browserNavigator.platform,
    maxTouchPoints: browserNavigator.maxTouchPoints,
  });
}

/**
 * Return the current browser operating system, or `undetermined` during SSR.
 *
 * By default the value is read in an effect so server-rendered markup does not
 * drift during hydration.
 */
export function useOs(options: UseOsOptions = {}): OperatingSystem {
  const getValueInEffect = options.getValueInEffect ?? true;
  const [os, setOs] = useState<OperatingSystem>(
    getValueInEffect ? 'undetermined' : getBrowserOS(),
  );

  useEffect(() => {
    setOs(getBrowserOS());
  }, []);

  return os;
}
