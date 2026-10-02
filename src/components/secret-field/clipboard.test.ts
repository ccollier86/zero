/** Verifies SecretField's injectable clipboard boundary and safe failures. */

import { describe, expect, test } from 'bun:test';

import {
  ClipboardUnavailableError,
  copyTextToClipboard,
  type ClipboardWriter,
} from './clipboard';

describe('copyTextToClipboard', () => {
  test('passes the complete value to an injected writer', async () => {
    const writes: string[] = [];
    const writer: ClipboardWriter = {
      async writeText(value) {
        writes.push(value);
      },
    };

    await copyTextToClipboard('zero_live_complete-secret', writer);

    expect(writes).toEqual(['zero_live_complete-secret']);
  });

  test('returns a stable secret-free error when clipboard access is unavailable', async () => {
    const secret = 'zero_live_do-not-leak';

    try {
      await copyTextToClipboard(secret, null);
      throw new Error('Expected clipboard copy to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(ClipboardUnavailableError);
      expect(String(error)).not.toContain(secret);
      expect((error as Error).message).toBe(
        'Clipboard access is unavailable in this environment.',
      );
    }
  });

  test('preserves writer rejection for the caller to classify', async () => {
    const rejection = new DOMException('Permission denied', 'NotAllowedError');
    const writer: ClipboardWriter = {
      writeText: () => Promise.reject(rejection),
    };

    expect(copyTextToClipboard('zero_live_secret', writer)).rejects.toBe(
      rejection,
    );
  });
});
