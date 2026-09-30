# Platform Configuration Protocol

Zero should keep `createApp()` small. Complex systems should move into focused,
typed config files that `createApp()` can discover or explicitly load.

The first target for this protocol is auth metadata, access policies, tenancy,
and avatars. After that shape is proven, the same protocol can be applied to
storage, sync defaults, observability, AI, PDF rendering, migrations, and
future systems.

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
  auth-emails/
    index.ts
    account-setup.ts
    password-reset.ts
    email-verification.ts
    email-otp.ts
  access.ts
  storage.ts
  sync.ts
  observability.ts
  ai.ts
  vector.ts
  pdf.ts
```

`server.ts` stays small:

```ts
import { createApp, defineZeroConfig } from '@zero/framework/server';
import { tables } from './lib/schemas';

const config = defineZeroConfig({
  db: { mode: './data/app.db' },
  tables,
  auth: true,
});

const app = await createApp(config);
app.listen(config.port ?? 3000);
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
| `zero/auth.ts` | registration, email verification, MFA, auth branding, user metadata, tenancy, avatar config |
| `zero/auth-emails/` | optional auth/account email template overrides, one template per file with `index.ts` as the registry |
| `zero/access.ts` | table/route/storage/action policy helpers |

Future files:

| File | System |
| --- | --- |
| `zero/storage.ts` | drives, file limits, MIME policy, public/private defaults |
| `zero/sync.ts` | sync defaults, lazy/full policy, snapshot limits |
| `zero/observability.ts` | sinks, endpoint access, trace thresholds |
| `zero/ai.ts` | provider aliases, explicit providers, status endpoint |
| `zero/vector.ts` | vector indexes, dimensions, metadata filter fields |
| `zero/pdf.ts` | print defaults, browser path, resource policy, render limits |
| `zero/sitemap.ts` | future sitemap/SEO defaults and route metadata overrides |
| `zero/migrations.ts` | migration safety defaults, doctor strictness, paths |

## Module Contract

Each config file should export a default value produced by a typed helper:

```ts
import { defineAuthConfig } from '@zero/framework/server';

export default defineAuthConfig({
  registration: {
    mode: 'admin-only',
  },
  userProperties: {
    department: {
      type: 'enum',
      values: ['accounting', 'operations'],
      editableBy: 'admin',
      useInPolicies: true,
    },
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
    account: {
      requireEmailVerification: Bun.env.AUTH_REQUIRE_EMAIL_VERIFICATION === 'true',
      emailVerificationPath: Bun.env.AUTH_EMAIL_VERIFICATION_PATH ?? '/verify-email',
    },
    accountEmails: {
      adminCreatedUser: Boolean(Bun.env.RESEND_API_KEY),
      passwordReset: Boolean(Bun.env.RESEND_API_KEY),
      manualPasswordReset: Bun.env.AUTH_MANUAL_PASSWORD_RESET !== 'false',
      actionTokenTTL: Bun.env.AUTH_ACTION_TOKEN_TTL ?? '1h',
      requestCooldown: Bun.env.AUTH_ACCOUNT_EMAIL_COOLDOWN ?? '5m',
    },
    branding: {
      appName: Bun.env.APP_NAME ?? 'Acme CRM',
      logoUrl: Bun.env.APP_LOGO_URL,
      supportEmail: Bun.env.APP_SUPPORT_EMAIL,
      brandColor: Bun.env.AUTH_EMAIL_BRAND_COLOR,
    },
    userProperties: {
      department: {
        type: 'enum',
        values: ['accounting', 'operations'],
        editableBy: 'admin',
        useInPolicies: true,
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
  pdf: Bun.env.ZERO_PDF_ENABLED === 'true'
    ? {
        browser: {
          executablePath: Bun.env.ZERO_PDF_EXECUTABLE_PATH,
        },
      }
    : false,
});
```

### Web auth navigation

Web login navigation is configured at the top level of `AppConfig`, beside the
page-router settings:

