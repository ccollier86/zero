import { describe, expect, test } from 'bun:test';

import {
  defineDatabaseAutomations,
} from '../database-automations/database-automations';
import {
  defineDatabaseFunction,
  type DatabaseFunctionDefinition,
} from '../database-automations/database-function';
import { defineDatabaseTrigger } from '../database-automations/database-trigger';
import type { TableSchema } from '../sync/types';
import { DatabaseError } from './database-error';
import { composeDatabaseRealm } from './database-realm-composition';
import { databaseRealmContribution } from './database-realm-contribution';
import {
  DATABASE_REALM_FINGERPRINT_VERSION,
  createDatabaseRealmOperationCatalog,
  defineDatabaseRealm,
} from './database-realm';

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

function orderTrigger(
  functions: readonly DatabaseFunctionDefinition[] = [rollup, notify],
  columns = ['status'] as readonly string[],
) {
  return defineDatabaseTrigger({
    name: 'orders.changed',
    version: 1,
    table: 'orders',
    after: { insert: true, update: { columns } },
    run: functions,
  });
}

function orderTables(): Record<string, TableSchema> {
  return {
    orders: {
      id: 'text primary key',
      status: 'text not null',
      total: 'integer not null',
      _identity: ['status'],
    },
  };
}

function expectConfigInvalid(operation: () => unknown, fragment: string): string {
  try {
    operation();
    throw new Error('Expected database realm admission to fail.');
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as DatabaseError).code).toBe('DATABASE_CONFIG_INVALID');
    expect((error as DatabaseError).message).toContain(fragment);
    return (error as DatabaseError).message;
  }
}

