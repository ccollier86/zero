import { describe, expect, test } from 'bun:test';

const browserFiles = [
  'src/frontend/client/auth-domain-types.ts',
  'src/frontend/client/auth-domain-transport.ts',
  'src/frontend/client/domain-onboarding-hooks.ts',
  'src/components/auth/domain-onboarding.tsx',
  'src/components/auth/tenant-domain-management.tsx',
];

describe('verified-domain browser boundary', () => {
  test('has no server/database imports or persisted proof internals', async () => {
    for (const path of browserFiles) {
      const source = await Bun.file(path).text();
      expect(source).not.toMatch(/from ['"](?:\.\.\/)+auth\//);
      expect(source).not.toContain('bun:sqlite');
      expect(source).not.toContain('tokenDigest');
      expect(source).not.toContain('leaseOwner');
      expect(source).not.toContain('refreshToken');
    }
  });

  test('keeps matching and admission authority out of browser source', async () => {
    const transport = await Bun.file(
      'src/frontend/client/auth-domain-transport.ts',
    ).text();
    expect(transport).not.toContain('endsWith(');
    expect(transport).not.toContain('auto-join');
    expect(transport).not.toContain('tenantId:');
    expect(transport).not.toContain('roleKey:');
    expect(transport).not.toContain('email:');
  });
});