```ts
export default defineZeroConfig({
  auth: true,
  routeAuth: 'protected-by-default',
  publicPaths: ['/login', '/register', '/forgot-password'],
  loginPath: '/login',
  postLoginPath: '/dashboard',
});
```

| Path | Default and validation |
|---|---|
| `loginPath` | `/login`; safe local login route used by server and client page guards |
| `registrationPath` | `/register`; safe local registration route, including native browser authorization |
| `postLoginPath` | `/`; safe local fallback after login or an authenticated visit to `loginPath` |

An anonymous protected request is sent to `loginPath` with exactly one encoded,
validated `redirect` return path. A direct server redirect retains pathname and
query. Client navigation can also retain the fragment, which is never sent to
the server. Once the login route is authenticated, a safe return path takes
precedence over `postLoginPath`; navigation replaces the login history entry.

Local auth paths are bounded and reject external or scheme-relative URLs,
backslashes and control characters, malformed encodings, and paths whose
canonical form could become scheme-relative. Duplicate or recursive `redirect`
values are ignored, and trailing slashes are equivalent when comparing the
return target or fallback with `loginPath`. An explicit `postLoginPath`
resolving to the login route is rejected. The legacy combination of
`loginPath: '/'` and an omitted, implicitly `/` post-login path remains a no-op
for authenticated root visits.

`AppProvider` receives the resolved paths through the server-injected platform
config and exposes matching `loginPath` and `postLoginPath` overrides. These are
page-navigation options, not fields under `auth` and not raw `createClient()`
options. `useAuth().isRestoring` is true only while a persisted web session is
being refreshed and `/auth/me` is loading. In browsers with Web Locks, refresh
rotation is serialized per Zero server across tabs and workers; each waiter
rereads the persisted token after acquiring the lock. Without Web Locks, the
fallback coordinates only callers in the same JavaScript realm.

### Native installed-app authentication

Native desktop/mobile clients and Chrome extensions are registered under
`auth.nativeApps`. A non-empty client list enables the OIDC Authorization Code
provider with PKCE and uses `${app.publicUrl}/auth` as its issuer. An explicit
issuer may provide the same canonical `/auth` URL, but the current provider
deliberately rejects a different origin so token audience and authenticated
API requests cannot diverge. Client IDs are publishable and never have
secrets. See
[Desktop, Mobile, and Chrome Extension Authentication](./auth/native-app-auth.md).

Native auth automatically applies per-source admission using Bun's direct
socket peer and ignores spoofed forwarding headers. When Zero is behind a
reverse proxy, set
`auth.nativeApps.requestAdmission.trustedProxyRanges` to the proxy's exact IP
or CIDR ranges. Only then does Zero walk `X-Forwarded-For` from the trusted
socket toward the first untrusted client address. A custom sanitized header can
be selected with `forwardedForHeader`; universal `/0` trust ranges are rejected.
Public client IDs cannot protect shared global/per-client caps, so
multi-replica deployments should additionally rate limit the authorize
endpoint at their shared edge. Zero persists only a
process-pseudonymous HMAC of the resolved source, never the raw identifier.

A production-oriented configuration can make the defaults explicit:

```ts
export default defineZeroConfig({
  app: {
    name: 'Acme',
    publicUrl: 'https://app.acme.example',
  },
  auth: {
    accessTokenTTL: '15m',
    nativeApps: {
      enabled: true,
      // Optional; when present it must normalize to the same public origin.
      issuer: 'https://app.acme.example/auth',
      requestTTL: '15m',
      codeTTL: '3m',
      refreshTokenTTL: '30d',
      clients: [{
        clientId: 'acme-desktop',
        name: 'Acme Desktop',
        redirectUris: [
          'http://127.0.0.1/oauth/callback',
          'http://[::1]/oauth/callback',
        ],
        scopes: ['openid', 'profile', 'email'],
      }],
      requestAdmission: {
        cleanupBatchSize: 100,
        maxOutstandingGlobal: 1_000,
        maxOutstandingPerClient: 100,
        maxOutstandingPerSource: 20,
        rollingWindow: '1m',
        maxAdmissionsGlobal: 300,
        maxAdmissionsPerClient: 60,
        maxAdmissionsPerSource: 20,
        // Set only when the direct peer really is one of these proxies.
        trustedProxyRanges: ['10.0.0.0/8', 'fd00::/8'],
        forwardedForHeader: 'x-forwarded-for',
      },
      refreshRotation: {
        cleanupBatchSize: 100,
        minRotationInterval: '30s',
        maxRotationsPerFamily: 4_096,
        maxActiveFamiliesPerUserClient: 10,
      },
    },
  },
});
```

