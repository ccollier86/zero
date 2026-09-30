import { afterEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertCanonicalDatabaseDirectoryIsolation,
  assertDatabaseDirectoryIsolation,
  findDatabaseDirectoryConflict,
  resolveControlDatabasePaths,
  type DatabaseDirectoryIsolationInput,
} from './database-directory-isolation';
import { DatabaseError } from './database-error';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('database directory lexical isolation', () => {
  test('rejects a build output equal to, containing, or contained by the Fabric root', () => {
    const base = nonexistentBase('build');
    const storageDir = join(base, 'storage');

    expect(conflict({
      rootDirectory: join(base, 'fabric'),
      outDir: join(base, 'fabric'),
      storageDir,
    })).toBe('build-output');
    expect(conflict({
      rootDirectory: join(base, 'build', 'fabric'),
      outDir: join(base, 'build'),
      storageDir,
    })).toBe('build-output');
    expect(conflict({
      rootDirectory: join(base, 'fabric'),
      outDir: join(base, 'fabric', 'build'),
      storageDir,
    })).toBe('build-output');
  });

  test('rejects control file, hot source, and hot snapshot paths inside the Fabric root while allowing siblings', () => {
    const base = nonexistentBase('control');
    const rootDirectory = join(base, 'fabric');
    const common = {
      rootDirectory,
      outDir: join(base, 'build'),
      storageDir: join(base, 'storage'),
    };

    for (const controlPath of [
      join(rootDirectory, 'control.sqlite'),
      join(rootDirectory, 'source', 'control.sqlite'),
      join(rootDirectory, 'snapshots', 'control.sqlite'),
    ]) {
      expect(conflict({
        ...common,
        controlDatabasePaths: [controlPath],
      })).toBe('control-database');
    }

    expect(conflict({
      ...common,
      controlDatabasePaths: [
        join(base, 'control', 'source.sqlite'),
        join(base, 'control', 'snapshot.sqlite'),
      ],
    })).toBeNull();
  });

  test('rejects reuse of the storage root and a Fabric root which contains storage', () => {
    const base = nonexistentBase('storage-root');
    const storageDir = join(base, 'application', 'storage');

    expect(conflict({
      rootDirectory: storageDir,
      outDir: join(base, 'build'),
      storageDir,
    })).toBe('storage-root');
    expect(conflict({
      rootDirectory: join(base, 'application'),
      outDir: join(base, 'build'),
      storageDir,
    })).toBe('storage-root');
  });

  test('rejects the storage adapter tmp and blobs namespaces', () => {
    const base = nonexistentBase('storage-owned');
    const storageDir = join(base, 'storage');
    const common = {
      outDir: join(base, 'build'),
      storageDir,
    };

    expect(conflict({
      ...common,
      rootDirectory: join(storageDir, 'tmp'),
    })).toBe('storage-temp');
    expect(conflict({
      ...common,
      rootDirectory: join(storageDir, 'tmp', 'databases'),
    })).toBe('storage-temp');
    expect(conflict({
      ...common,
      rootDirectory: join(storageDir, 'blobs'),
    })).toBe('storage-blobs');
    expect(conflict({
      ...common,
      rootDirectory: join(storageDir, 'blobs', 'databases'),
    })).toBe('storage-blobs');
  });

  test('allows a dedicated databases child within storageDir', () => {
    const base = nonexistentBase('storage-databases');

    expect(conflict({
      rootDirectory: join(base, 'storage', 'databases'),
      outDir: join(base, 'build'),
      storageDir: join(base, 'storage'),
      controlDatabasePaths: [join(base, 'control', 'control.sqlite')],
    })).toBeNull();
  });

  test('does not create filesystem state while performing lexical checks', () => {
    const base = nonexistentBase('read-only');
    const safeInput = {
      rootDirectory: join(base, 'storage', 'databases'),
      outDir: join(base, 'build'),
      storageDir: join(base, 'storage'),
      controlDatabasePaths: [join(base, 'control', 'control.sqlite')],
    };
    const conflictingInput = {
      ...safeInput,
      outDir: join(base, 'storage', 'databases', 'build'),
    };

    expect(existsSync(base)).toBe(false);
    expect(findDatabaseDirectoryConflict(safeInput)).toBeNull();
    expect(() => assertDatabaseDirectoryIsolation(safeInput)).not.toThrow();
    const error = captureDatabaseError(() => {
      assertDatabaseDirectoryIsolation(conflictingInput);
    });
    expect(error.message).toBe(
      '[app] databaseTopology.rootDirectory must not overlap outDir.',
    );
    expect(error).toMatchObject({
      code: 'DATABASE_CONFIG_INVALID',
      retryable: false,
      outcome: 'not-started',
      details: { component: 'database-directory-isolation' },
    });
    expect(existsSync(base)).toBe(false);
  });

  test('rejects initially-missing case-only aliases across every owned namespace', () => {
    const base = nonexistentBase('case-folding');

    expect(conflict({
      rootDirectory: join(base, 'Fabric'),
      outDir: join(base, 'fabric', 'build'),
      storageDir: join(base, 'storage'),
    })).toBe('build-output');
    expect(conflict({
      rootDirectory: join(base, 'Fabric'),
      outDir: join(base, 'build'),
      storageDir: join(base, 'storage'),
      controlDatabasePaths: [join(base, 'fabric', 'control.sqlite')],
    })).toBe('control-database');
    expect(conflict({
      rootDirectory: join(base, 'Storage', 'TMP', 'databases'),
      outDir: join(base, 'build'),
      storageDir: join(base, 'storage'),
    })).toBe('storage-temp');
    expect(conflict({
      rootDirectory: join(base, 'Storage', 'BLOBS', 'databases'),
      outDir: join(base, 'build'),
      storageDir: join(base, 'storage'),
    })).toBe('storage-blobs');
    expect(existsSync(base)).toBe(false);
  });
});

