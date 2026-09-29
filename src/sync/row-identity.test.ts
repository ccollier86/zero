import { describe, expect, test } from 'bun:test';

import {
  canonicalDatabaseRowId,
  databaseColumnDefinitionAffinity,
  databaseColumnDefinitionDeclaresDefault,
  databaseColumnDefinitionDeclaresNotNull,
  databaseColumnDefinitionDeclaresPrimaryKey,
  databaseDeclaredTypeAffinity,
  isSupportedDatabaseRowIdentityAffinity,
  isIsolatedDatabaseColumnDefinition,
  REACTIVE_DB_ROW_ID_MAX_BYTES,
} from './row-identity';

describe('database row identity', () => {
  test('canonicalizes strings and safe integer keys to one string shape', () => {
    expect(canonicalDatabaseRowId('tenant-row')).toBe('tenant-row');
    expect(canonicalDatabaseRowId(0)).toBe('0');
    expect(canonicalDatabaseRowId(-12)).toBe('-12');
    expect(canonicalDatabaseRowId(Number.MAX_SAFE_INTEGER))
      .toBe(String(Number.MAX_SAFE_INTEGER));
  });

  test('rejects values outside the bounded actor and Sync row-id contract', () => {
    expect(canonicalDatabaseRowId('')).toBeNull();
    expect(canonicalDatabaseRowId('unsafe\nrow')).toBeNull();
    expect(canonicalDatabaseRowId('\ud800')).toBeNull();
    expect(canonicalDatabaseRowId('x'.repeat(
      REACTIVE_DB_ROW_ID_MAX_BYTES + 1,
    ))).toBeNull();
    expect(canonicalDatabaseRowId(1.5)).toBeNull();
    expect(canonicalDatabaseRowId(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
    expect(canonicalDatabaseRowId(Number.NaN)).toBeNull();
    expect(canonicalDatabaseRowId(1n)).toBeNull();
    expect(canonicalDatabaseRowId({ id: 'object' })).toBeNull();
    expect(canonicalDatabaseRowId(true)).toBeNull();
    expect(canonicalDatabaseRowId(null)).toBeNull();
  });

  test('uses SQLite affinity precedence for complete column definitions', () => {
    expect(databaseColumnDefinitionAffinity('text primary key')).toBe('TEXT');
    expect(databaseColumnDefinitionAffinity('varchar(128) primary key'))
      .toBe('TEXT');
    expect(databaseColumnDefinitionAffinity('integer primary key autoincrement'))
      .toBe('INTEGER');
    expect(databaseColumnDefinitionAffinity('unsigned big int primary key'))
      .toBe('INTEGER');
    expect(databaseColumnDefinitionAffinity(
      "text default 'REAL PRIMARY KEY' /* BLOB */ primary key",
    )).toBe('TEXT');
    expect(databaseColumnDefinitionAffinity('"TEXT" collate nocase primary key'))
      .toBe('TEXT');
    expect(databaseColumnDefinitionAffinity('"REAL" text primary key'))
      .toBe('REAL');
    expect(databaseColumnDefinitionAffinity("'BLOB' integer primary key"))
      .toBe('BLOB');

    // SQLite checks INT before REAL, so this intentionally has INTEGER affinity.
    expect(databaseDeclaredTypeAffinity('FLOATING POINT')).toBe('INTEGER');
  });

  test('classifies unsupported primary-key affinities and typeless columns', () => {
    const unsupported = [
      ['real primary key', 'REAL'],
      ['double primary key', 'REAL'],
      ['blob primary key', 'BLOB'],
      ['numeric primary key', 'NUMERIC'],
      ['decimal(10, 2) primary key', 'NUMERIC'],
      ['"ıNT" primary key', 'NUMERIC'],
      ['primary key', 'TYPELESS'],
    ] as const;

    for (const [definition, affinity] of unsupported) {
      const resolved = databaseColumnDefinitionAffinity(definition);
      expect(resolved).toBe(affinity);
      expect(isSupportedDatabaseRowIdentityAffinity(resolved)).toBe(false);
    }
    expect(isSupportedDatabaseRowIdentityAffinity(
      databaseColumnDefinitionAffinity('text primary key'),
    )).toBe(true);
    expect(isSupportedDatabaseRowIdentityAffinity(
      databaseColumnDefinitionAffinity('integer primary key'),
    )).toBe(true);
  });

  test('keeps each generated schema value inside one column slot', () => {
    expect(isIsolatedDatabaseColumnDefinition(
      'decimal(10, 2) check (value in (1, 2, 3))',
    )).toBe(true);
    expect(isIsolatedDatabaseColumnDefinition(
      "text default 'comma, semicolon; primary key' /* safe, comment */",
    )).toBe(true);
    expect(isIsolatedDatabaseColumnDefinition(
      'text unique, primary key (id, other)',
    )).toBe(false);
    expect(isIsolatedDatabaseColumnDefinition('text; drop table records'))
      .toBe(false);
    expect(isIsolatedDatabaseColumnDefinition('text check ((value > 0)'))
      .toBe(false);
    expect(isIsolatedDatabaseColumnDefinition('text -- unterminated slot comment'))
      .toBe(false);
    for (const definition of [
      '"REAL" text primary key',
      '`REAL` text primary key',
      "'REAL' text primary key",
      '[REAL] text primary key',
      'text "REAL" primary key',
    ]) {
      expect(isIsolatedDatabaseColumnDefinition(definition)).toBe(false);
    }
    expect(isIsolatedDatabaseColumnDefinition('"TEXT" primary key')).toBe(true);
    expect(isIsolatedDatabaseColumnDefinition(
      "text default 'quoted value' primary key",
    )).toBe(true);
  });

  test('recognizes only unquoted top-level column constraints', () => {
    expect(databaseColumnDefinitionDeclaresPrimaryKey(
      "text default 'primary key' /* PRIMARY KEY */",
    )).toBe(false);
    expect(databaseColumnDefinitionDeclaresPrimaryKey(
      "text check (value <> 'PRIMARY KEY') primary key",
    )).toBe(true);
    expect(databaseColumnDefinitionDeclaresPrimaryKey(
      'text unique, primary key (id, other)',
    )).toBe(false);
    expect(databaseColumnDefinitionDeclaresNotNull(
      "text default 'not null' check (value is not null)",
    )).toBe(false);
    expect(databaseColumnDefinitionDeclaresNotNull('text not null')).toBe(true);
    expect(databaseColumnDefinitionDeclaresNotNull(
      'text, injected text not null',
    )).toBe(false);
    expect(databaseColumnDefinitionDeclaresPrimaryKey(
      'text unique-- SQLite keeps CR inside the comment\rprimary key\n',
    )).toBe(false);
    expect(databaseColumnDefinitionDeclaresNotNull(
      'text-- SQLite keeps CR inside the comment\rnot null\n',
    )).toBe(false);
    expect(databaseColumnDefinitionDeclaresPrimaryKey(
      'text\u00a0primary key unique',
    )).toBe(false);
    expect(databaseColumnDefinitionDeclaresPrimaryKey(
      'textéprimary key unique',
    )).toBe(false);
    expect(databaseColumnDefinitionDeclaresPrimaryKey(
      'text prımary key unique',
    )).toBe(false);
    expect(databaseColumnDefinitionDeclaresNotNull('text not\u2028null'))
      .toBe(false);
    expect(databaseColumnDefinitionDeclaresPrimaryKey(
      'text \ufeff primary key',
    )).toBe(true);
    expect(databaseColumnDefinitionDeclaresPrimaryKey(
      'text\ufeffprimary key',
    )).toBe(false);
    expect(databaseColumnDefinitionDeclaresDefault(
      "text check (value <> 'default')",
    )).toBe(false);
    expect(databaseColumnDefinitionDeclaresDefault(
      "text not/**/null default 'ready'",
    )).toBe(true);
    expect(databaseColumnDefinitionDeclaresDefault(
      'text, injected text default 1',
    )).toBe(false);
    expect(databaseColumnDefinitionDeclaresDefault(
      'text references parent(id) on delete set/**/default',
    )).toBe(false);
    expect(databaseColumnDefinitionDeclaresDefault(
      'text references parent(id) on update set default default/**/null',
    )).toBe(true);
  });
});
