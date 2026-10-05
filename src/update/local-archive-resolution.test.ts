import { describe, expect, test } from 'bun:test';

import { LOCAL_FRAMEWORK_DEPENDENCY } from '../create-zero/local-framework-package';
import {
  canonicalizeResolvedLocalArchiveLock,
  createLocalArchiveResolutionReference,
  createStagedPackageManifest,
  hasManagedLocalArchiveOverride,
} from './local-archive-resolution';

describe('local archive resolution refresh', () => {
  test('stages only the managed dependency and restores a resolved lock to its canonical path', () => {
    const reference = createLocalArchiveResolutionReference(
      '2ba2ca52-4a93-4e3f-97f3-49b6cc035d3d'
    );
    const original = {
      name: 'fixture-app',
      dependencies: {
        '@zero/framework': LOCAL_FRAMEWORK_DEPENDENCY,
        react: '19.2.4',
      },
    };
    const staged = JSON.parse(
      createStagedPackageManifest(original, 'dependencies', reference)
    ) as typeof original;
    expect(staged.dependencies['@zero/framework']).toBe(reference.dependencySpecifier);
    expect(staged.dependencies.react).toBe('19.2.4');
    expect(original.dependencies['@zero/framework']).toBe(LOCAL_FRAMEWORK_DEPENDENCY);

    const lock = [
      '{',
      '  "workspaces": {',
      '    "": {',
      '      "dependencies": {',
      `        "@zero/framework": ${JSON.stringify(reference.dependencySpecifier)},`,
      '        "react": "19.2.4"',
      '      }',
      '    }',
      '  },',
      '  "packages": {',
      `    "@zero/framework": ["@zero/framework@${reference.archiveRelativePath}", { "dependencies": { "fresh-only": "2.0.0" } }, "sha512-b2xk"],`,
      '    "react": ["react@19.2.4", "", {}, "sha512-keep-me"]',
      '  }',
      '}',
      '',
    ].join('\n');
    const normalized = canonicalizeResolvedLocalArchiveLock(
      lock,
      reference,
      new TextEncoder().encode('new archive\n')
    );

    expect(normalized).toContain(`"@zero/framework": "${LOCAL_FRAMEWORK_DEPENDENCY}"`);
    expect(normalized).toContain(
      '"@zero/framework@./.zero/framework/zero-framework.tgz"'
    );
    expect(normalized).toContain('"fresh-only": "2.0.0"');
    expect(normalized).toContain('"sha512-keep-me"');
    expect(normalized).not.toContain(reference.archiveRelativePath);
  });

  test('fails closed for unsafe tokens or an unresolved and ambiguous staged reference', () => {
    expect(() => createLocalArchiveResolutionReference('../escape')).toThrow('unsafe');
    const reference = createLocalArchiveResolutionReference('abc123');
    expect(() =>
      canonicalizeResolvedLocalArchiveLock('{}\n', reference, new Uint8Array())
    ).toThrow('staged dependency specifier');

    const duplicate = stagedLock(reference, { extra: reference.dependencySpecifier });
    expect(() =>
      canonicalizeResolvedLocalArchiveLock(duplicate, reference, new Uint8Array())
    ).toThrow('found 2');
  });

  test('stages a matching root override but preserves workspace peer ranges and unrelated overrides', () => {
    const reference = createLocalArchiveResolutionReference('abc123');
    const original = {
      name: 'fixture', workspaces: ['packages/*'],
      dependencies: { '@zero/framework': LOCAL_FRAMEWORK_DEPENDENCY, react: '19.2.4' },
      overrides: { '@zero/framework': LOCAL_FRAMEWORK_DEPENDENCY, react: '19.2.4' },
    };
    const before = JSON.stringify(original);
    const staged = JSON.parse(createStagedPackageManifest(original, 'dependencies', reference));
    expect(staged.dependencies['@zero/framework']).toBe(reference.dependencySpecifier);
    expect(staged.overrides['@zero/framework']).toBe(reference.dependencySpecifier);
    expect(staged.overrides.react).toBe('19.2.4');
    expect(JSON.stringify(original)).toBe(before);

    const lock = stagedLock(reference, {
      overrides: { '@zero/framework': reference.dependencySpecifier, react: '19.2.4' },
    });
    const normalized = canonicalizeResolvedLocalArchiveLock(lock, reference, new Uint8Array([1, 2, 3]));
    const parsed = Bun.JSON5.parse(normalized) as {
      workspaces: Record<string, {
        dependencies: Record<string, string>;
        peerDependencies: Record<string, string>;
      }>;
      overrides: Record<string, string>;
      packages: Record<string, unknown[]>;
    };
    expect(parsed.workspaces[''].dependencies['@zero/framework']).toBe(LOCAL_FRAMEWORK_DEPENDENCY);
    expect(parsed.overrides['@zero/framework']).toBe(LOCAL_FRAMEWORK_DEPENDENCY);
    expect(parsed.overrides.react).toBe('19.2.4');
    expect(parsed.workspaces['packages/bridge'].peerDependencies['@zero/framework']).toBe('*');
    expect(parsed.packages.react).toEqual(['react@19.2.4', '', {}, 'sha512-keep']);
    expect(normalized).not.toContain(reference.archiveRelativePath);
  });

  test('rejects mismatched overrides and misplaced staging references instead of rewriting them', () => {
    expect(hasManagedLocalArchiveOverride({ overrides: { react: '19.2.4' } })).toBe(false);
    for (const value of ['^2.2.0', 'file:../other.tgz', { nested: LOCAL_FRAMEWORK_DEPENDENCY }, null]) {
      expect(() => hasManagedLocalArchiveOverride({ overrides: { '@zero/framework': value } })).toThrow('override must match');
    }
    const reference = createLocalArchiveResolutionReference('abc123');
    expect(() => canonicalizeResolvedLocalArchiveLock(stagedLock(reference, {
      overrides: { '@zero/framework': LOCAL_FRAMEWORK_DEPENDENCY },
    }), reference, new Uint8Array())).toThrow('override did not resolve');
    expect(() => canonicalizeResolvedLocalArchiveLock(stagedLock(reference, {
      unexpected: reference.dependencySpecifier,
    }), reference, new Uint8Array())).toThrow('found 2');
  });
});

function stagedLock(
  reference: ReturnType<typeof createLocalArchiveResolutionReference>,
  extras: Record<string, unknown> = {}
): string {
  // Trailing commas are representative of Bun's JSONC lockfile format.
  const workspaces = {
      '': { dependencies: { '@zero/framework': reference.dependencySpecifier } },
      'packages/bridge': { name: '@fixture/bridge', peerDependencies: { '@zero/framework': '*' } },
  };
  return [
    '{', `  "workspaces": ${JSON.stringify(workspaces)},`,
    ...Object.entries(extras).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`),
    '  "packages": {',
    `    "@zero/framework": ${JSON.stringify([`@zero/framework@${reference.archiveRelativePath}`, {}, 'sha512-b2xk'])},`,
    '    "react": ["react@19.2.4", "", {}, "sha512-keep"],',
    '  },', '}', '',
  ].join('\n');
}
