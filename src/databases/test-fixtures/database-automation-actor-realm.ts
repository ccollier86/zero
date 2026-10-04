/** Subprocess Fabric realm used by the managed automation end-to-end proof. */

import {
  defineDatabaseAutomations,
} from '../../database-automations/database-automations';
import {
  defineDatabaseFunction,
} from '../../database-automations/database-function';
import {
  DATABASE_AUTOMATION_OUTBOX_TABLE,
} from '../../database-automations/automation-outbox-schema-sql';
import {
  defineDatabaseTrigger,
} from '../../database-automations/database-trigger';
import type {
  DatabaseTriggerFunctionInput,
} from '../../database-automations/database-trigger-input';
import type {
  DatabaseTransactionFunctionCapability,
} from '../../database-automations/database-transaction-function-capability';
import { defineDatabaseRealm } from '../database-realm';

interface FixtureAutomationServices {
  readonly scope: {
    readonly scopeKind: 'application' | 'tenant';
    readonly tenantId?: string;
  };
}

const createOrderRollup = defineDatabaseFunction<
  DatabaseTriggerFunctionInput,
  void,
  DatabaseTransactionFunctionCapability
>({
  name: 'orders.create-rollup',
  version: 1,
  mode: 'transaction',
  handler: ({ input, transaction }) => {
    transaction.createStrict('order_rollups', {
      rollup_id: `rollup-${input.change.rowId}`,
      order_id: input.change.rowId,
      source_sequence: input.change.sequence,
      state: 'committed',
    });
  },
});

const recordOrderDelivery = defineDatabaseFunction<
  DatabaseTriggerFunctionInput,
  void,
  FixtureAutomationServices
>({
  name: 'orders.record-delivery',
  version: 1,
  mode: 'durable',
  handler: async ({ input, invocation, zero }) => {
    const receiptPath = input.change.row?.receipt_path;
    if (typeof receiptPath !== 'string' || receiptPath.length === 0) {
      throw new Error('Automation proof receipt path is unavailable.');
    }
    await Bun.write(receiptPath, JSON.stringify({
      functionIdentity: invocation.functionIdentity,
      invocationId: invocation.invocationId,
      operation: input.change.operation,
      rowId: input.change.rowId,
      scopeKind: zero.scope.scopeKind,
    }));
  },
});

const orderCreated = defineDatabaseTrigger({
  name: 'orders.created',
  version: 1,
  table: 'orders',
  after: { insert: true },
  run: [createOrderRollup, recordOrderDelivery],
});

export const databaseAutomationActorFixtureRealm = defineDatabaseRealm({
  name: 'database-automation-actor-fixture',
  version: '1',
  tables: {
    orders: {
      order_id: 'text primary key',
      title: 'text not null',
      receipt_path: 'text not null',
    },
    order_rollups: {
      rollup_id: 'text primary key',
      order_id: 'text not null',
      source_sequence: 'integer not null',
      state: 'text not null',
    },
  },
  queries: {
    'automation.latestDelivery': ({ database }) => {
      return database.query(`
        SELECT status, attempt_count, source_row_id
        FROM ${DATABASE_AUTOMATION_OUTBOX_TABLE}
        ORDER BY insertion_ordinal DESC
        LIMIT 1
      `).get() as {
        status: string;
        attempt_count: number;
        source_row_id: string;
      } | null;
    },
  },
  automations: defineDatabaseAutomations({
    functions: [createOrderRollup, recordOrderDelivery],
    triggers: [orderCreated],
  }),
});