describe('control database path resolution', () => {
  test('returns no paths for ephemeral storage', () => {
    expect(resolveControlDatabasePaths({ mode: 'ephemeral' })).toEqual([]);
  });

  test('returns the effective file path for file storage', () => {
    expect(resolveControlDatabasePaths({
      mode: 'file',
      path: './control/application.sqlite',
    })).toEqual([
      './control/application.sqlite',
      './control/application.sqlite-wal',
      './control/application.sqlite-shm',
      './control/application.sqlite-journal',
    ]);
  });

  test('protects deterministic SQLite companion paths as control-owned', () => {
    const base = nonexistentBase('control-companions');
    const controlPath = join(base, 'control.sqlite');
    const controlDatabasePaths = resolveControlDatabasePaths({
      mode: 'file',
      path: controlPath,
    });

    for (const suffix of ['-wal', '-shm', '-journal']) {
      expect(conflict({
        rootDirectory: `${controlPath}${suffix}`,
        outDir: join(base, 'build'),
        storageDir: join(base, 'storage'),
        controlDatabasePaths,
      })).toBe('control-database');
    }
  });

  test('returns both the source and snapshot paths for hot storage', () => {
    expect(resolveControlDatabasePaths({
      mode: 'hot',
      path: './control/source.sqlite',
      snapshotPath: './control/snapshot.sqlite',
    })).toEqual([
      './control/source.sqlite',
      './control/source.sqlite-wal',
      './control/source.sqlite-shm',
      './control/source.sqlite-journal',
      './control/snapshot.sqlite',
      './control/snapshot.sqlite-wal',
      './control/snapshot.sqlite-shm',
      './control/snapshot.sqlite-journal',
    ]);
  });

  test('uses injected SQLite service paths instead of stale configuration', () => {
    expect(resolveControlDatabasePaths({
      mode: 'file',
      path: './stale/source.sqlite',
      snapshotPath: './stale/snapshot.sqlite',
      database: { injected: true },
      sqlite: {
        path: './actual/source.sqlite',
        snapshotPath: './actual/snapshot.sqlite',
      },
    })).toEqual([
      './actual/source.sqlite',
      './actual/source.sqlite-wal',
      './actual/source.sqlite-shm',
      './actual/source.sqlite-journal',
      './actual/snapshot.sqlite',
      './actual/snapshot.sqlite-wal',
      './actual/snapshot.sqlite-shm',
      './actual/snapshot.sqlite-journal',
    ]);
  });
});

