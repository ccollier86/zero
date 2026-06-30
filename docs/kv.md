# Platform KV/cache

Zero ships a server-side Redis-style KV/cache service for fast app data,
counters, rate limits, workflow coordination, and backend scratch state without
adding Redis or another service.

The active lookup path is memory-first. Disk is used for append-only journal
records and checkpoints so a normal restart can recover the cache state.

## createApp Defaults

`createApp()` mounts KV by default:

```ts
import { defineZeroConfig } from '@zero/framework/server';

export default defineZeroConfig({
  db: {
    mode: 'hot',
    path: './data/app.db',
    snapshotPath: './data/app.snapshot.db',
  },
  tables,
  kv: {
    baseDir: './data/kv',
    durability: 'everysec',
  },
});
```

Omit `kv` to use the same default durable settings. Set `kv: false` only when
an app intentionally does not want the platform cache mounted.

```ts
export default defineZeroConfig({
  db: { mode: 'hot', path: './data/app.db', snapshotPath: './data/app.snapshot.db' },
  tables,
  kv: false,
});
```

Tests and intentionally ephemeral demos may use `durability: 'memory'`.
Generated apps should keep `everysec` or use `always` when the caller must not
observe a successful mutation until the journal is flushed.

## Backend Usage

App-owned backend routes receive the service through the `zero` context:

```ts
import { createServerRoute } from '@zero/framework/server';

export default createServerRoute({ name: 'cache.demo', prefix: '/api/cache' })
  .post('/message', async ({ zero }) => {
    await zero.kv?.set('message:latest', 'hello', { ttlMs: 60_000 });
    await zero.counter?.increment('message:writes');

    return {
      value: zero.kv?.get('message:latest') ?? null,
      writes: zero.counter?.value('message:writes') ?? 0,
    };
  });
```

The same service can be resolved outside a route when needed:

```ts
import { getKvService } from '@zero/framework/server';

const kv = getKvService();
await kv?.set('job:last-run', Date.now());
```

## Public API

The service currently supports:

- `get`, `getEntry`, `has`
- `set`, `setMany`, `getMany`
- `delete`, `deleteMany`, `clear`
- `expire`, `persist`
- `compareAndSet`
- `getOrSet`
- `increment`, `decrement`
- `namespace`
- counters through `zero.counter`
- fixed-window, token-bucket, and sliding-window limiters through `zero.limiter`

Example namespacing:

```ts
const onboarding = zero.kv?.namespace('onboarding');

await onboarding?.set('draft:123', { step: 3 }, { ttlMs: 24 * 60 * 60 * 1000 });
const draft = onboarding?.get<{ step: number }>('draft:123');
```

## Durability

| Mode | Behavior | Use |
| --- | --- | --- |
| `everysec` | Append to a buffered journal, fsync periodically and on shutdown. | Default Redis-style balance. |
| `always` | Fsync before the mutation resolves. | Stronger durability, slower writes. |
| `memory` | No journal or checkpoint. | Tests and intentionally ephemeral demos. |

Startup recovery:

1. Load the latest checkpoint when present.
2. Rebuild the memory engine and TTL/LRU indexes.
3. Replay newer journal records.
4. Drop expired entries during recovery.

Shutdown writes a final checkpoint when the service has data or mutations.

## Advanced Direct Plugin Usage

Most apps should let `createApp()` mount KV. Manual Elysia composition is still
available:

```ts
import { Elysia } from 'elysia';
import { createKvPlugin } from '@zero/framework/kv';

const app = new Elysia()
  .use(createKvPlugin({ baseDir: './data/kv' }))
  .get('/cache', ({ kv }) => kv.get('message'));
```

The plugin decorates Elysia context with `kv`, `kvService`, `counter`, and
`limiter`.

## Rules

- Active KV/cache reads stay in memory.
- Disk is for journal, checkpoint, and recovery.
- KV/cache is not an active file-backed lookup service.
- Use SQL/file mode, vector/file mode, object storage, or a future external
  adapter for workloads that do not fit memory.
