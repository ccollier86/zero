---
id: zero.configuration.declaration
type: how-to
audience: [developer, agent, operator]
owner: platform-configuration
status: draft
visibility: internal
system: platform-configuration
feature: declaration
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [managed-server]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Declare And Organize App Configuration

[Configuration index](./index.md) · [Documentation index](../../index.md)

`defineZeroConfig` preserves literal inference while checking an
`AppConfig`. It returns the same object. It does not resolve environment
variables, merge files, open a database or start a service.

```ts
// zero.config.ts
import { defineZeroConfig } from '@zero/framework/server';
import { defineTable, field } from '@zero/framework/schema';

const tasks = defineTable('tasks', {
  title: field.text({ required: true }),
  done: field.boolean({ defaultValue: false }),
});

export default defineZeroConfig({
  db: { mode: 'file', path: './data/app.db' },
  tables: { tasks },
  auth: true,
  port: 3000,
  postLoginPath: '/app',
});
```

The configuration fragment assumes the app's authenticated page exists at
`/app`. Declaring a table does not alone establish its Resource/Sync exposure
policy or business ownership rule.

```ts
// app.ts — server entry
import { createApp } from '@zero/framework/server';
import config from './zero.config';

const app = await createApp(config);
app.listen(config.port ?? 3000);
```

Await composition before listening. The configured `port` is not an implicit
listener. Production code should also follow [startup and shutdown ownership](../runtime/lifecycle.md).

## Split By Responsibility

Import ordinary typed feature modules for database topology, Guardian, AI or
resources. Compose those values in one reviewed app configuration. Keep
client-safe schema modules separate from provider keys and server-only options.

Do not invent a `configDir`, deep-merge API, arbitrary loader or database
settings editor from this example. The current supported pattern is normal
TypeScript imports plus `defineZeroConfig` / `createApp`.

Module evaluation executes code. Keep configuration declarations deterministic
where practical, and avoid listener creation, migrations, network calls or
secret logging at import time. Doctor also imports configuration; a module that
starts the app when imported is not a safe diagnostic input.

## Verify Without Live Data

Typecheck the config and pass a synthetic version to `resolveConfig` for
normalization/admission checks. Actual app startup has build/database/lifecycle
effects and requires disposable fixture paths. No config helper typecheck proves
a live schema migration is safe.

## Related Guides And Next Steps

- [Resolution](./resolution.md) owns read times and per-feature precedence.
- [Reference](./configuration.md) lists top-level options and exact defaults.
- [Schema tables](../schema/tables.md) defines the shared table declarations.
- [Discovery](../runtime/discovery.md) explains how extensions are imported.