describe('database realm automation admission', () => {
  test('admits actor-local handlers and fingerprints handler-free metadata', () => {
    const automations = defineDatabaseAutomations({
      functions: [notify, rollup],
      triggers: [orderTrigger()],
    });
    const realm = defineDatabaseRealm({
      name: 'automated-orders',
      version: '1',
      tables: orderTables(),
      automations,
    });

    expect(DATABASE_REALM_FINGERPRINT_VERSION).toBe(2);
    expect(realm.automations).not.toBe(automations);
    expect(realm.automations?.listFunctions()).toEqual([notify, rollup]);
    expect(realm.automations?.listTriggers()).toHaveLength(1);
    expect(realm.automations?.manifestJson).not.toContain('handler');
    expect(realm.automations?.getFunction(rollup.identity)?.handler).toBe(rollup.handler);
    expect(realm.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(Object.isFrozen(realm.automations)).toBe(true);
    expect(createDatabaseRealmOperationCatalog(realm)).toEqual({
      tables: ['orders'],
      queries: [],
      commands: [],
      columns: {
        orders: ['id', 'status', 'total'],
      },
      primaryKeys: { orders: 'id' },
    });
  });

  test('canonicalizes execution order consistently with the realm fingerprint', () => {
    const first = defineDatabaseRealm({
      name: 'canonical-automations',
      version: '1',
      tables: orderTables(),
      automations: defineDatabaseAutomations({
        functions: [rollup, notify],
        triggers: [defineDatabaseTrigger({
          name: 'orders.zeta',
          version: 1,
          table: 'orders',
          after: { insert: true },
          run: rollup,
        }), defineDatabaseTrigger({
          name: 'orders.alpha',
          version: 1,
          table: 'orders',
          after: { insert: true },
          run: notify,
        })],
      }),
    });
    const second = defineDatabaseRealm({
      name: 'canonical-automations',
      version: '1',
      tables: orderTables(),
      automations: defineDatabaseAutomations({
        functions: [notify, rollup],
        triggers: [...first.automations!.listTriggers()].reverse(),
      }),
    });

    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.automations?.listFunctions().map(({ identity }) => identity))
      .toEqual(first.automations?.listFunctions().map(({ identity }) => identity));
    expect(second.automations?.listTriggers().map(({ identity }) => identity))
      .toEqual(first.automations?.listTriggers().map(({ identity }) => identity));
  });

  test('fails closed for missing trigger tables and unknown UPDATE columns', () => {
    expectConfigInvalid(() => defineDatabaseRealm({
      name: 'missing-trigger-table',
      version: '1',
      tables: { records: { id: 'text primary key' } },
      automations: defineDatabaseAutomations({
        functions: [rollup],
        triggers: [orderTrigger([rollup])],
      }),
    }), 'outside the admitted realm');

    expectConfigInvalid(() => defineDatabaseRealm({
      name: 'missing-trigger-column',
      version: '1',
      tables: orderTables(),
      automations: defineDatabaseAutomations({
        functions: [rollup, notify],
        triggers: [orderTrigger([rollup, notify], ['missing_column'])],
      }),
    }), 'invalid admitted table column');

    expectConfigInvalid(() => defineDatabaseRealm({
      name: 'metadata-trigger-column',
      version: '1',
      tables: orderTables(),
      automations: defineDatabaseAutomations({
        functions: [rollup, notify],
        triggers: [orderTrigger([rollup, notify], ['_identity'])],
      }),
    }), 'invalid admitted table column');
  });

  test('keeps omitted automation configuration backward compatible', () => {
    const realm = defineDatabaseRealm({
      name: 'plain-realm',
      version: '1',
      tables: { records: { id: 'text primary key' } },
    });

    expect(realm.automations).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(realm, 'automations')).toBe(false);
    expectConfigInvalid(() => defineDatabaseRealm({
      name: 'invalid-registry',
      version: '1',
      tables: { records: { id: 'text primary key' } },
      automations: {} as never,
    }), 'DatabaseAutomationRegistry');
  });

  test('changes the realm fingerprint when automation metadata changes', () => {
    const base = defineDatabaseRealm({
      name: 'automation-fingerprint',
      version: '1',
      tables: orderTables(),
      automations: defineDatabaseAutomations({
        functions: [rollup, notify],
        triggers: [orderTrigger()],
      }),
    });
    const changed = defineDatabaseRealm({
      name: 'automation-fingerprint',
      version: '1',
      tables: orderTables(),
      automations: defineDatabaseAutomations({
        functions: [rollup, notify],
        triggers: [defineDatabaseTrigger({
          name: 'orders.changed',
          version: 2,
          table: 'orders',
          after: { insert: true, delete: true },
          run: [rollup, notify],
        })],
      }),
    });

    expect(changed.fingerprint).not.toBe(base.fingerprint);
  });

  test('composes contribution automations independent of input order', () => {
    const schema = {
      name: 'schema',
      version: '1',
      tables: orderTables(),
    };
    const automation = {
      name: 'automation',
      version: '1',
      automations: defineDatabaseAutomations({
        functions: [rollup, notify],
        triggers: [orderTrigger()],
      }),
    };
    const first = composeDatabaseRealm({
      name: 'composed-automations',
      version: '1',
      contributions: [schema, automation],
    });
    const second = composeDatabaseRealm({
      name: 'composed-automations',
      version: '1',
      contributions: [automation, schema],
    });

    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.automations?.fingerprint).toBe(first.automations?.fingerprint);
    expect(second.automations?.listTriggers()[0]?.table).toBe('orders');
  });

  test('rejects contribution automation collisions deterministically', () => {
    const one = {
      name: 'one',
      version: '1',
      automations: defineDatabaseAutomations({ functions: [rollup] }),
    };
    const two = {
      name: 'two',
      version: '1',
      automations: defineDatabaseAutomations({ functions: [rollup] }),
    };
    const forward = expectConfigInvalid(() => composeDatabaseRealm({
      name: 'collision',
      version: '1',
      contributions: [one, two],
    }), 'function identities must be unique');
    const reverse = expectConfigInvalid(() => composeDatabaseRealm({
      name: 'collision',
      version: '1',
      contributions: [two, one],
    }), 'function identities must be unique');

    expect(reverse).toBe(forward);
  });

  test('preserves automations when adapting an admitted realm', () => {
    const base = defineDatabaseRealm({
      name: 'automation-base',
      version: '1',
      tables: orderTables(),
      automations: defineDatabaseAutomations({
        functions: [rollup, notify],
        triggers: [orderTrigger()],
      }),
    });
    const composed = composeDatabaseRealm({
      name: 'adapted-automation-base',
      version: '1',
      contributions: [databaseRealmContribution(base)],
    });

    expect(composed.automations?.fingerprint).toBe(base.automations?.fingerprint);
    expect(composed.automations?.getFunction(notify.identity)?.handler).toBe(notify.handler);
  });
});