Do not copy the example proxy ranges unless they exactly describe your network.
A directly exposed Zero process needs no proxy configuration: it safely uses
the Bun socket peer and ignores forwarded headers. A platform whose trusted
edge exposes a non-IP identity may supply `sourceKey(context)` instead, but
`sourceKey` cannot be combined with proxy ranges or `forwardedForHeader`.

#### Native config reference

| Path | Default and validation |
|---|---|
| `auth.nativeApps.enabled` | Defaults to `true` when `clients` is non-empty; explicit `false` disables the provider |
| `auth.nativeApps.issuer` | Optional canonical HTTPS `/auth` issuer, or loopback HTTP in development; must share `app.publicUrl`'s origin |
| `auth.nativeApps.requestTTL` | `15m`; positive duration no greater than 1 hour |
| `auth.nativeApps.codeTTL` | `3m`; positive duration no greater than 10 minutes |
| `auth.nativeApps.refreshTokenTTL` | `30d`; positive duration no greater than 365 days |
| `clients[].clientId` | Required unique public identifier, 1–128 unreserved characters |
| `clients[].name` | Required non-empty trimmed consent-page name |
| `clients[].redirectUris` | Required non-empty unique list of supported native redirects |
| `clients[].scopes` | Defaults to `openid profile email`; only those values are supported and `openid` is required |
| `requestAdmission.cleanupBatchSize` | `100`; integer from 1 through 10,000 |
| `requestAdmission.maxOutstandingGlobal` | `1000`; integer from 1 through 1,000,000 |
| `requestAdmission.maxOutstandingPerClient` | `100`; integer from 1 through 1,000,000 |
| `requestAdmission.maxOutstandingPerSource` | `20`; integer from 1 through 1,000,000 |
| `requestAdmission.rollingWindow` | `1m`; positive duration no greater than 1 day |
| `requestAdmission.maxAdmissionsGlobal` | `300`; integer from 1 through 1,000,000 per rolling window |
| `requestAdmission.maxAdmissionsPerClient` | `60`; integer from 1 through 1,000,000 per client/window |
| `requestAdmission.maxAdmissionsPerSource` | `20`; integer from 1 through 1,000,000 per source/window |
| `requestAdmission.trustedProxyRanges` | Empty; exact IPv4/IPv6 addresses or CIDRs only, with universal `/0` ranges rejected |
| `requestAdmission.forwardedForHeader` | `x-forwarded-for`; a custom value requires at least one trusted proxy range |
| `requestAdmission.sourceKey` | Default safe socket-peer resolver; custom callback is mutually exclusive with proxy options |
| `refreshRotation.cleanupBatchSize` | `100`; integer from 1 through 10,000 |
| `refreshRotation.minRotationInterval` | `30s`; may be `0s`, maximum 1 hour |
| `refreshRotation.maxRotationsPerFamily` | `4096`; integer from 1 through 100,000; exhausted families are revoked |
| `refreshRotation.maxActiveFamiliesPerUserClient` | `10`; integer from 1 through 1,000; oldest excess family is evicted |

All duration strings use an integer followed by `s`, `m`, `h`, or `d`. Native
refresh lifetime is separate from the normal web `auth.refreshTokenTTL`.
Native access tokens use the normal `auth.accessTokenTTL` (15 minutes by
default), the exact app origin as audience, and the same managed ES256 signing
key as the rest of Zero auth.

#### Native redirect and lifecycle configuration

