import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import {
  AUTH_REQUEST_ADMISSION_FLOWS,
  defineAuthRequestAdmissionTables,
  defineCurrentAuthRequestAdmissionTables,
} from '../auth/auth-request-admission-schema';
import { createReactiveDB } from '../sync/reactive-db';
import { migrations } from './index';
import { Migrator } from './migrator';

describe('public-auth admission migrations', () => {
  test('keeps migration 012 as the immutable historical three-flow schema', () => {
    const migratedDb = new Database(':memory:');
    const legacyDb = new Database(':memory:');
    const legacyRuntime = createReactiveDB({ database: legacyDb });
    const migrator = new Migrator({
      database: migratedDb,
      dbPath: ':memory:',
      migrations,
      createBackups: false,
      log: () => {},
    });

    try {
      migrator.run('011');
      expect(migrator.run('012')).toEqual(['012']);
      defineAuthRequestAdmissionTables(legacyRuntime);
      expect(tableShape(migratedDb)).toEqual(tableShape(legacyDb));

      const sql = tableSql(migratedDb);
      expect(sql).toContain("'bootstrap', 'registration', 'login'");
      expect(sql).not.toContain("'invitation'");
      expect(() => insertAdmission(migratedDb, 'legacy-invitation', 'invitation'))
        .toThrow('CHECK constraint failed');

      migrations.find((entry) => entry.version === '012')!.up(migratedDb);
      expect(tableShape(migratedDb)).toEqual(tableShape(legacyDb));
    } finally {
      legacyRuntime.dispose();
      migrator.dispose();
      legacyDb.close();
      migratedDb.close();
    }
  });

  test('migration 022 preserves legacy rows and converges idempotently on runtime schema', () => {
    const migratedDb = new Database(':memory:');
    const runtimeDb = new Database(':memory:');
    const runtime = createReactiveDB({ database: runtimeDb });
    const migration012 = migrations.find((entry) => entry.version === '012')!;
    const migration022 = migrations.find((entry) => entry.version === '022')!;

    try {
      migration012.up(migratedDb);
      insertAdmission(migratedDb, 'adm-bootstrap', 'bootstrap', 'source-a', null, 11);
      insertAdmission(migratedDb, 'adm-registration', 'registration', null, 'subject-b', 12);
      insertAdmission(migratedDb, 'adm-login', 'login', 'source-c', 'subject-c', 13);

      migration022.up(migratedDb);
      migration022.up(migratedDb);
      defineCurrentAuthRequestAdmissionTables(runtime);

      expect(migratedDb.query(`SELECT * FROM _auth_request_admissions
        WHERE admission_id LIKE 'adm-%' ORDER BY created_at`).all()).toEqual([
        {
          admission_id: 'adm-bootstrap',
          flow: 'bootstrap',
          source_hash: 'source-a',
          subject_hash: null,
          created_at: 11,
        },
        {
          admission_id: 'adm-registration',
          flow: 'registration',
          source_hash: null,
          subject_hash: 'subject-b',
          created_at: 12,
        },
        {
          admission_id: 'adm-login',
          flow: 'login',
          source_hash: 'source-c',
          subject_hash: 'subject-c',
          created_at: 13,
        },
      ]);
      expect(tableShape(migratedDb)).toEqual(tableShape(runtimeDb));

      for (const [index, flow] of AUTH_REQUEST_ADMISSION_FLOWS.entries()) {
        expect(() => insertAdmission(
          migratedDb,
          `current-${flow}`,
          flow,
          null,
          null,
          100 + index,
        )).not.toThrow();
      }
      expect(() => insertAdmission(migratedDb, 'unknown', 'unknown'))
        .toThrow('CHECK constraint failed');
    } finally {
      runtime.dispose();
      runtimeDb.close();
      migratedDb.close();
    }
  });

  test('a clean 001 through 022 migration run has exact current runtime parity', () => {
    const migratedDb = new Database(':memory:');
    const runtimeDb = new Database(':memory:');
    const runtime = createReactiveDB({ database: runtimeDb });
    const migrator = new Migrator({
      database: migratedDb,
      dbPath: ':memory:',
      migrations,
      createBackups: false,
      log: () => {},
    });

    try {
      expect(migrator.run()).toEqual(migrations.map((entry) => entry.version));
      expect(migrator.run()).toEqual([]);
      defineCurrentAuthRequestAdmissionTables(runtime);
      expect(tableShape(migratedDb)).toEqual(tableShape(runtimeDb));
      expect(tableSql(migratedDb)).toContain("'domain-onboarding'");
    } finally {
      runtime.dispose();
      migrator.dispose();
      runtimeDb.close();
      migratedDb.close();
    }
  });
});

function insertAdmission(
  db: Database,
  admissionId: string,
  flow: string,
  sourceHash: string | null = null,
  subjectHash: string | null = null,
  createdAt = 1,
): void {
  db.query(`INSERT INTO _auth_request_admissions (
    admission_id, flow, source_hash, subject_hash, created_at
  ) VALUES (?, ?, ?, ?, ?)`).run(
    admissionId,
    flow,
    sourceHash,
    subjectHash,
    createdAt,
  );
}

function tableSql(db: Database): string {
  return (db.query(`SELECT sql FROM sqlite_master
    WHERE type = 'table' AND name = '_auth_request_admissions'`).get() as {
    sql: string;
  }).sql;
}

function tableShape(db: Database) {
  return {
    sql: normalizeSql(tableSql(db)),
    columns: db.query('PRAGMA table_info(_auth_request_admissions)').all(),
    indexes: (db.query(`SELECT name, sql FROM sqlite_master
      WHERE type = 'index' AND tbl_name = '_auth_request_admissions'
        AND sql IS NOT NULL`).all() as Array<{ name: string; sql: string }>).map((index) => ({
      name: index.name,
      sql: normalizeSql(index.sql),
      columns: db.query(`PRAGMA index_info(${index.name})`).all(),
    })).sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function normalizeSql(sql: string): string {
  return sql.toLowerCase().replace(/\s+/g, '');
}
