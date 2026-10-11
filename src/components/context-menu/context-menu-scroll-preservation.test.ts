/** Byte-level regression gate for the retained ContextMenu engine; tests never delete original source. */
import { expect, test } from 'bun:test';

const originals = {
  'context-menu-content.tsx': '4d73d76a333f21c798f568b3a4c6c7d3dbfbe4c171a8aad8a854a40270c3732c',
  'context-menu-surface.tsx': '1319e5dabaf9c8192fd7ebc67ec1406c10e8650e093e238077cd1ac4ae759054',
  'context-menu-styles.ts': '04ea6734cb8b8fccc0c998d97f5201ec2904cab8c0467f75adbf03bf208bdc6a',
} as const;

test('Arc context-menu adoption retains the original content, motion and style engines byte for byte', async () => {
  for (const [name, expected] of Object.entries(originals)) {
    const file = Bun.file(new URL(name, import.meta.url));
    expect(await file.exists()).toBe(true);
    expect(new Bun.CryptoHasher('sha256').update(await file.arrayBuffer()).digest('hex')).toBe(expected);
  }
});
