/** Small injectable clipboard boundary used by secret-bearing auth UI. */

export interface AuthClipboardWriter {
  writeText(value: string): Promise<void>;
}

export async function writeAuthClipboardText(
  value: string,
  writer: AuthClipboardWriter | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator.clipboard,
): Promise<void> {
  if (!writer || typeof writer.writeText !== 'function') {
    throw new Error('Clipboard access is unavailable. Copy the value manually.');
  }
  await writer.writeText(value);
}