Supported redirect classes are exact claimed HTTPS URLs, reverse-domain
private-use schemes using the single-slash form, and IP-literal HTTP loopback.
Only a desktop loopback port may vary between registered and requested URLs.
Fragments, credentials, duplicate query keys, reserved response query keys,
`localhost` callbacks, non-loopback HTTP, and wildcard Chrome callbacks are
rejected.

The external browser uses `loginPath` and `registrationPath`, which default to
`/login` and `/register`. Zero derives the standard auth lifecycle pages into
`publicPaths`; if the app supplies `publicPaths` explicitly, that list is
authoritative and must include every custom login, registration, verification,
forgot/reset, and setup-password path. Native registration still obeys
`auth.registration`, verification obeys `auth.account`, and MFA obeys
`auth.mfa`.

Sign out installed clients before changing their server URL, client ID,
redirect strategy, or credential namespace. The generic native SDK derives
storage from issuer/client, so changing either without signing out can leave an
old server family active. The Chrome preview additionally binds server, client,
persistence, and namespace behind one extension-global marker and rejects an
unsafe in-place change.

#### Doctor, migration, and deployment

Run:

```sh
bun run doctor -- --config ./zero.config.ts --strict
```

Doctor reports missing/invalid public origins, split issuer/API origins,
enabled providers without clients, malformed/duplicate clients, unsupported
identity scopes, invalid TTLs, unsafe redirects, and malformed or ambiguous
proxy admission policy.

`createApp()` runs the platform migration registry by default for durable
databases. Native auth uses migrations `005` and `006`; the hardening migration
requires a guarded backup and the migrator snapshots hot/WAL-backed state
safely. For an existing deployment, review and back up the correct database
before startup. `zero update` updates framework dependency artifacts only and
never chooses or runs an application migration command.

At a reverse proxy or ingress, preserve the canonical HTTPS origin and configure
only proxy ranges Zero actually sees as its direct peer. Apply shared edge rate
limits if more than one process accepts native authorization. Keep the auth
signing key and database lifecycle stable under the same production practices
as web auth. After deployment, verify the discovery document at
`/auth/.well-known/openid-configuration`, then exercise browser registration,
MFA/recovery, callback, rotation, revocation, protected HTTP, and Sync on real
targets.

Richer auth behavior should keep the same protocol and can move into
`zero/auth.ts` instead of growing inline `createApp()` config:

```ts
import {
  defineAuthConfig,
  defineAuthEmailTemplates,
} from '@zero/framework/server';
import { authEmailTemplates } from './auth-emails';

export default defineAuthConfig({
  account: {
    requireEmailVerification: Bun.env.AUTH_REQUIRE_EMAIL_VERIFICATION === 'true',
    emailVerificationPath: '/verify-email',
  },
  mfa: {
    enabled: Bun.env.AUTH_MFA_ENABLED === 'true',
    policy: Bun.env.AUTH_MFA_POLICY ?? 'optional',
    methods: parseList(Bun.env.AUTH_MFA_METHODS, ['email', 'totp']),
    allowUserChoice: true,
    allowMultipleMethods: false,
    recoveryCodes: false, // reserved for a later recovery-code flow
    totp: {
      // Authenticator/TOTP is self-hosted by Zero. Issuer defaults to app.name.
      encryptionKey: Bun.env.AUTH_TOTP_ENCRYPTION_KEY,
      qrRobustness: 'M',
    },
  },
  branding: {
    appName: Bun.env.APP_NAME,
    logoUrl: Bun.env.APP_LOGO_URL,
    supportEmail: Bun.env.APP_SUPPORT_EMAIL,
    brandColor: Bun.env.AUTH_EMAIL_BRAND_COLOR,
  },
  emails: defineAuthEmailTemplates(authEmailTemplates),
});
```

`zero/auth-emails/` is optional. Current account setup and password reset
emails render branded defaults using `app.name`, `app.publicUrl`, logo URL,
support email, and brand color. When app overrides are present, each template
should live in its own file and `index.ts` should only compose the registry:

```ts
// zero/auth-emails/index.ts
import { defineAuthEmailTemplates } from '@zero/framework/server';

import { passwordResetEmail } from './password-reset';

export const authEmailTemplates = defineAuthEmailTemplates({
  passwordReset: passwordResetEmail,
});
```

