# Platform Configuration Protocol

Zero should keep `createApp()` small. Complex systems should move into focused,
typed config files that `createApp()` can discover or explicitly load.

The first target for this protocol is auth metadata, access policies, tenancy,
and avatars. After that shape is proven, the same protocol can be applied to
storage, sync defaults, observability, AI, migrations, and future systems.

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
  ai.ts
  vector.ts
```

`server.ts` stays small:

```ts
import { createApp } from '@zero/framework/server';
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
| `zero/ai.ts` | provider aliases, explicit providers, status endpoint |
| `zero/vector.ts` | vector indexes, dimensions, metadata filter fields |
| `zero/migrations.ts` | migration safety defaults, doctor strictness, paths |

## Module Contract

Each config file should export a default value produced by a typed helper:

```ts
import { defineAuthConfig } from '@zero/framework/server';

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
      manualPasswordReset: Bun.env.AUTH_MANUAL_PASSWORD_RESET !== 'false',
      actionTokenTTL: Bun.env.AUTH_ACTION_TOKEN_TTL ?? '1h',
      requestCooldown: Bun.env.AUTH_ACCOUNT_EMAIL_COOLDOWN ?? '5m',
    },
    userProperties: {
      department: {
        type: 'enum',
        values: ['accounting', 'operations'],
        editableBy: 'admin',
      },
    },
  },
  ai: true,
  vector: Bun.env.ZERO_VECTOR_ENABLED === 'true'
    ? {
        dataDir: Bun.env.ZERO_VECTOR_DATA_DIR ?? './data/vector',
        defaultDimensions: Number(Bun.env.ZERO_VECTOR_DEFAULT_DIMENSIONS ?? 1536),
      }
    : false,
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
| `AUTH_ACCOUNT_EMAIL_COOLDOWN` | Cooldown between active setup/reset emails for the same user and token type. |
| `AUTH_MANUAL_PASSWORD_RESET` | Set to `false` to disable direct admin password replacement and require email-driven reset flows. |
| `ACCESS_TOKEN_TTL` | Access token lifetime. |
| `REFRESH_TOKEN_TTL` | Refresh token lifetime. |
| `AUTH_SIGNING_KEY` | Optional externally managed ES256 private JWK. |
| `OPENAI_API_KEY` | Enables OpenAI when `ai: true`. |
| `ANTHROPIC_API_KEY` | Enables Anthropic when `ai: true`. |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | Enables Google Generative AI when `ai: true`. |
| `GROQ_API_KEY` | Enables Groq when `ai: true`. |
| `XAI_API_KEY` | Enables xAI when `ai: true`. |
| `COHERE_API_KEY` | Enables Cohere when `ai: true`. |
| `LLAMA_API_KEY` / `META_LLAMA_API_KEY` | Enables the custom Meta Llama provider when `ai: true`. |
| `DEEPSEEK_API_KEY` | Enables DeepSeek via OpenAI-compatible adapter when `ai: true`. |
| `PERPLEXITY_API_KEY` / `PERPLEXITYAI_API_KEY` | Enables Perplexity via OpenAI-compatible adapter when `ai: true`. |
| `VOYAGE_API_KEY` | Enables Voyage embeddings via OpenAI-compatible adapter when `ai: true`. |
| `DEEPGRAM_API_KEY` | Enables Deepgram transcription and speech when `ai: true`. |
| `{PROVIDER_ID}_API_KEY` | Optional convention for explicit non-catalog AI providers when `apiKey` is omitted, for example `LOCAL_API_KEY`. |
| `{PROVIDER_ID}_BASE_URL` | Optional convention for explicit non-catalog AI providers when `baseURL` is omitted, for example `LOCAL_BASE_URL`. |
| `ZERO_AI_FAST_MODEL` | Optional `fast` alias override. |
| `ZERO_AI_SMART_MODEL` | Optional `smart` alias override. |
| `ZERO_AI_EMBEDDING_MODEL` | Optional `embedding` alias override. |
| `ZERO_AI_IMAGE_MODEL` | Optional `image` alias override. |
| `ZERO_AI_TRANSCRIPTION_MODEL` | Optional `transcription` alias override. |
| `ZERO_AI_SPEECH_MODEL` | Optional `speech` alias override. |
| `ZERO_VECTOR_ENABLED` | Starter-app convention for enabling inline vector config. |
| `ZERO_VECTOR_DATA_DIR` | Default local zvec collection directory. |
| `ZERO_VECTOR_DEFAULT_DIMENSIONS` | Default vector dimensions for `vector: true`. |

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

## Platform Doctor

Zero now includes an app-level platform doctor:

```txt
bun run doctor -- --config ./zero.config.ts
bun run doctor -- --config ./zero.config.ts --strict
```

The platform doctor checks createApp config and warnings do not fail by
default. `--strict` makes warnings fail for CI.

Current checks cover:

1. Invalid `createApp()` config such as `stateSync` without auth.
2. Explicit `storageDir` without auth, because platform storage only mounts
   when auth is enabled.
3. Missing or multiple primary-key declarations in ReactiveDB tables.
4. Invalid natural identity fields.
5. Invalid auth action-token TTL/cooldown duration strings.
6. Auth account email flows with email disabled.
7. Missing `app.publicUrl`, sender address, or Resend API key for email-driven
   account flows.
8. File-backed databases with startup migrations disabled.
9. Auth-enabled apps without an app `syncPolicy`.
10. Login route access when `loginPath` is missing from `publicPaths`.
11. Lazy/auto sync index guidance for `/api/data` filters and sorting.
12. Observability disabled in production, unreadable endpoint policy, and
    endpoint/store mismatches.
13. AI provider readiness, custom OpenAI-compatible base URLs, aliases,
    capability mismatches, and status endpoint access policy.
14. Vector path collisions, storage/build-output path overlap, read-only
    indexes, unusually high dimensions, embedding alias readiness, and
    unindexed scope metadata fields.

Future config-file doctor checks should validate:

1. Missing referenced config files.
2. Unsupported keys or field types.
3. Invalid metadata values.
4. Conflicting inline and file config.
5. Authz metadata marked user-writable.
6. Tenancy configured without matching table columns/policies.
7. Storage/avatar config without storage support.
8. App-owned policy files that reference missing tables, columns, or auth
   metadata keys.

## Rollout Plan

1. Implement the protocol for `zero.auth.ts` and `zero.access.ts`.
2. Add templates and docs for those files.
3. Add effective config endpoint for admin UI.
4. Build adaptive admin UI against the effective config.
5. Move storage/sync/observability/migration config to the same protocol after
   auth/access proves the shape.

Do not refactor every `createApp()` option at once. Start with auth/access,
then migrate other systems one at a time.
