import { describe, expect, test } from 'bun:test';

import { bindBunLockToLocalArchive } from './bun-lock-integrity';

const ENTRY_PREFIX =
  '    "@zero/framework": ["@zero/framework@./.zero/framework/zero-framework.tgz"';

describe('bindBunLockToLocalArchive', () => {
  test('changes only the managed archive integrity', () => {
    const lock = [
      '{',
      '  "packages": {',
      `${ENTRY_PREFIX}, {}, "sha512-b2xkLWZyYW1ld29yay1hcmNoaXZl"],`,
      '    "react": ["react@19.2.4", "", {}, "sha512-keep-me"]',
      '  }',
      '}',
      '',
    ].join('\n');

    expect(bindBunLockToLocalArchive(lock, Buffer.from('new archive\n'))).toBe(
      lock.replace(
        'sha512-b2xkLWZyYW1ld29yay1hcmNoaXZl',
        'sha512-/HIKk8ghCXbxIVTGK6wpvOeUpZ2aKNzMW3MV0HmnHMJpPTSJMEFdqvtkK+6r7xlVf3wRBogdE3uUsrxvtJkK6A=='
      )
    );
  });

  test('fails closed when the managed entry is absent or ambiguous', () => {
    expect(() => bindBunLockToLocalArchive('{}\n', new Uint8Array())).toThrow(
      'found 0'
    );
    const entry = `${ENTRY_PREFIX}, {}, "sha512-b2xk"],\n`;
    expect(() => bindBunLockToLocalArchive(entry + entry, new Uint8Array())).toThrow(
      'found 2'
    );
  });
});
