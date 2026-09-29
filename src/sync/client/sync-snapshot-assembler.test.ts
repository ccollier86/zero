import { describe, expect, test } from 'bun:test';

import { SyncSnapshotAssembler } from './sync-snapshot-assembler';

const definitions = {
  platform_users: { _pk: 'id', id: 'text' },
  todos: { _pk: 'id', id: 'text', title: 'text' },
};
const planes = {
  platform_users: 'default',
  todos: 'tenant',
} as const;

describe('SyncSnapshotAssembler', () => {
  test('stages bounded frames and produces one atomic snapshot', () => {
    const assembler = new SyncSnapshotAssembler(definitions, planes);
    expect(assembler.accept({
      type: 'sync.snapshot.begin',
      snapshotId: 'snapshot-1',
      plane: 'tenant',
      tables: ['todos'],
      seq: 41,
      epoch: 'tenant-epoch',
      scope: 'tenant-scope',
      reset: 'purge',
    })).toEqual({ status: 'pending' });
    expect(assembler.accept({
      type: 'sync.snapshot.chunk',
      snapshotId: 'snapshot-1',
      plane: 'tenant',
      table: 'todos',
      rows: { one: { id: 'one', title: 'First' } },
    })).toEqual({ status: 'pending' });
    expect(assembler.accept({
      type: 'sync.snapshot.chunk',
      snapshotId: 'snapshot-1',
      plane: 'tenant',
      table: 'todos',
      rows: { two: { id: 'two', title: 'Second' } },
    })).toEqual({ status: 'pending' });

    expect(assembler.accept({
      type: 'sync.snapshot.end',
      snapshotId: 'snapshot-1',
      plane: 'tenant',
    })).toEqual({
      status: 'complete',
      message: {
        type: 'sync.snapshot',
        plane: 'tenant',
        tables: {
          todos: {
            one: { id: 'one', title: 'First' },
            two: { id: 'two', title: 'Second' },
          },
        },
        seq: 41,
        epoch: 'tenant-epoch',
        scope: 'tenant-scope',
        reset: 'purge',
      },
    });
  });

  test('fails closed on cross-plane tables, duplicate rows, and unsafe ids', () => {
    const assembler = new SyncSnapshotAssembler(definitions, planes);
    expect(assembler.accept({
      type: 'sync.snapshot.begin', snapshotId: 'bad-plane', plane: 'tenant',
      tables: ['platform_users'], seq: 0, reset: 'preserve-pending',
    })).toEqual({ status: 'invalid' });

    expect(assembler.accept({
      type: 'sync.snapshot.begin', snapshotId: 'duplicates', plane: 'tenant',
      tables: ['todos'], seq: 0, reset: 'preserve-pending',
    })).toEqual({ status: 'pending' });
    expect(assembler.accept({
      type: 'sync.snapshot.chunk', snapshotId: 'duplicates', plane: 'tenant',
      table: 'todos', rows: { one: { id: 'one' } },
    })).toEqual({ status: 'pending' });
    expect(assembler.accept({
      type: 'sync.snapshot.chunk', snapshotId: 'duplicates', plane: 'tenant',
      table: 'todos', rows: { one: { id: 'one' } },
    })).toEqual({ status: 'invalid' });

    expect(assembler.accept({
      type: 'sync.snapshot.begin', snapshotId: 'unsafe', plane: 'tenant',
      tables: ['todos'], seq: 0, reset: 'preserve-pending',
    })).toEqual({ status: 'pending' });
    expect(assembler.accept({
      type: 'sync.snapshot.chunk', snapshotId: 'unsafe', plane: 'tenant',
      table: 'todos',
      rows: { '9007199254740992': { id: 9_007_199_254_740_992 } },
    })).toEqual({ status: 'invalid' });
  });

  test('supersedes an abandoned transfer and rejects empty progress frames', () => {
    const assembler = new SyncSnapshotAssembler(definitions, planes);
    expect(assembler.accept({
      type: 'sync.snapshot.begin', snapshotId: 'first', plane: 'tenant',
      tables: ['todos'], seq: 0, reset: 'preserve-pending',
    })).toEqual({ status: 'pending' });
    expect(assembler.accept({
      type: 'sync.snapshot.begin', snapshotId: 'second', plane: 'tenant',
      tables: ['todos'], seq: 0, reset: 'preserve-pending',
    })).toEqual({ status: 'pending' });
    expect(assembler.accept({
      type: 'sync.snapshot.chunk', snapshotId: 'second', plane: 'tenant',
      table: 'todos', rows: {},
    })).toEqual({ status: 'invalid' });
  });

  test('bounds aggregate snapshot chunk work', () => {
    const assembler = new SyncSnapshotAssembler(definitions, planes);
    expect(assembler.accept({
      type: 'sync.snapshot.begin', snapshotId: 'bounded', plane: 'tenant',
      tables: ['todos'], seq: 0, reset: 'preserve-pending',
    })).toEqual({ status: 'pending' });
    for (let index = 0; index < 512; index += 1) {
      const id = `row-${index}`;
      expect(assembler.accept({
        type: 'sync.snapshot.chunk', snapshotId: 'bounded', plane: 'tenant',
        table: 'todos', rows: { [id]: { id } },
      })).toEqual({ status: 'pending' });
    }
    expect(assembler.accept({
      type: 'sync.snapshot.chunk', snapshotId: 'bounded', plane: 'tenant',
      table: 'todos', rows: { overflow: { id: 'overflow' } },
    })).toEqual({ status: 'invalid' });
  });

  test('keeps the legacy default plane outside tenant-only aggregate limits', () => {
    const assembler = new SyncSnapshotAssembler(definitions, planes);
    expect(assembler.accept({
      type: 'sync.snapshot.begin', snapshotId: 'default-large',
      tables: ['platform_users'], seq: 0, reset: 'preserve-pending',
    })).toEqual({ status: 'pending' });
    for (let index = 0; index < 513; index += 1) {
      const id = `user-${index}`;
      expect(assembler.accept({
        type: 'sync.snapshot.chunk', snapshotId: 'default-large',
        table: 'platform_users', rows: { [id]: { id } },
      })).toEqual({ status: 'pending' });
    }
    expect(assembler.accept({
      type: 'sync.snapshot.end', snapshotId: 'default-large',
    }).status).toBe('complete');
  });
});
