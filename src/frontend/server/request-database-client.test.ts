import { describe, expect, test } from 'bun:test';

import {
  applicationServiceDataScope,
  trustedSystemServiceDataScope,
} from '../../auth/service-data-scope';
import type {
  BindTenantDatabaseOptions,
  DatabaseManager,
  TenantDatabaseBinding,
} from '../../databases/database-manager';
import type {
  AsyncDatabaseClient,
  DatabaseCommitResult,
  DatabaseReadResult,
  DatabaseSerializableValue,
} from '../../databases/database-operations';
import {
  createRequestDatabaseClient,
  createResourceTenantDatabaseAccess,
} from './request-database-client';

describe('createRequestDatabaseClient', () => {
  test('returns null outside an enabled committed tenant-database scope', () => {
    const disabled = createManagerHarness({ tenantDatabasesEnabled: false });
    const enabled = createManagerHarness({ tenantDatabasesEnabled: true });

    expect(createRequestDatabaseClient({
      manager: null,
      scope: tenantScope('tenant-a'),
      assertCurrentAuthoritySync() {},
    })).toBeNull();
    expect(createRequestDatabaseClient({
      manager: disabled.manager,
      scope: tenantScope('tenant-a'),
      assertCurrentAuthoritySync() {},
    })).toBeNull();
    expect(createRequestDatabaseClient({
      manager: enabled.manager,
      scope: applicationServiceDataScope(),
      assertCurrentAuthoritySync() {},
    })).toBeNull();
    expect(disabled.binds).toHaveLength(0);
    expect(enabled.binds).toHaveLength(0);
  });

  test('closes over the trusted tenant and exposes only declarative operations', async () => {
    const harness = createManagerHarness({ tenantDatabasesEnabled: true });
    const client = createRequestDatabaseClient({
      manager: harness.manager,
      scope: tenantScope('tenant-from-authority'),
      assertCurrentAuthoritySync() {},
    });

    expect(client).not.toBeNull();
    expect(Reflect.ownKeys(client!)).toEqual([]);
    expect(Object.isFrozen(client!)).toBe(true);
    expect('manager' in client!).toBeFalse();
    expect('bindTenant' in client!).toBeFalse();
    expect('tenantId' in client!).toBeFalse();
    expect('execute' in client!).toBeFalse();
    expect(JSON.stringify(client)).toBe('{}');

    await client!.get('todos', 'a');
    await client!.list('todos', { limit: 10 });
    await client!.find('todos', { limit: 10 });
    await client!.query('todos.count', null);
    await client!.mutate(
      { type: 'delete', table: 'todos', id: 'a' },
      { idempotencyKey: 'delete:a' },
    );
    await client!.batch({
      mutations: [{ type: 'delete', table: 'todos', id: 'b' }],
    }, { idempotencyKey: 'delete:b' });
    await client!.command('todos.clear', null, { idempotencyKey: 'clear' });

    expect(harness.binds).toHaveLength(7);
    expect(harness.binds.map((binding) => binding.options.tenantId))
      .toEqual(Array(7).fill('tenant-from-authority'));
    expect(harness.binds.map((binding) => binding.releaseCount))
      .toEqual(Array(7).fill(1));
    expect(harness.calls.map((call) => call.method)).toEqual([
      'get', 'list', 'find', 'query', 'mutate', 'batch', 'command',
    ]);
  });

  test('releases every acquired lease when each operation fails', async () => {
    const methods = [
      'get', 'list', 'find', 'query', 'mutate', 'batch', 'command',
    ] as const;

    for (const failedMethod of methods) {
      const harness = createManagerHarness({
        tenantDatabasesEnabled: true,
        failedMethod,
      });
      const client = createRequestDatabaseClient({
        manager: harness.manager,
        scope: tenantScope('tenant-a'),
        assertCurrentAuthoritySync() {},
      })!;

      await expect(invoke(client, failedMethod)).rejects.toThrow(`failed:${failedMethod}`);
      expect(harness.binds).toHaveLength(1);
      expect(harness.binds[0]!.releaseCount).toBe(1);
    }
  });

  test('forwards the strict authority callback and releases after authority failure', async () => {
    const harness = createManagerHarness({
      tenantDatabasesEnabled: true,
      invokeAuthority: true,
    });
    let checks = 0;
    const client = createRequestDatabaseClient({
      manager: harness.manager,
      scope: tenantScope('tenant-a'),
      assertCurrentAuthoritySync() {
        checks += 1;
        throw new Error('revoked');
      },
    })!;

    await expect(client.get('todos', 'a')).rejects.toThrow('revoked');
    expect(checks).toBe(1);
    expect(harness.binds[0]!.releaseCount).toBe(1);
    expect(harness.binds[0]!.options.assertCurrentAuthoritySync)
      .toBe(harness.binds[0]!.options.assertCurrentReadAuthority!);
  });

  test('rechecks authority after the actor result and immediately before delivery', async () => {
    let current = true;
    let checks = 0;
    const harness = createManagerHarness({
      tenantDatabasesEnabled: true,
      invokeAuthority: true,
      afterOperation() {
        // Model revocation queued after the actor client's own post-read fence
        // but before this request-facing await continuation resumes.
        queueMicrotask(() => { current = false; });
      },
    });
    const client = createRequestDatabaseClient({
      manager: harness.manager,
      scope: tenantScope('tenant-a'),
      assertCurrentAuthoritySync() {
        checks += 1;
        if (!current) throw new Error('/private/revocation-detail');
      },
    })!;

    await expect(client.get('todos', 'a')).rejects.toMatchObject({
      code: 'DATABASE_AUTHORITY_CHANGED',
      outcome: null,
      retryable: false,
    });
    expect(checks).toBe(2);
    expect(harness.binds[0]!.releaseCount).toBe(1);
  });

  test('preserves invalid callback return values for manager/client runtime rejection', async () => {
    const harness = createManagerHarness({ tenantDatabasesEnabled: true });
    const invalidReturn = Promise.resolve(undefined);
    const client = createRequestDatabaseClient({
      manager: harness.manager,
      scope: tenantScope('tenant-a'),
      assertCurrentAuthoritySync: (
        () => invalidReturn
      ) as unknown as () => void,
    })!;

    await expect(client.get('todos', 'a')).rejects.toMatchObject({
      code: 'DATABASE_CONFIG_INVALID',
      outcome: null,
      retryable: false,
    });
    const returned: unknown = harness.binds[0]!.options.assertCurrentAuthoritySync();
    expect(returned).toBe(invalidReturn);
    expect(harness.binds[0]!.releaseCount).toBe(1);
  });

  test('does not invent a lease when tenant binding itself fails', async () => {
    const harness = createManagerHarness({
      tenantDatabasesEnabled: true,
      bindError: new Error('capacity'),
    });
    const client = createRequestDatabaseClient({
      manager: harness.manager,
      scope: tenantScope('tenant-a'),
      assertCurrentAuthoritySync() {},
    })!;

    await expect(client.get('todos', 'a')).rejects.toThrow('capacity');
    expect(harness.binds).toHaveLength(0);
  });

  test('keeps one private Resource lease across reads and receipt lookup', async () => {
    const harness = createManagerHarness({ tenantDatabasesEnabled: true });
    const access = await createResourceTenantDatabaseAccess({
      manager: harness.manager,
      scope: tenantScope('tenant-resource'),
      assertCurrentAuthoritySync() {},
    });
    expect(access).not.toBeNull();
    expect(harness.binds).toHaveLength(1);

    await access!.client.get('todos', 'a');
    await access!.trustedWriter.findReceipt(
      'resource:v2:test',
      `sha256:${'a'.repeat(64)}`,
    );
    expect(harness.binds).toHaveLength(1);
    expect(harness.binds[0]!.releaseCount).toBe(0);

    access!.release();
    access!.release();
    expect(harness.binds[0]!.releaseCount).toBe(1);

    const publicClient = createRequestDatabaseClient({
      manager: harness.manager,
      scope: tenantScope('tenant-resource'),
      assertCurrentAuthoritySync() {},
    })!;
    expect('trustedWriter' in publicClient).toBeFalse();
  });
});

