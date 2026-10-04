import { describe, expect, test } from 'bun:test';

import { AutomationError } from './automation-error';
import { defineDatabaseFunction } from './database-function';
import { defineDatabaseTrigger } from './database-trigger';
import { defineDatabaseAutomations } from './database-automations';

const rollup = defineDatabaseFunction({
  name: 'orders.rollup',
  version: 1,
  mode: 'transaction',
  handler: () => undefined,
});
const notify = defineDatabaseFunction({
  name: 'orders.notify',
  version: 1,
  mode: 'durable',
  handler: async () => undefined,
});
const changed = defineDatabaseTrigger({
  name: 'orders.changed',
  version: 1,
  table: 'orders',
  after: { insert: true, update: { columns: ['status'] } },
  run: [rollup, notify],
});

describe('database automation registry', () => {
  test('resolves ordered functions and emits handler-free canonical metadata', () => {
    const registry = defineDatabaseAutomations({
      functions: [notify, rollup],
      triggers: [changed],
      validation: {
        tableExists: (table) => table === 'orders',
        tableColumns: () => ['id', 'status'],
      },
    });

    expect(registry.resolveTriggerFunctions(changed)).toEqual([rollup, notify]);
    expect(registry.manifest.functions.map(({ identity }) => identity)).toEqual([
      'function:orders.notify@1',
      'function:orders.rollup@1',
    ]);
    expect(registry.manifest.triggers[0]?.run.map(({ identity }) => identity)).toEqual([
      'function:orders.rollup@1',
      'function:orders.notify@1',
    ]);
    expect(registry.manifestJson).not.toContain('handler');
    expect(registry.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test('keeps fingerprints independent of registry ordering but sensitive to run order', () => {
    const first = defineDatabaseAutomations({ functions: [rollup, notify], triggers: [changed] });
    const reorderedDefinitions = defineDatabaseAutomations({
      functions: [notify, rollup],
      triggers: [changed],
    });
    const reversedRun = defineDatabaseTrigger({
      name: changed.name,
      version: changed.version,
      table: changed.table,
      after: { insert: true, update: { columns: ['status'] } },
      run: [notify, rollup],
    });
    const changedBehavior = defineDatabaseAutomations({
      functions: [rollup, notify],
      triggers: [reversedRun],
    });

    expect(first.fingerprint).toBe(reorderedDefinitions.fingerprint);
    expect(first.fingerprint).not.toBe(changedBehavior.fingerprint);
  });

  test('composes registries while preserving source order', () => {
    const base = defineDatabaseAutomations({ functions: [rollup] });
    const registry = defineDatabaseAutomations({
      include: [base],
      functions: [notify],
      triggers: [changed],
    });

    expect(registry.listFunctions()).toEqual([rollup, notify]);
    expect(registry.match({
      table: 'orders',
      operation: 'insert',
      row: { id: 'one' },
    })).toEqual([changed]);
  });

  test('fails closed on duplicate identities and unresolved targets', () => {
    expectRegistryError(
      () => defineDatabaseAutomations({ functions: [rollup, rollup] }),
      'AUTOMATION_FUNCTION_DUPLICATE',
    );
    expectRegistryError(
      () => defineDatabaseAutomations({ functions: [rollup], triggers: [changed, changed] }),
      'AUTOMATION_TRIGGER_DUPLICATE',
    );
    expectRegistryError(
      () => defineDatabaseAutomations({ functions: [rollup], triggers: [changed] }),
      'AUTOMATION_TARGET_MISSING',
    );
  });

  test('uses table hooks for missing tables and filtered columns', () => {
    expectRegistryError(
      () => defineDatabaseAutomations({
        functions: [rollup, notify],
        triggers: [changed],
        validation: { tableExists: () => false },
      }),
      'AUTOMATION_TABLE_MISSING',
    );
    expectRegistryError(
      () => defineDatabaseAutomations({
        functions: [rollup, notify],
        triggers: [changed],
        validation: { tableColumns: () => ['id'] },
      }),
      'AUTOMATION_TABLE_INVALID',
    );
    try {
      defineDatabaseAutomations({
        functions: [rollup, notify],
        triggers: [changed],
        validation: { tableExists: () => { throw new Error('private hook detail'); } },
      });
      throw new Error('Expected registry construction to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(AutomationError);
      expect((error as AutomationError).code).toBe('AUTOMATION_TABLE_INVALID');
      expect((error as AutomationError).message).not.toContain('private hook detail');
    }
  });
});

function expectRegistryError(
  callback: () => unknown,
  code: AutomationError['code'],
): void {
  try {
    callback();
    throw new Error('Expected registry construction to fail.');
  } catch (error) {
    expect(error).toBeInstanceOf(AutomationError);
    expect((error as AutomationError).code).toBe(code);
    expect((error as AutomationError).retryable).toBe(false);
  }
}
