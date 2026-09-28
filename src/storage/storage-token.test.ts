import { describe, expect, test } from 'bun:test';

import { createSignedStorageToken, verifySignedStorageToken } from './storage-token';

const SECRET = 'storage-token-test-secret-with-32-bytes-minimum';

describe('storage capability token codec', () => {
  test('round-trips UTF-8 JSON payloads without changing the signed contract', async () => {
    const payload = {
      driveId: 'drv_test',
      path: '/患者/🧪 résumé.pdf',
      permission: 'read',
      expiresAt: 1_800_000_000_000,
    };

    const token = await createSignedStorageToken(payload, SECRET);

    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    await expect(verifySignedStorageToken(token, SECRET)).resolves.toEqual(payload);
  });

  test('keeps existing ASCII token encoding compatible', async () => {
    const payload = { path: '/reports/intake.pdf', permission: 'read' };
    const token = await createSignedStorageToken(payload, SECRET);
    const [encodedPayload] = token.split('.');

    const expected = btoa(JSON.stringify(payload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    expect(encodedPayload).toBe(expected);
    await expect(verifySignedStorageToken(token, SECRET)).resolves.toEqual(payload);
  });

  test('rejects payload and signature tampering', async () => {
    const token = await createSignedStorageToken({ path: '/患者/file.pdf' }, SECRET);
    const [payload, signature] = token.split('.');

    await expect(
      verifySignedStorageToken(`${tamperLastCharacter(payload!)}.${signature}`, SECRET),
    ).resolves.toBeNull();
    await expect(
      verifySignedStorageToken(`${payload}.${tamperLastCharacter(signature!)}`, SECRET),
    ).resolves.toBeNull();
  });
});

function tamperLastCharacter(value: string): string {
  return `${value.slice(0, -1)}${value.endsWith('A') ? 'B' : 'A'}`;
}
