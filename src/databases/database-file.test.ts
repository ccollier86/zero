import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import {
  DATABASE_ID_MAX_BYTES,
  DatabasePathError,
  countZeroManagedDatabaseFiles,
  createDatabaseRef,
  encodeDatabaseFileName,
  normalizeDatabaseId,
  normalizeDatabaseRef,
  prepareDatabaseFile,
  prepareDatabaseFileWithCreationAdmission,
  prepareDatabaseRoot,
  resolveDatabaseFile,
} from './database-file';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('database identifiers', () => {
  test('normalizes canonical Unicode without trimming or case folding', () => {
    const composed = normalizeDatabaseId('Caf\u00e9');
    const decomposed = normalizeDatabaseId('Cafe\u0301');

    expect(composed).toBe(decomposed);
    expect(normalizeDatabaseId('Tenant-A')).not.toBe(normalizeDatabaseId('tenant-a'));
  });

  test('rejects empty, padded, controlled, malformed, and oversized IDs', () => {
    for (const invalid of ['', ' tenant', 'tenant ', 'tenant\nname', '\ud800']) {
      expectDatabasePathError(
        () => normalizeDatabaseId(invalid),
        'DATABASE_ID_INVALID',
      );
    }

    expect(normalizeDatabaseId('a'.repeat(DATABASE_ID_MAX_BYTES))).toHaveLength(
      DATABASE_ID_MAX_BYTES,
    );
    expectDatabasePathError(
      () => normalizeDatabaseId('a'.repeat(DATABASE_ID_MAX_BYTES + 1)),
      'DATABASE_ID_INVALID',
    );
    expectDatabasePathError(
      () => normalizeDatabaseId('😀'.repeat(DATABASE_ID_MAX_BYTES / 4 + 1)),
      'DATABASE_ID_INVALID',
    );
  });

  test('uses a safe hint and full domain-separated digest for the filename', () => {
    const id = normalizeDatabaseId('../../Acme North/primary');
    const digest = createHash('sha256')
      .update('zero.database-id.v1\0', 'utf8')
      .update(id, 'utf8')
      .digest('hex');
    const fileName = encodeDatabaseFileName(id);

    expect(fileName).toBe(`db-acme-north-primary-${digest}.sqlite`);
    expect(fileName).toMatch(/^db-[a-z0-9-]+-[a-f0-9]{64}\.sqlite$/);
    expect(fileName).not.toContain('..');
    expect(fileName).not.toContain('/');
    expect(encodeDatabaseFileName('tenant')).not.toBe(encodeDatabaseFileName('Tenant'));
  });

  test('falls back to a non-authoritative hint for non-ASCII IDs', () => {
    expect(encodeDatabaseFileName('顧客-😀')).toMatch(
      /^db-opaque-[a-f0-9]{64}\.sqlite$/,
    );
  });

  test('derives a separate hint-free opaque reference for IPC and telemetry', () => {
    const reference = createDatabaseRef('Acme North/primary');

    expect(reference).toMatch(/^[0-9a-f]{64}$/);
    expect(reference).toBe(createDatabaseRef('Acme North/primary'));
    expect(reference).not.toBe(createDatabaseRef('acme north/primary'));
    expect(reference).not.toContain('acme');
    expect(normalizeDatabaseRef(reference)).toBe(reference);
    expectDatabasePathError(
      () => normalizeDatabaseRef(`db-${reference}`),
      'DATABASE_REF_INVALID',
    );
    expectDatabasePathError(
      () => normalizeDatabaseRef(reference.toUpperCase()),
      'DATABASE_REF_INVALID',
    );
  });
});