type ClientMethod =
  | 'get'
  | 'list'
  | 'find'
  | 'query'
  | 'mutate'
  | 'batch'
  | 'command';

function createManagerHarness(options: {
  tenantDatabasesEnabled: boolean;
  failedMethod?: ClientMethod;
  invokeAuthority?: boolean;
  afterOperation?: () => void;
  bindError?: Error;
}) {
  const binds: Array<{
    options: BindTenantDatabaseOptions;
    releaseCount: number;
  }> = [];
  const calls: Array<{ method: ClientMethod; args: readonly unknown[] }> = [];
  const manager = {
    diagnostics() {
      return { tenantDatabasesEnabled: options.tenantDatabasesEnabled };
    },
    async bindTenant(bindingOptions: BindTenantDatabaseOptions) {
      if (options.bindError) throw options.bindError;
      const record = { options: bindingOptions, releaseCount: 0 };
      binds.push(record);
      const client = clientFixture(async (method, args) => {
        calls.push({ method, args });
        if (options.invokeAuthority) bindingOptions.assertCurrentReadAuthority?.();
        if (options.failedMethod === method) throw new Error(`failed:${method}`);
        options.afterOperation?.();
        return method === 'get'
          || method === 'list'
          || method === 'find'
          || method === 'query'
          ? readResult(null)
          : commitResult(null);
      });
      return {
        client,
        trustedWriter: {
          async findReceipt() { return { status: 'miss' } as const; },
          async executeWrite() { throw new Error('not expected'); },
        },
        get released() { return record.releaseCount > 0; },
        release() { record.releaseCount += 1; },
        async [Symbol.asyncDispose]() { record.releaseCount += 1; },
      } satisfies TenantDatabaseBinding;
    },
  } as unknown as DatabaseManager;
  return { manager, binds, calls };
}

