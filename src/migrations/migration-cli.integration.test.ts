/** Process-level contracts for migration CLI database-plane targeting. */

import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RUNNER = join(import.meta.dir, 'run.ts');
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('migration CLI plane boundary', () => {
  test('uses SYSTEM_DB_PATH and ignores the legacy generic DATABASE_PATH', () => {
    const root = scratchRoot();
    const systemPath = join(root, 'zero.system.db');
    const legacyPath = join(root, 'legacy-app.db');
    const result = runCli(['--status'], {
      SYSTEM_DB_PATH: systemPath,
      DATABASE_PATH: legacyPath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`System database: ${systemPath} (SYSTEM_DB_PATH)`);
    expect(existsSync(systemPath)).toBe(true);
    expect(existsSync(legacyPath)).toBe(false);
  });

  test('schema plan and doctor never install platform ledger tables in the app DB', () => {
    const root = scratchRoot();
    const appPath = join(root, 'app.db');
    const schemaPath = join(root, 'schema.ts');
    writeFileSync(schemaPath, `export const tables = {
      todos: { id: 'text primary key', title: 'text not null' },
    };\n`);
    const database = new Database(appPath);
    database.exec('CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL)');
    database.close();

    const plan = runCli(['--plan', '--schema', schemaPath, '--db', appPath]);
    const doctor = runCli(['--doctor', '--schema', schemaPath, '--db', appPath]);

    expect(plan.exitCode).toBe(0);
    expect(doctor.exitCode).toBe(0);
    expect(plan.stdout).toContain(`Application schema database: ${appPath} (--db)`);
    expect(doctor.stdout).toContain('Application Schema Doctor');
    const inspected = new Database(appPath, { readonly: true });
    try {
      expect(inspected.query(`SELECT name FROM sqlite_master
        WHERE name IN ('_zero_migrations', '_zero_schema_history',
          '_zero_migration_artifacts')`).all()).toEqual([]);
    } finally {
      inspected.close();
    }
  });

  test('schema inspection fails closed without an explicit app database', () => {
    const root = scratchRoot();
    const schemaPath = join(root, 'schema.ts');
    const systemPath = join(root, 'zero.system.db');
    writeFileSync(schemaPath, 'export const tables = {};\n');

    const result = runCli(['--plan', '--schema', schemaPath], {
      SYSTEM_DB_PATH: systemPath,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('requires --db <application-db>');
    expect(existsSync(systemPath)).toBe(false);
  });

  test('schema inspection never creates a missing explicit application database', () => {
    const root = scratchRoot();
    const schemaPath = join(root, 'schema.ts');
    const missingAppPath = join(root, 'missing-app.db');
    writeFileSync(schemaPath, 'export const tables = {};\n');

    const result = runCli(['--doctor', '--schema', schemaPath, '--db', missingAppPath]);

    expect(result.exitCode).toBe(1);
    expect(existsSync(missingAppPath)).toBe(false);
  });

  test('rejects a migration target combined with an inspection or status mode', () => {
    const root = scratchRoot();
    const systemPath = join(root, 'zero.system.db');

    const result = runCli(['--status', '--to', '030', '--db', systemPath]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('--to is supported only');
    expect(existsSync(systemPath)).toBe(false);
  });
});

function scratchRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'zero-migration-cli-'));
  roots.push(root);
  return root;
}

function runCli(
  args: readonly string[],
  env: Record<string, string> = {},
): { exitCode: number; stdout: string; stderr: string } {
  const processResult = Bun.spawnSync([process.execPath, RUNNER, ...args], {
    cwd: join(import.meta.dir, '../..'),
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    exitCode: processResult.exitCode,
    stdout: processResult.stdout.toString(),
    stderr: processResult.stderr.toString(),
  };
}