describe('database file resolution and preparation', () => {
  test('prepares a canonical private root without reserving an application file', () => {
    const base = createTemporaryDirectory();
    const root = join(base, 'nested', 'databases');
    const prepared = prepareDatabaseRoot(root);

    expect(prepared).toBe(realpathSync.native(root));
    expect(lstatSync(prepared).isDirectory()).toBe(true);
    expect(readdirSync(prepared)).toEqual([]);
    if (process.platform !== 'win32') {
      expect(lstatSync(prepared).mode & 0o777).toBe(0o700);
    }
  });

  test('resolves every opaque ID to a direct child of the configured root', () => {
    const base = createTemporaryDirectory();
    const root = join(base, 'databases');
    const resolved = resolveDatabaseFile(root, '../../outside\\tenant');

    expect(resolved.rootDirectory).toBe(root);
    expect(dirname(resolved.path)).toBe(root);
    expect(basename(resolved.path)).toBe(resolved.fileName);
    expect(resolved.fileName).not.toContain('outside\\tenant');
    expect(Object.isFrozen(resolved)).toBe(true);
  });

  test('creates a private root and atomically reserves a private file', () => {
    const base = createTemporaryDirectory();
    const root = join(base, 'nested', 'databases');
    const first = prepareDatabaseFile(root, 'tenant-123');
    const second = prepareDatabaseFile(root, 'tenant-123');

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.path).toBe(first.path);
    expect(lstatSync(first.rootDirectory).isDirectory()).toBe(true);
    expect(lstatSync(first.path).isFile()).toBe(true);
    expect(lstatSync(first.path).size).toBe(0);

    if (process.platform !== 'win32') {
      expect(lstatSync(first.rootDirectory).mode & 0o777).toBe(0o700);
      expect(lstatSync(first.path).mode & 0o777).toBe(0o600);
    }
  });

  test('runs creation admission only for an absent managed main file', () => {
    const base = createTemporaryDirectory();
    const root = join(base, 'databases');
    const existing = prepareDatabaseFile(root, 'existing');
    let admissions = 0;

    expect(prepareDatabaseFileWithCreationAdmission(
      root,
      'existing',
      () => {
        admissions += 1;
        throw new Error('must not run');
      },
    )).toMatchObject({ path: existing.path, created: false });
    expect(admissions).toBe(0);

    expect(() => prepareDatabaseFileWithCreationAdmission(
      root,
      'denied',
      () => {
        admissions += 1;
        throw new Error('denied');
      },
    )).toThrow('denied');
    expect(admissions).toBe(1);
    expect(() => lstatSync(resolveDatabaseFile(root, 'denied').path)).toThrow();

    const created = prepareDatabaseFileWithCreationAdmission(
      root,
      'created',
      () => { admissions += 1; },
    );
    expect(created.created).toBe(true);
    expect(admissions).toBe(2);

    let creationCharges = 0;
    expect(() => prepareDatabaseFileWithCreationAdmission(
      root,
      'charged-before-later-failure',
      () => { admissions += 1; },
      () => {
        creationCharges += 1;
        throw new Error('injected post-create failure');
      },
    )).toThrow('injected post-create failure');
    expect(creationCharges).toBe(1);
    expect(lstatSync(
      resolveDatabaseFile(root, 'charged-before-later-failure').path,
    ).isFile()).toBe(true);
  });

  test('counts only canonical regular Zero-managed main database files', () => {
    const base = createTemporaryDirectory();
    const root = join(base, 'databases');
    const first = prepareDatabaseFile(root, 'first');
    prepareDatabaseFile(root, 'second');

    writeFileSync(`${first.path}-wal`, 'sidecar');
    writeFileSync(`${first.path}-shm`, 'sidecar');
    writeFileSync(first.path.replace(/\.sqlite$/u, '.snapshot.sqlite'), 'snapshot');
    writeFileSync(join(root, 'application.sqlite'), 'unmanaged');
    writeFileSync(
      join(root, `db-invalid--hint-${'a'.repeat(64)}.sqlite`),
      'non-canonical',
    );
    mkdirSync(join(root, '.zero-internal'));
    writeFileSync(
      join(root, '.zero-internal', encodeDatabaseFileName('internal')),
      'internal',
    );
    const outside = join(base, 'outside.sqlite');
    writeFileSync(outside, 'outside');
    symlinkSync(
      outside,
      join(root, encodeDatabaseFileName('matching-symlink')),
      'file',
    );

    expect(countZeroManagedDatabaseFiles(root)).toBe(2);
  });

  test('repairs restrictive permissions on an existing regular database', () => {
    const base = createTemporaryDirectory();
    const location = resolveDatabaseFile(join(base, 'databases'), 'primary');
    mkdirSync(location.rootDirectory, { recursive: true });
    writeFileSync(location.path, 'existing');

    if (process.platform !== 'win32') {
      chmodSync(location.rootDirectory, 0o755);
      chmodSync(location.path, 0o644);
    }

    const prepared = prepareDatabaseFile(location.rootDirectory, location.id);
    expect(prepared.created).toBe(false);

    if (process.platform !== 'win32') {
      expect(lstatSync(prepared.rootDirectory).mode & 0o777).toBe(0o700);
      expect(lstatSync(prepared.path).mode & 0o777).toBe(0o600);
    }
  });

  test('refuses a symlink as the configured root itself', () => {
    const base = createTemporaryDirectory();
    const realRoot = join(base, 'real-root');
    const linkedRoot = join(base, 'linked-root');
    mkdirSync(realRoot);
    symlinkSync(realRoot, linkedRoot, 'dir');

    expectDatabasePathError(
      () => prepareDatabaseFile(linkedRoot, 'primary'),
      'DATABASE_PATH_SYMLINK',
    );
  });

  test('canonicalizes an existing ancestor alias before creating the root', () => {
    const base = createTemporaryDirectory();
    const realAncestor = join(base, 'real-ancestor');
    const linkedAncestor = join(base, 'linked-ancestor');
    mkdirSync(realAncestor);
    symlinkSync(realAncestor, linkedAncestor, 'dir');

    const prepared = prepareDatabaseFile(
      join(linkedAncestor, 'nested', 'databases'),
      'primary',
    );

    expect(prepared.rootDirectory).toBe(
      join(realpathSync.native(realAncestor), 'nested', 'databases'),
    );
    expect(dirname(prepared.path)).toBe(prepared.rootDirectory);
    expect(lstatSync(prepared.path).isFile()).toBe(true);
  });

  test('refuses a database-file symlink without modifying its target', () => {
    const base = createTemporaryDirectory();
    const root = join(base, 'databases');
    const outside = join(base, 'outside.sqlite');
    const location = resolveDatabaseFile(root, 'primary');
    mkdirSync(root, { recursive: true });
    writeFileSync(outside, 'outside');
    symlinkSync(outside, location.path, 'file');

    expectDatabasePathError(
      () => prepareDatabaseFile(root, location.id),
      'DATABASE_PATH_SYMLINK',
    );
    expect(readFileSync(outside, 'utf8')).toBe('outside');
  });

  test('refuses non-directory roots and non-regular database targets', () => {
    const base = createTemporaryDirectory();
    const fileRoot = join(base, 'not-a-directory');
    writeFileSync(fileRoot, 'file');
    expectDatabasePathError(
      () => prepareDatabaseFile(fileRoot, 'primary'),
      'DATABASE_PATH_TYPE',
    );

    const root = join(base, 'databases');
    const location = resolveDatabaseFile(root, 'primary');
    mkdirSync(location.path, { recursive: true });
    expectDatabasePathError(
      () => prepareDatabaseFile(root, location.id),
      'DATABASE_PATH_TYPE',
    );
  });

  test('rejects invalid and dangerously broad root paths', () => {
    expectDatabasePathError(
      () => resolveDatabaseFile('', 'primary'),
      'DATABASE_ROOT_INVALID',
    );
    expectDatabasePathError(
      () => resolveDatabaseFile('\0bad', 'primary'),
      'DATABASE_ROOT_INVALID',
    );
    expectDatabasePathError(
      () => resolveDatabaseFile('/', 'primary'),
      'DATABASE_ROOT_INVALID',
    );
  });
});

function createTemporaryDirectory(): string {
  // Canonicalizing the OS temp path avoids treating a platform-managed alias
  // such as macOS /var -> /private/var as part of the configured database root.
  const directory = realpathSync.native(mkdtempSync(join(tmpdir(), 'zero-database-file-')));
  temporaryDirectories.push(directory);
  return directory;
}

function expectDatabasePathError(
  operation: () => unknown,
  code: DatabasePathError['code'],
): void {
  try {
    operation();
    throw new Error(`Expected ${code}.`);
  } catch (error) {
    expect(error).toBeInstanceOf(DatabasePathError);
    expect((error as DatabasePathError).code).toBe(code);
  }
}