describe('canonical database directory isolation', () => {
  test.skipIf(process.platform === 'win32')(
    'detects a build overlap hidden behind a Fabric root symlink',
    () => {
      const base = createTemporaryDirectory();
      const realRoot = join(base, 'real-fabric');
      const aliasRoot = join(base, 'aliases', 'fabric');
      mkdirSync(realRoot);
      mkdirSync(join(base, 'aliases'));
      symlinkSync(realRoot, aliasRoot, 'dir');
      const input = {
        rootDirectory: aliasRoot,
        outDir: join(realRoot, 'build'),
        storageDir: join(base, 'storage'),
      };

      expect(findDatabaseDirectoryConflict(input)).toBeNull();
      expect(() => assertCanonicalDatabaseDirectoryIsolation(input)).toThrow(
        '[app] databaseTopology.rootDirectory must not overlap outDir.',
      );
    },
  );

  test.skipIf(process.platform === 'win32')(
    'detects a control database overlap hidden behind a Fabric root symlink',
    () => {
      const base = createTemporaryDirectory();
      const realRoot = join(base, 'real-fabric');
      const aliasRoot = join(base, 'aliases', 'fabric');
      mkdirSync(realRoot);
      mkdirSync(join(base, 'aliases'));
      symlinkSync(realRoot, aliasRoot, 'dir');
      const input = {
        rootDirectory: aliasRoot,
        outDir: join(base, 'build'),
        storageDir: join(base, 'storage'),
        controlDatabasePaths: [join(realRoot, 'control.sqlite')],
      };

      expect(findDatabaseDirectoryConflict(input)).toBeNull();
      expect(() => assertCanonicalDatabaseDirectoryIsolation(input)).toThrow(
        '[app] databaseTopology.rootDirectory must not overlap a default/control database path.',
      );
    },
  );

  test.skipIf(process.platform === 'win32')(
    'detects a storage tmp overlap hidden behind a symlink',
    () => {
      const base = createTemporaryDirectory();
      const storageDir = join(base, 'storage');
      const aliasRoot = join(base, 'aliases', 'fabric');
      mkdirSync(join(storageDir, 'tmp'), { recursive: true });
      mkdirSync(join(base, 'aliases'));
      symlinkSync(join(storageDir, 'tmp'), aliasRoot, 'dir');
      const input = {
        rootDirectory: aliasRoot,
        outDir: join(base, 'build'),
        storageDir,
      };

      expect(findDatabaseDirectoryConflict(input)).toBeNull();
      expect(() => assertCanonicalDatabaseDirectoryIsolation(input)).toThrow(
        '[app] databaseTopology.rootDirectory must not overlap the object-storage temporary directory.',
      );
    },
  );
});

function conflict(input: DatabaseDirectoryIsolationInput) {
  return findDatabaseDirectoryConflict(input);
}

function nonexistentBase(label: string): string {
  return join(
    tmpdir(),
    `zero-directory-isolation-${label}-${crypto.randomUUID()}`,
  );
}

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'zero-directory-isolation-'));
  temporaryDirectories.push(directory);
  return directory;
}

function captureDatabaseError(operation: () => unknown): DatabaseError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    return error as DatabaseError;
  }
  throw new Error('Expected DatabaseError.');
}