```ts
// zero/auth-emails/password-reset.ts
import type { AuthEmailTemplate } from '@zero/framework/server';

export const passwordResetEmail: AuthEmailTemplate = (ctx) => ({
  subject: `Reset your ${ctx.branding.appName} password`,
  text: ctx.defaultText,
  html: ctx.defaultHtml,
});
```

Active template keys today are `accountSetup`, `passwordReset`, and
`emailVerification` and `emailOtp`. Reserved typed keys for upcoming
account-notice slices include `passwordChanged`, `mfaEnabled`, `mfaDisabled`,
and `recoveryCodesRegenerated`. MFA setup and login challenge routes are active
when `AUTH_MFA_ENABLED=true`.

Recovery-code storage is reserved for a later MFA slice. Leave
`auth.mfa.recoveryCodes` false until the recovery-code generation and
verification routes ship.

Relevant environment variables are shown in `.env.example`:

| Variable | Used for |
| --- | --- |
| `APP_NAME` | App display name in system email. |
| `APP_PUBLIC_URL` | Public origin used to build reset/setup links. Required for account email. |
| `APP_LOGO_URL` | Optional logo used by auth pages and branded system email. |
| `APP_SUPPORT_EMAIL` | Optional support/reply identity. |
| `AUTH_EMAIL_BRAND_COLOR` | Optional default accent color for branded auth email. |
| `EMAIL_FROM` | Default sender for platform email. |
| `EMAIL_REPLY_TO` | Optional reply-to address. |
| `RESEND_API_KEY` | Enables the default Resend email provider. |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Require email verification before public-registered users receive tokens. |
| `AUTH_EMAIL_VERIFICATION_PATH` | Public page path used in email verification links. Defaults to `/verify-email`. |
| `AUTH_MFA_ENABLED` | Enables first-party MFA setup and login challenges. |
| `AUTH_MFA_POLICY` | MFA policy: `optional`, `required`, or `admin-required`. |
| `AUTH_MFA_METHODS` | Comma list such as `email,totp`. |
| `AUTH_TOTP_ENCRYPTION_KEY` | Encryption key for self-hosted authenticator/TOTP secrets at rest. Required once TOTP enrollment is enabled. |
| `AUTH_ACTION_TOKEN_TTL` | Expiration for setup/reset/verification action tokens. |
| `AUTH_ACCOUNT_EMAIL_COOLDOWN` | Cooldown between active setup/reset/verification emails for the same user and token type. |
| `AUTH_MANUAL_PASSWORD_RESET` | Set to `false` to disable direct admin password replacement and require email-driven reset flows. |
| `ACCESS_TOKEN_TTL` | Access token lifetime. |
| `REFRESH_TOKEN_TTL` | Refresh token lifetime. |
| `AUTH_SIGNING_KEY` | Optional externally managed ES256 private JWK as raw JSON or base64; PEM is not supported. Missing `kid` is derived deterministically from the public key. |
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

Generic platform action/resume tokens do not require environment variables.
They are mounted by `createApp()` and use per-call TTL/cooldown options. Auth
setup/reset email flows still read `AUTH_ACTION_TOKEN_TTL` and
`AUTH_ACCOUNT_EMAIL_COOLDOWN` for their action-token defaults.

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

## Sitemap

Zero can serve a request-time `sitemap.xml` from the file router. Enable it in
the app config:

```ts
import { defineZeroConfig } from '@zero/framework/server';

export default defineZeroConfig({
  app: {
    name: 'Acme CRM',
    publicUrl: 'https://crm.example.com',
  },
  db,
  tables,
  auth: true,
  routeAuth: 'explicit',
  sitemap: {
    enabled: true,
    changefreq: 'weekly',
    priority: 0.7,
    entries: [
      {
        href: '/blog/launch-notes',
        lastmod: '2026-07-01',
        changefreq: 'monthly',
        priority: 0.8,
      },
    ],
    exclude: ['/login', '/forgot-password', '/reset-password'],
  },
});
```