function clientFixture(
  call: (method: ClientMethod, args: readonly unknown[]) => Promise<unknown>,
): AsyncDatabaseClient {
  return {
    get: (...args) => call('get', args) as ReturnType<AsyncDatabaseClient['get']>,
    list: (...args) => call('list', args) as ReturnType<AsyncDatabaseClient['list']>,
    find: (...args) => call('find', args) as ReturnType<AsyncDatabaseClient['find']>,
    query: (...args) => call('query', args) as ReturnType<AsyncDatabaseClient['query']>,
    mutate: (...args) => call('mutate', args) as ReturnType<AsyncDatabaseClient['mutate']>,
    batch: (...args) => call('batch', args) as ReturnType<AsyncDatabaseClient['batch']>,
    command: (...args) => call('command', args) as ReturnType<AsyncDatabaseClient['command']>,
  };
}

function tenantScope(tenantId: string) {
  return trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId });
}

function readResult(value: DatabaseSerializableValue): DatabaseReadResult {
  return { value, sequence: { seq: 0 } };
}

function commitResult(value: DatabaseSerializableValue): DatabaseCommitResult {
  return {
    value,
    sequence: { seq: 1 },
    idempotencyKey: 'test',
    replayed: false,
  };
}

function invoke(client: AsyncDatabaseClient, method: ClientMethod): Promise<unknown> {
  switch (method) {
    case 'get': return client.get('todos', 'a');
    case 'list': return client.list('todos', { limit: 1 });
    case 'find': return client.find('todos', { limit: 1 });
    case 'query': return client.query('todos.count', null);
    case 'mutate': return client.mutate(
      { type: 'delete', table: 'todos', id: 'a' },
      { idempotencyKey: 'delete:a' },
    );
    case 'batch': return client.batch({ mutations: [] }, { idempotencyKey: 'batch' });
    case 'command': return client.command('todos.clear', null, { idempotencyKey: 'clear' });
  }
}
