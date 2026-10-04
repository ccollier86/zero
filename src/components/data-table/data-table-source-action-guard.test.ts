import { describe, expect, test } from 'bun:test';
import { DataTableMutationLifecycleError } from './data-table-mutation-types';
import { invokeDataTableSourceWrite } from './data-table-source-action-guard';

describe('invokeDataTableSourceWrite', () => {
  test('rejects a requested write that the source does not implement', async () => {
    const result = invokeDataTableSourceWrite('update', true);

    await expect(Promise.resolve(result)).rejects.toMatchObject({
      name: 'DataTableMutationLifecycleError',
      code: 'DATA_TABLE_MUTATION_ACTION_UNAVAILABLE',
    });
  });

  test('rejects stale-scope writes without invoking their operation', async () => {
    let invoked = false;
    const result = invokeDataTableSourceWrite('remove', false, () => {
      invoked = true;
    });

    await expect(Promise.resolve(result)).rejects.toBeInstanceOf(
      DataTableMutationLifecycleError,
    );
    await expect(Promise.resolve(result)).rejects.toMatchObject({
      code: 'DATA_TABLE_MUTATION_SCOPE_UNAVAILABLE',
    });
    expect(invoked).toBeFalse();
  });

  test('returns the selected operation result while the scope is current', async () => {
    let invoked = false;
    const result = invokeDataTableSourceWrite('insert', true, async () => {
      invoked = true;
    });

    await result;
    expect(invoked).toBeTrue();
  });
});