Behavior:

1. `sitemap: true` mounts `/sitemap.xml` with safe defaults.
2. Static public `page.tsx` routes are discovered automatically.
3. Route groups such as `(marketing)` do not appear in URLs.
4. API routes, dynamic routes such as `[slug]`, catch-all routes, and protected
   page/layout branches are omitted by default.
5. Dynamic content belongs in `entries`, where the app can provide concrete
   URLs from its own content model.
6. `exclude` removes matching paths and child paths even when the route is
   otherwise public.

`app.publicUrl` is used for absolute `<loc>` values. If it is not set, Zero
falls back to the request origin, which is useful in local development but less
predictable behind production proxies.

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
bun run doctor -- --config ./zero.config.ts --json
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
9. Auth-enabled app tables not covered by an app `syncPolicy` or registered
   resource policy.
10. Login, registration, verification, reset, and setup route access when
    protected-by-default auth uses an explicit `publicPaths` list.
11. Lazy/auto sync index guidance for `/api/data` filters and sorting.
12. Observability disabled in production, unreadable endpoint policy, and
    endpoint/store mismatches.
13. AI provider readiness, custom OpenAI-compatible base URLs, aliases,
    capability mismatches, and status endpoint access policy.
14. Vector path collisions, storage/build-output path overlap, read-only
    indexes, unusually high dimensions, embedding alias readiness, and
    unindexed scope metadata fields.
15. Resource registration and policy shape: missing tables, primary-key
    mismatches, missing owner columns, untrusted metadata keys, auth-disabled
    protected resources, missing list policies, custom list policy scope, public
    or uninspectable write policies, and owner-field index guidance.
16. App source usage audit: raw controls instead of Zero UI primitives, custom
    modal/toast/sidebar systems, missing app root providers, direct
    package/internal imports, direct backend provider usage, backend `console`
    calls, and files above the responsibility threshold.
17. Native app auth issuer/public URL readiness, registered public clients,
    identity scopes, lifetimes, and desktop/mobile redirect safety.

Usage-audit options:

```txt
bun run doctor -- --config ./zero.config.ts --no-usage-audit
bun run doctor -- --config ./zero.config.ts --max-file-lines 400
bun run doctor -- --config ./zero.config.ts --usage-include app --usage-include server
bun run doctor -- --config ./zero.config.ts --usage-exclude app/vendor/**
```

When an app creates non-unique indexes through migrations or startup
compatibility code, declare them so Doctor can distinguish real index gaps from
indexes it cannot infer from the table schema:

```ts
export default defineZeroConfig({
  // ...
  doctor: {
    indexedFields: {
      tickets: ['owner_id'],
    },
  },
});
```

This is a diagnostic hint only. The app still needs to create the actual SQLite
index with a migration or intentional startup compatibility code.

The default scan roots are app-owned code: `app/`, configured `server/*`
extension directories, `components/`, `hooks/`, and `lib/`. Doctor skips
`node_modules`, `.zero`, `.build`, `dist`, generated files, tests, and vendored
source by default.

Future config-file doctor checks should validate:

1. Missing referenced config files.
2. Unsupported keys or field types.
3. Invalid metadata values.
4. Conflicting inline and file config.
5. Authz metadata marked user-writable.
6. Tenancy configured without matching table columns/policies.
7. Storage/avatar config without storage support.
8. Loading conventional app-owned policy/resource files directly in doctor when
   a config module relies only on `server/resources`.
9. Email verification or email OTP enabled without ready email config.
10. Authenticator/TOTP enabled without an encryption key.
11. MFA required with no enabled method.
12. Auth branding values that point at missing local assets in generated apps.

## Rollout Plan

1. Implement the protocol for `zero.auth.ts` and `zero.access.ts`.
2. Add templates and docs for those files.
3. Add effective config endpoint for admin UI.
4. Build adaptive admin UI against the effective config.
5. Move storage/sync/observability/migration config to the same protocol after
   auth/access proves the shape.

Do not refactor every `createApp()` option at once. Start with auth/access,
then migrate other systems one at a time.
