import { describe, expect, test } from 'bun:test';

import { LOCAL_FRAMEWORK_DEPENDENCY } from '../create-zero/local-framework-package';
import {
  canonicalizeResolvedLocalArchiveLock,
  createLocalArchiveResolutionReference,
  createStagedPackageManifest,
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

    const dependency = JSON.stringify(reference.dependencySpecifier);
    const duplicate = `${dependency}\n${dependency}\n@zero/framework@${reference.archiveRelativePath}`;
    expect(() =>
      canonicalizeResolvedLocalArchiveLock(duplicate, reference, new Uint8Array())
    ).toThrow('found 2');
  });
});
