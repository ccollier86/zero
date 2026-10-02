import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { migration as workflowGraphRuntime030 } from './definitions/030_workflow_graph_runtime';
import { hashMigration } from './schema-snapshot';

const EXPECTED_LEDGER_HASH = '8d76aaeb1f040f06c4bfa9bfc3bf61859bb398d9aefa2fdf93d0583a3f27f9d0';

const FROZEN_HELPERS = new Map([
  ['030_workflow_definition_canonical.ts', '142d5e5532efbb7bafccce4038dc83acb28db461d007b3062a806db0fd60ad13'],
  ['030_workflow_graph_schema.ts', '99b52744060398a5152e402a505980a95ab869a9fc18bbff0521bd83c30d388c'],
  ['030_workflow_runtime_schema.ts', '7d5fcea4007cdd8f4a20295ecec5c06a81ad408c2bcd49ba17b6a0709d558219'],
]);

describe('workflow migration 030 immutability', () => {
  test('keeps the released ledger checksum byte-for-byte compatible', () => {
    expect(hashMigration(workflowGraphRuntime030)).toBe(EXPECTED_LEDGER_HASH);
  });

  test('pins migration-local helper bytes so runtime evolution cannot rewrite history', () => {
    for (const [file, expected] of FROZEN_HELPERS) {
      const bytes = readFileSync(new URL(`./definitions/${file}`, import.meta.url));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(expected);
    }
  });
});
