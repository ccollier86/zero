/** Byte-level regression gate for the retained ContextMenu engine; tests never delete original source. */
import { expect, test } from 'bun:test';

const originals = {
  'context-menu-content.tsx': '4d73d76a333f21c798f568b3a4c6c7d3dbfbe4c171a8aad8a854a40270c3732c',
  // Qualified restoration-race repair: transient WAAPI keeps consumer inline
  // declarations untouched; the original 120ms timing and native events remain.
  'context-menu-surface.tsx': '45a57ebd5d0df14d35b5b93cb4d1384ea64e5257b00c58f86f1d21bc0bcac7f4',
  'context-menu-styles.ts': '04ea6734cb8b8fccc0c998d97f5201ec2904cab8c0467f75adbf03bf208bdc6a',
} as const;

test('Arc context-menu retains original content/style bytes and the explicitly qualified inline-restoration repair', async () => {
  for (const [name, expected] of Object.entries(originals)) {
    const file = Bun.file(new URL(name, import.meta.url));
    expect(await file.exists()).toBe(true);
    expect(new Bun.CryptoHasher('sha256').update(await file.arrayBuffer()).digest('hex')).toBe(expected);
  }
});
