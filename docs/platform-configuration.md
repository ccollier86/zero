# Platform Configuration Protocol

Zero should keep `createApp()` small. Complex systems should move into focused,
typed config files that `createApp()` can discover or explicitly load.

The first target for this protocol is auth metadata, access policies, tenancy,
and avatars. After that shape is proven, the same protocol can be applied to
storage, sync defaults, observability, migrations, and future systems.

## Goals

1. Keep `createApp()` readable.
2. Give developers fill-in-the-blank config templates.
3. Keep config files type-safe and autocomplete-friendly.
4. Let admin UI read the normalized effective config.
5. Avoid hidden magic: config discovery should be documented and overrideable.
6. Keep config modules pure: no server startup, no database writes, no network
   calls.

## Recommended App Shape

Use a dedicated config folder so platform behavior is easy to find. For a new
blank Zero app, this folder should be one of the first places a developer
opens.

Preferred shape:

```txt
app/
  server.ts
zero/
  auth.ts
  access.ts
  storage.ts
  sync.ts
  observability.ts
```

`server.ts` stays small:

```ts
import { createApp } from '@platform/server';
import { tables } from './lib/schemas';

const app = await createApp({
  db: { mode: './data/app.db' },
  tables,
  auth: true,
  configDir: './zero',
});

app.listen(3000);
```

`createApp()` should load known config files from `configDir` when present.
Inline config remains supported for tests and tiny apps, but it should not be
the recommended path for larger apps.

Alternative shape for apps that prefer all config under `config/`:

```txt
config/
  zero/
    auth.ts
    access.ts
    storage.ts
    sync.ts
    observability.ts
```

Both are acceptable, but generated starter apps should use `zero/` by default
because it is short, obvious, and platform-specific.

## File Naming

V1 focused config files:

| File | System |
| --- | --- |
| `zero/auth.ts` | auth metadata, tenancy, avatar config |
| `zero/access.ts` | table/route/storage/action policy helpers |

Future files:

| File | System |
| --- | --- |
| `zero/storage.ts` | drives, file limits, MIME policy, public/private defaults |
| `zero/sync.ts` | sync defaults, lazy/full policy, snapshot limits |
| `zero/observability.ts` | sinks, endpoint access, trace thresholds |
| `zero/migrations.ts` | migration safety defaults, doctor strictness, paths |

## Module Contract

Each config file should export a default value produced by a typed helper:

```ts
import { defineAuthConfig } from '@platform/server';

export default defineAuthConfig({
  access: {
    groups: ['accounting', 'management'],
  },
});
```

Config helper rules:

1. Return the config object unchanged at runtime.
2. Provide TypeScript inference and validation hints.
3. Avoid importing Elysia context, database handles, or app runtime state.
4. Allow comments and blank sections in generated templates.

## Loading Rules

Recommended precedence:

1. Platform defaults.
2. Discovered config files from `configDir`.
3. Explicit config file paths from `createApp()`.
4. Inline `createApp()` overrides.

Inline overrides should win because they are closest to the composition root
and useful in tests.

Example explicit paths:

```ts
createApp({
  db,
  tables,
  auth: {
    config: './zero/auth.ts',
  },
  access: {
    config: './zero/access.ts',
  },
});
```

## Effective Config

Every config file should compile into a normalized internal config.

Current auth behavior config can be passed inline today:

```ts
createApp({
  app: {
    name: Bun.env.APP_NAME ?? 'Acme CRM',
    publicUrl: Bun.env.APP_PUBLIC_URL ?? 'https://crm.example.com',
    supportEmail: Bun.env.APP_SUPPORT_EMAIL,
  },
  db,
  tables,
  email: Bun.env.RESEND_API_KEY
    ? {
        from: Bun.env.EMAIL_FROM ?? 'Acme CRM <noreply@example.com>',
        replyTo: Bun.env.EMAIL_REPLY_TO,
        provider: 'resend',
        resend: {
          apiKey: Bun.env.RESEND_API_KEY,
        },
      }
    : false,
  auth: {
    registration: { mode: 'admin-only' },
    accountEmails: {
      adminCreatedUser: Boolean(Bun.env.RESEND_API_KEY),
      passwordReset: Boolean(Bun.env.RESEND_API_KEY),
      actionTokenTTL: Bun.env.AUTH_ACTION_TOKEN_TTL ?? '1h',
    },
    userProperties: {
      department: {
        type: 'enum',
        values: ['accounting', 'operations'],
        editableBy: 'admin',
      },
    },
  },
});
```

Relevant environment variables are shown in `.env.example`:

| Variable | Used for |
| --- | --- |
| `APP_NAME` | App display name in system email. |
| `APP_PUBLIC_URL` | Public origin used to build reset/setup links. Required for account email. |
| `APP_SUPPORT_EMAIL` | Optional support/reply identity. |
| `EMAIL_FROM` | Default sender for platform email. |
| `EMAIL_REPLY_TO` | Optional reply-to address. |
| `RESEND_API_KEY` | Enables the default Resend email provider. |
| `AUTH_ACTION_TOKEN_TTL` | Expiration for setup/reset action tokens. |
| `ACCESS_TOKEN_TTL` | Access token lifetime. |
| `REFRESH_TOKEN_TTL` | Refresh token lifetime. |
| `AUTH_SIGNING_KEY` | Optional externally managed ES256 private JWK. |

Config-file discovery/scaffolding remains planned. Inline config uses the same
contract that future `zero/auth.ts` or `config/auth.ts` files should export.

Admin UI and platform doctor should read the effective normalized config, not
raw user-authored files.

Recommended endpoint shape:

```txt
GET /api/_zero/config
```

or system-specific endpoints:

```txt
GET /auth/admin/config
GET /api/_zero/observability/config
```

Admin-only responses should omit secrets and include enough structure for UI
components to adapt.

## Templates

Zero should scaffold blank config files with comments:

```txt
bun run zero init-config auth
bun run zero init-config access
```

By default, scaffolding writes:

```txt
zero/auth.ts
zero/access.ts
```

Templates should be normal TypeScript files. They should teach by showing
commented examples and safe defaults, not by requiring a separate wizard.

## Doctor Checks

Future platform doctor should validate config files:

1. Missing referenced config files.
2. Unsupported keys or field types.
3. Invalid metadata values.
4. Conflicting inline and file config.
5. Authz metadata marked user-writable.
6. Tenancy configured without matching table columns/policies.
7. Storage/avatar config without storage support.
8. Observability endpoint enabled with unsafe production access.

## Rollout Plan

1. Implement the protocol for `zero.auth.ts` and `zero.access.ts`.
2. Add templates and docs for those files.
3. Add effective config endpoint for admin UI.
4. Build adaptive admin UI against the effective config.
5. Move storage/sync/observability/migration config to the same protocol after
   auth/access proves the shape.

Do not refactor every `createApp()` option at once. Start with auth/access,
then migrate other systems one at a time.
