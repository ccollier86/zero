/**
 * clipboard.ts
 *
 * Provides SecretField's narrow clipboard boundary. This file owns browser
 * capability detection and text-copy delegation only; callers own UI state,
 * announcements, and observability.
 */

/** The smallest clipboard capability needed by SecretField. */
export interface ClipboardWriter {
  writeText(value: string): Promise<void>;
}

const CLIPBOARD_UNAVAILABLE_MESSAGE =
  'Clipboard access is unavailable in this environment.';

/** Error returned when the browser does not expose a writable clipboard. */
export class ClipboardUnavailableError extends Error {
  constructor() {
    super(CLIPBOARD_UNAVAILABLE_MESSAGE);
    this.name = 'ClipboardUnavailableError';
  }
}

function browserClipboard(): ClipboardWriter | null {
  if (typeof navigator === 'undefined') return null;

  const clipboard = navigator.clipboard;
  if (!clipboard || typeof clipboard.writeText !== 'function') return null;

  return clipboard;
}

/**
 * Copy text through an injected writer or the current browser clipboard.
 *
 * Passing `null` deliberately represents an unavailable clipboard in tests or
 * non-browser hosts. The unavailable error never contains the copied value.
 */
export async function copyTextToClipboard(
  value: string,
  writer: ClipboardWriter | null = browserClipboard(),
): Promise<void> {
  if (!writer) throw new ClipboardUnavailableError();
  await writer.writeText(value);
}
