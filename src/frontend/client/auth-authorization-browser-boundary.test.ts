import { describe, expect, test } from 'bun:test';

const browserFiles = [
  'src/frontend/client/auth-authorization-types.ts',
  'src/frontend/client/auth-authorization-transport.ts',
  'src/frontend/client/auth-authorization-controller.ts',
  'src/frontend/client/authorization-hooks.ts',
  'src/components/auth/authorization-gates.tsx',
];

describe('browser authorization boundary', () => {
  test('does not import server auth/runtime/database modules or reference credentials', async () => {
    for (const path of browserFiles) {
      const source = await Bun.file(path).text();
      expect(source).not.toMatch(/from ['"](?:\.\.\/)+auth\//);
      expect(source).not.toContain('bun:sqlite');
      expect(source).not.toContain('token-service');
      expect(source).not.toContain('refreshToken');
      expect(source).not.toContain('sessionId');
    }
  });
});
