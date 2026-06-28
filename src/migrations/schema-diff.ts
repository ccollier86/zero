/**
 * schema-diff.ts
 *
 * Compares declared schema snapshots with inspected database snapshots.
 * This file emits findings only; SQL generation lives in migration-planner.ts.
 */

import { normalizeSql } from './schema-snapshot';
import type {
  SchemaDiffIssue,
  SchemaSnapshot,
  SchemaTableSnapshot,
} from './types';

/** Compare declared schema against actual SQLite schema. */
export function diffSchemaSnapshots(
  declared: SchemaSnapshot,
  actual: SchemaSnapshot,
): SchemaDiffIssue[] {
  const issues: SchemaDiffIssue[] = [];

  for (const tableName of Object.keys(declared.tables).sort()) {
    const expectedTable = declared.tables[tableName];
    const actualTable = actual.tables[tableName];

    if (!actualTable) {
      issues.push({
        kind: 'missing-table',
        severity: 'error',
        table: tableName,
        message: `Table "${tableName}" is declared but missing from the database.`,
        expected: tableName,
        actual: null,
        safety: 'safe',
      });
      continue;
    }

    compareTable(expectedTable, actualTable, issues);
  }

  for (const tableName of Object.keys(actual.tables).sort()) {
    if (declared.tables[tableName] || tableName.startsWith('_')) continue;
    issues.push({
      kind: 'extra-table',
      severity: 'warning',
      table: tableName,
      message: `Table "${tableName}" exists in the database but is not declared by the app schema.`,
      actual: tableName,
      safety: 'manual',
    });
  }

  return issues;
}

function compareTable(
  expected: SchemaTableSnapshot,
  actual: SchemaTableSnapshot,
  issues: SchemaDiffIssue[],
): void {
  if (actual.compositePrimaryKey.length > 1) {
    issues.push({
      kind: 'composite-primary-key',
      severity: 'error',
      table: actual.name,
      message: `Table "${actual.name}" has a composite primary key. Reactive sync tables need one string primary key plus optional natural identity.`,
      actual: actual.compositePrimaryKey,
      safety: 'manual',
    });
  }

  if (expected.primaryKey !== actual.primaryKey) {
    issues.push({
      kind: 'primary-key-mismatch',
      severity: 'error',
      table: expected.name,
      message: `Table "${expected.name}" primary key differs from the declared schema.`,
      expected: expected.primaryKey,
      actual: actual.primaryKey,
      safety: 'manual',
    });
  }

  for (const columnName of expected.columnOrder) {
    const expectedColumn = expected.columns[columnName];
    const actualColumn = actual.columns[columnName];

    if (!actualColumn) {
      issues.push({
        kind: 'missing-column',
        severity: 'error',
        table: expected.name,
        column: columnName,
        message: `Column "${expected.name}.${columnName}" is declared but missing from the database.`,
        expected: expectedColumn.definition,
        actual: null,
        safety: isSafeAddColumn(expectedColumn.definition) ? 'safe' : 'guarded',
      });
      continue;
    }

    if (normalizeSql(expectedColumn.definition) !== normalizeSql(actualColumn.definition)) {
      issues.push({
        kind: 'changed-column',
        severity: 'warning',
        table: expected.name,
        column: columnName,
        message: `Column "${expected.name}.${columnName}" definition differs from the declared schema.`,
        expected: expectedColumn.definition,
        actual: actualColumn.definition,
        safety: 'manual',
      });
    }
  }

  for (const columnName of actual.columnOrder) {
    if (expected.columns[columnName]) continue;
    issues.push({
      kind: 'extra-column',
      severity: 'warning',
      table: expected.name,
      column: columnName,
      message: `Column "${expected.name}.${columnName}" exists in the database but is not declared by the app schema.`,
      actual: actual.columns[columnName].definition,
      safety: 'destructive',
    });
  }

  if (expected.identity.join('\0') !== actual.identity.join('\0')) {
    const expectedIndex = expected.indexes[`idx_${expected.name}_identity`];
    const hasMatchingIndex = expectedIndex
      ? Object.values(actual.indexes).some((index) =>
          index.unique &&
          index.columns.join('\0') === expectedIndex.columns.join('\0')
        )
      : expected.identity.length === 0;

    issues.push({
      kind: hasMatchingIndex ? 'identity-mismatch' : 'missing-identity-index',
      severity: expected.identity.length > 0 ? 'error' : 'warning',
      table: expected.name,
      index: expectedIndex?.name,
      message: hasMatchingIndex
        ? `Table "${expected.name}" has an identity index with a non-standard name.`
        : `Table "${expected.name}" is missing its declared natural identity index.`,
      expected: expected.identity,
      actual: actual.identity,
      safety: hasMatchingIndex ? 'manual' : 'guarded',
    });
  }
}

function isSafeAddColumn(definition: string): boolean {
  if (/\bprimary\s+key\b/i.test(definition)) return false;
  if (/\bnot\s+null\b/i.test(definition) && !/\bdefault\b/i.test(definition)) return false;
  return true;
}
