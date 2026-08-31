/** Bounded best-effort cleanup for browser and callback platform adapters. */

import { invokeAsync, settleWithin } from './abort';
import type { NativeCallbackSession, NativeSystemBrowser } from './adapter-types';

export function cleanupNativeAuthorization(
  callback: NativeCallbackSession | undefined,
  browser: NativeSystemBrowser,
  timeoutMs: number,
): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  if (callback) tasks.push(invokeAsync(() => callback.dispose()));
  if (browser.close) tasks.push(invokeAsync(() => browser.close!()));
  return settleWithin(tasks, Math.min(timeoutMs, 2_000));
}
