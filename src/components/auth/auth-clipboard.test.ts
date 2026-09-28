import { describe, expect, test } from 'bun:test';
import { writeAuthClipboardText } from './auth-clipboard';

describe('auth clipboard helper', () => {
  test('reports unavailable and rejected clipboard writes without leaking the value', async () => {
    await expect(writeAuthClipboardText('one-time-secret', undefined)).rejects.toThrow(
      'Clipboard access is unavailable',
    );
    await expect(writeAuthClipboardText('one-time-secret', {
      async writeText() {
        throw new Error('permission denied');
      },
    })).rejects.toThrow('permission denied');
  });
});
