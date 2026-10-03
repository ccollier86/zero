import { describe, expect, test } from 'bun:test';

import type {
  AsyncDatabaseClient,
  DatabaseMutationOptions,
  DatabaseSerializableValue,
} from '../databases/database-operations';
import type { DataStudioSchema } from './data-studio-contracts';
import { DataStudioError } from './data-studio-error';
import { DataStudioService } from './data-studio-service';

const SCHEMA: DataStudioSchema = Object.freeze({
  version: 1,
  columns: Object.freeze([Object.freeze({
    columnId: 'col_name',
    key: 'name',
    label: 'Name',
    type: 'text',
    required: true,
  })]),
});

describe('DataStudioService boundary', () => {
  test('derives stable actor-scoped entity ids and receipt keys', async () => {
    const calls: CommandCall[] = [];
    const data = recordingClient(calls);
    const first = service(data, 'user_one', 'membership_one');

    const created = await first.createTable({ name: 'Patient Notes', schema: SCHEMA }, {
      operationId: 'create-patient-notes',
    });
    const replay = await first.createTable({ name: 'Patient Notes', schema: SCHEMA }, {
      operationId: 'create-patient-notes',
    });
    await service(data, 'user_two', 'membership_two').createTable({
      name: 'Patient Notes',
      schema: SCHEMA,
    }, { operationId: 'create-patient-notes' });

    expect(replay.tableId).toBe(created.tableId);
    expect(calls).toHaveLength(3);
    expect(calls[0]!.options.idempotencyKey).toBe(calls[1]!.options.idempotencyKey);
    expect(calls[0]!.input).toEqual(calls[1]!.input);
    expect(calls[2]!.options.idempotencyKey).not.toBe(calls[0]!.options.idempotencyKey);
    expect((calls[2]!.input as Record<string, unknown>).tableId).not.toBe(created.tableId);
    expect(calls[0]!.options.idempotencyKey).not.toContain('user_one');
    expect(created.key).toBe('patient_notes');
  });

  test('rejects hostile or non-serializable request values before dispatch', async () => {
    const calls: CommandCall[] = [];
    const studio = service(recordingClient(calls), 'user_one', 'membership_one');
    const proxiedSchema = new Proxy(SCHEMA, {});

    await expect(studio.createTable({
      name: 'Unsafe',
      schema: proxiedSchema,
    }, { operationId: 'unsafe-schema' })).rejects.toMatchObject({
      code: 'DATA_STUDIO_VALUE_INVALID',
    });

    await expect(studio.createRow('dst_valid', {
      payload: () => 'not serializable',
    }, { operationId: 'unsafe-row' })).rejects.toMatchObject({
      code: 'DATA_STUDIO_VALUE_INVALID',
    });
    expect(calls).toHaveLength(0);
  });

  test('closes malformed actor success payloads into a framework error', async () => {
    const studio = service(clientReturning({
      ok: true,
      value: { tableId: '../outside' },
    }), 'user_one', 'membership_one');

    await expect(studio.createTable({ name: 'Broken', schema: SCHEMA }, {
      operationId: 'broken-result',
    })).rejects.toMatchObject({
      code: 'DATA_STUDIO_INTERNAL_ERROR',
      retryable: false,
    });
  });

  test('rejects a mismatched Fabric command envelope', async () => {
    const data = {
      async command(
        _name: string,
        _input: DatabaseSerializableValue,
        options: DatabaseMutationOptions,
      ) {
        return commit(
          'data-studio.tables.update',
          options,
          validTableResult('dst_wrong_command'),
        );
      },
    } as unknown as AsyncDatabaseClient;
    const studio = service(data, 'user_one', 'membership_one');

    await expect(studio.createTable({ name: 'Wrong Command', schema: SCHEMA }, {
      operationId: 'wrong-command-result',
    })).rejects.toMatchObject({
      code: 'DATA_STUDIO_INTERNAL_ERROR',
      retryable: false,
    });
  });

  test('surfaces Fabric replay receipts without changing the simple API', async () => {
    const result = validTableResult('dst_replayed');
    const studio = service(clientReturning(result, true), 'user_one', 'membership_one');

    const receipt = await studio.createTableWithReceipt({
      name: 'Replayed',
      schema: SCHEMA,
    }, { operationId: 'replayed-create' });

    expect(receipt.replayed).toBe(true);
    expect(receipt.value.tableId).toBe('dst_replayed');
    expect(Object.isFrozen(receipt)).toBe(true);
  });

  test('preserves closed actor rejection semantics without exposing internals', async () => {
    const studio = service(clientReturning({
      ok: false,
      code: 'DATA_STUDIO_REVISION_CONFLICT',
      retryable: false,
      outcome: 'not-committed',
      currentRevision: 7,
    }), 'user_one', 'membership_one');

    let failure: unknown;
    try {
      await studio.updateTable('dst_table', {
        expectedRevision: 3,
        name: 'Changed',
      }, { operationId: 'update-conflict' });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(DataStudioError);
    expect(failure).toMatchObject({
      code: 'DATA_STUDIO_REVISION_CONFLICT',
      retryable: false,
      outcome: 'not-committed',
      details: { currentRevision: 7 },
      message: 'Data Studio operation was rejected.',
    });
  });
});

interface CommandCall {
  readonly name: string;
  readonly input: DatabaseSerializableValue;
  readonly options: DatabaseMutationOptions;
}

function service(
  data: AsyncDatabaseClient,
  userId: string,
  membershipId: string,
): DataStudioService {
  return new DataStudioService({ data, actor: { userId, membershipId } });
}

function recordingClient(calls: CommandCall[]): AsyncDatabaseClient {
  return {
    async command(
      name: string,
      input: DatabaseSerializableValue,
      options: DatabaseMutationOptions,
    ) {
      calls.push({ name, input, options });
      const record = input as Record<string, DatabaseSerializableValue>;
      return commit(name, options, {
        ok: true,
        value: {
          tableId: record.tableId,
          key: record.key,
          name: record.name,
          description: record.description,
          status: 'active',
          schema: record.schema,
          schemaRevision: 1,
          revision: 1,
          rowCount: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      });
    },
  } as unknown as AsyncDatabaseClient;
}

function clientReturning(
  value: DatabaseSerializableValue,
  replayed = false,
): AsyncDatabaseClient {
  return {
    async command(
      name: string,
      _input: DatabaseSerializableValue,
      options: DatabaseMutationOptions,
    ) {
      return commit(name, options, value, replayed);
    },
  } as unknown as AsyncDatabaseClient;
}

function commit(
  name: string,
  options: DatabaseMutationOptions,
  output: DatabaseSerializableValue,
  replayed = false,
) {
  return {
    value: { kind: 'command', name, output },
    sequence: '1' as never,
    idempotencyKey: options.idempotencyKey,
    replayed,
  };
}

function validTableResult(tableId: string): DatabaseSerializableValue {
  return {
    ok: true,
    value: {
      tableId,
      key: 'replayed',
      name: 'Replayed',
      description: null,
      status: 'active',
      schema: SCHEMA,
      schemaRevision: 1,
      revision: 1,
      rowCount: 0,
      createdAt: 1,
      updatedAt: 1,
    },
  } as unknown as DatabaseSerializableValue;
}
