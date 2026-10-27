/** Shared pure link contract for configured and accepted notification routes. Never accepts an external origin or authority selector. */
import { messagingText } from './validation';
export function messagingNotificationPath(value: unknown): string {
  // Reserve 600 characters for an encoded opaque ID and 14 for its delimiter.
  const path = messagingText(value, 400);
  if (!path.startsWith('/') || path.startsWith('//') || /[\\?#\p{Cc}]/u.test(path)) throw new Error('[messaging] notifications.path must be a local path without query or fragment.');
  return path;
}
