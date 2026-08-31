# Doctor Usage Audit Plan

Zero Doctor should catch two classes of problems:

1. Platform correctness problems: invalid config, unsafe auth/sync/storage
   policy, missing indexes, provider readiness, migration drift, etc.
2. Platform usage problems: app code bypasses Zero-provided components,
   hooks, services, or conventions and makes the app harder to maintain.

This plan covers the second class. The goal is to give agents immediate,
file/line feedback when they build outside Zero's intended API surface.

## Implementation Status

Implemented:

- Source scanner infrastructure in `src/doctor/usage-audit.ts`.
- Doctor CLI integration with default usage audit, `--no-usage-audit`,
  `--max-file-lines`, `--usage-include`, and `--usage-exclude`.
- First-slice frontend/backend usage checks and
  `usage.structure.large_file`.
- App-wide root wiring checks for `AppProvider`, `ThemeProvider`, and
  `Toaster`.
- Focused usage-audit tests.

Still planned:

- Route/auth/validation heuristics after false-positive review.
- Config-file suppression and per-rule tuning beyond CLI options.

## Goals

- Detect obvious cases where an app recreated something Zero already provides.
- Report stable finding codes with file and line locations.
- Keep findings warnings by default so local work is not blocked.
- Let `--strict` fail CI/agent hooks when warnings should stop a run.
- Keep the scanner heuristic and explainable; do not pretend static text
  matching proves all behavior.
- Avoid scanning framework internals by default. The audit targets app-owned
  code such as `app/`, `server/`, `components/`, `hooks/`, and `lib/`.
- Make findings actionable with hints and docs links.

## Non-Goals

- Do not replace TypeScript, ESLint, or tests.
- Do not build a full AST linter in the first slice.
- Do not ban all raw Elysia/Radix/native HTML use. Zero has escape hatches.
  Doctor should warn and explain preferred Zero surfaces.
- Do not scan `src/` framework internals when doctor is run against the Zero
  framework repo unless explicitly configured.

## Architecture

Add a separate usage-audit module:

```txt
src/doctor/
  platform-doctor.ts       # existing config/runtime diagnostics
  usage-audit.ts           # app source scanner and rule definitions
  usage-audit.test.ts      # focused source scanning tests
```

`usage-audit.ts` owns file discovery, source scanning, rule matching, and
finding construction. `platform-doctor.ts` should call it only through a small
integration point so the existing config checks do not become a mixed
responsibility file.

## Doctor Options

Extend doctor options without breaking current programmatic usage:

```ts
interface PlatformDoctorOptions {
  strict?: boolean;
  env?: Record<string, string | undefined>;
  projectRoot?: string;
  usageAudit?: boolean | UsageAuditOptions;
}
```

CLI behavior:

- `zero doctor --config ./zero.config.ts` runs usage audit by default.
- `zero doctor --config ./zero.config.ts --no-usage-audit` disables source
  scanning.
- `zero doctor --config ./zero.config.ts --json` includes usage findings in the
  same `findings` array.
- `zero doctor --config ./zero.config.ts --strict` fails on warnings, including
  usage warnings.

Default scan roots:

- `config.appDir` or `./app`
- `config.serverPluginsDir`
- `config.serverMiddlewareDir`
- `config.serverEndpointsDir`
- `config.serverRoutesDir`
- `config.serverResourcesDir`
- `./components`
- `./hooks`
- `./lib`
- `./src` only when explicitly configured outside the framework repo

Default excludes:

- `node_modules`
- `.zero`
- `.build`
- `dist`
- `coverage`
- tests/spec files unless explicitly included
- generated files
- framework-owned `src/` when running in the Zero framework checkout

## Finding Shape

Use existing `PlatformDoctorFinding`:

```ts
{
  severity: 'warning',
  code: 'usage.frontend.raw_button',
  path: 'app/page.tsx:42',
  message: 'Native <button> used in app UI where Zero Button is usually preferred.',
  hint: 'Import Button from @zero/framework/components/ui/button unless this native button is deliberate.',
  docs: './docs/frontend/component-inventory.md#base-primitives'
}
```

`path` should include `file:line` for source findings.

## Frontend Usage Rules

### Raw HTML Controls

Warn when app/shared frontend code uses native controls that Zero provides:

| Code | Pattern | Prefer |
| --- | --- | --- |
| `usage.frontend.raw_button` | `<button` | `Button` |
| `usage.frontend.raw_input` | `<input` | `Input`, `PasswordInput`, form renderer |
| `usage.frontend.raw_textarea` | `<textarea` | `Textarea` |
| `usage.frontend.raw_select` | `<select` | Zero `Select` |
| `usage.frontend.raw_table` | `<table` near app data | `DataTableView`, `DataTable`, `MasterDetailView` |

These should be warnings, not errors. Native elements can be deliberate for
accessibility or extremely small views, but the default app path should use
Zero primitives.

### Custom UI Systems

Warn when code appears to recreate shared UI infrastructure:

| Code | Pattern | Prefer |
| --- | --- | --- |
| `usage.frontend.custom_modal` | raw `@radix-ui/react-dialog`, `<dialog>`, fixed overlay/modal state patterns | Zero modal manager or Zero dialog components |
| `usage.frontend.custom_toast` | direct `sonner` import in app UI | Zero-themed `Toaster` and exported toast surface |
| `usage.frontend.custom_sidebar` | raw sidebar/menu layout when AppShell would fit | `AppShell` or Zero sidebar primitives |
| `usage.frontend.custom_data_fetch` | direct `fetch('/api/data')` in React UI | `useDataPage`, `useLazyCollection`, DataTable source |
| `usage.frontend.custom_sync_socket` | `new WebSocket('/sync')` | `AppProvider`, sync client, collection hooks |
| `usage.frontend.local_auth_storage` | local/session storage auth token handling | Zero AuthClient/AppProvider |

### Imports That Bypass Public APIs

Warn or error depending on severity:

| Code | Pattern | Severity | Prefer |
| --- | --- | --- | --- |
| `usage.import.legacy_platform_alias` | `@platform/*` in package-mode app code | warning | `@zero/framework/*` |
| `usage.import.framework_internal` | `@zero/framework/src/*`, `node_modules/@zero/framework/src/*`, or relative imports into framework source | warning/error later | public package exports |
| `usage.frontend.direct_lucide` | `lucide-react` imports | warning | `@zero/framework/icons` |
| `usage.frontend.internal_animate_ui` | direct internal Animate UI paths | warning | promoted Zero component/icon exports |

### Missing Root Wiring

Warn when the app uses Zero client hooks/components but root wiring is missing:

| Code | Pattern | Prefer |
| --- | --- | --- |
| `usage.frontend.app_provider_missing` | app uses `useCollection`, `useAuth`, etc. but `app/layout.tsx` has no `AppProvider` | add `AppProvider` |
| `usage.frontend.theme_provider_missing` | app uses Zero UI but no `ThemeProvider` | add `ThemeProvider` |
| `usage.frontend.toaster_missing` | app uses toast/auth flows but no `Toaster` | mount Zero `Toaster` |

These checks should be conservative and look at the whole app, not one file.

## Backend Usage Rules

### Direct Platform Primitive Bypasses

Warn when backend app code uses direct libraries where Zero has a service:

| Code | Pattern | Prefer |
| --- | --- | --- |
| `usage.backend.direct_sqlite` | `bun:sqlite`, `new Database()` | `zero.db` or `zero.sql` |
| `usage.backend.direct_resend` | `resend`, `nodemailer` | `zero.email` / email provider boundary |
| `usage.backend.direct_ai_sdk` | `ai`, `@ai-sdk/*` in app route code | `zero.ai` |
| `usage.backend.direct_zvec` | `@zvec/zvec` in app route code | `zero.vector` |
| `usage.backend.direct_jwt` | `jsonwebtoken`, direct `jose` signing/verifying in app routes | Zero auth/token services |
| `usage.backend.direct_storage_fs` | app upload/storage route writes files directly | `zero.storage` |
| `usage.backend.console` | `console.log/warn/error` in app server code | `zero.observability` |
| `usage.backend.auth_stop_barrier_missing` | direct public `createAuthPlugin()` composition without an invoked stop barrier | wrap the final app with `installAuthStopBarrier()` |

These are warnings because custom adapters and specialized routes are valid,
but app code should be nudged back to platform services.

### Route And Policy Shape

Warn for patterns that often mean an agent skipped Zero backend helpers:

| Code | Pattern | Prefer |
| --- | --- | --- |
| `usage.backend.raw_elysia_route` | `new Elysia()` in app route folders | `defineRouter`, `defineEndpoint`, or named plugin |
| `usage.backend.route_missing_validation` | POST/PATCH/PUT endpoint has no obvious `body` schema | Elysia validation with `t.Object` |
| `usage.backend.write_route_auth_unknown` | POST/PATCH/DELETE route has no obvious auth/policy check | `auth: 'user'`, resource policy, or explicit guard |
| `usage.backend.resource_candidate` | repeated CRUD routes over one table | `defineResource` and generated CRUD |

These require careful heuristics and should start as opt-in or low-confidence
warnings if false positives are likely.

## Structure And Responsibility Rules

Some problems are not about a specific API misuse. They are signs that an
agent created a file that is too broad to review safely or likely mixes
responsibilities.

| Code | Pattern | Prefer |
| --- | --- | --- |
| `usage.structure.large_file` | app-owned source file exceeds the configured line threshold, default `400` lines | split by responsibility into service, schema/model, view, hook, mapper, or helper files |

Doctor should report the file location and line count:

```ts
{
  severity: 'warning',
  code: 'usage.structure.large_file',
  path: 'app/launchboard/page.tsx:1',
  message: 'app/launchboard/page.tsx has 487 lines, above the 400-line responsibility threshold.',
  hint: 'Review this file for mixed responsibilities. Split UI, data hooks, schema, mappers, route handlers, and services into focused files.'
}
```

The first implementation can count physical lines. Later it can ignore blank
lines and comments if the simple count becomes noisy. The rule should use the
same include/exclude paths as the usage audit and should skip generated files,
lockfiles, markdown docs, and vendored examples by default.

The threshold should be configurable:

```ts
doctor: {
  usageAudit: {
    maxFileLines: 400,
    rules: {
      'usage.structure.large_file': 'warning',
    },
  },
}
```

This warning should not claim the file is definitely wrong. It should tell the
user or agent to inspect it for mixed responsibilities, which matches Zero's
separation-of-responsibility rule without creating a rigid hard cap.

## Severity Policy

Initial severities:

- Most usage findings: `warning`
- Missing provider/root wiring: `warning`
- Large source files above the responsibility threshold: `warning`
- Internal framework import: `warning` initially, possible `error` later
- Config/security correctness remains existing doctor behavior

`--strict` fails on warnings, which makes this useful for Codex/Claude hooks
without making casual local development hostile.

## Suppression And Configuration

Add a suppression mechanism after the first scanner slice:

```ts
doctor: {
  usageAudit: {
    enabled: true,
    include: ['app', 'server', 'components', 'hooks', 'lib'],
    exclude: ['app/vendor/**'],
    rules: {
      'usage.frontend.raw_button': 'warning',
      'usage.structure.large_file': 'warning',
      'usage.backend.console': 'off',
    },
    allow: [
      { code: 'usage.backend.direct_ai_sdk', path: 'server/plugins/custom-ai-provider.ts' },
    ],
  },
}
```

If adding `doctor` to `AppConfig` is too much for the first slice, start with
CLI-only `--no-usage-audit` and add config later.

## Agent Hook Usage

After an agent run:

```sh
zero doctor --config ./zero.config.ts --json --strict
```

The hook should parse `findings` and feed the relevant warnings back to the
agent:

```txt
Doctor found usage.frontend.raw_select at app/settings/page.tsx:88.
Use Zero Select from @zero/framework/components/ui/select.
Docs: ./docs/frontend/component-inventory.md#base-primitives
```

This is the core feedback loop: agents learn when they failed to use Zero.

## Implementation Phases

### Phase 1: Scanner Infrastructure

- Add `src/doctor/usage-audit.ts`.
- Add source file discovery with include/exclude roots.
- Add line-based matcher helpers.
- Add rule definitions with stable codes, docs, and hints.
- Add `src/doctor/usage-audit.test.ts`.
- Cover raw frontend controls, internal imports, direct backend services, and
  console usage first.

### Phase 2: Doctor Integration

- Extend `PlatformDoctorOptions` with `projectRoot` and `usageAudit`.
- CLI derives `projectRoot` from the config module directory.
- CLI supports `--no-usage-audit`.
- Human output displays `file:line` paths through existing finding output.
- JSON output includes usage findings in the same array.

### Phase 3: Root Wiring And Context Rules

- Add app-wide checks for missing `AppProvider`, `ThemeProvider`, and `Toaster`.
- Add route/auth/validation heuristics after early false-positive review.
- Add suppression/config options if needed.

### Phase 4: Docs And Agent Integration

- Update `docs/start-here.md`, `docs/framework/README.md`,
  `docs/platform-configuration.md`, `docs/stabilization-plan.md`, and
  `llms.txt`.
- Add a “Doctor Usage Audit” section showing how Codex/Claude hooks should run
  doctor and feed warnings back to the agent.
- Add package-mode starter guidance that doctor checks Zero usage, not only
  config correctness.

### Phase 5: Verification

- `bun test src/doctor/usage-audit.test.ts src/doctor/platform-doctor.test.ts`
- `bun run test:package`
- `bun run typecheck`
- `bun run build`
- `bun test`
- `git diff --check`

## First-Slice Rule Set

Implement these first because they are high-signal and easy to explain:

- `usage.frontend.raw_button`
- `usage.frontend.raw_input`
- `usage.frontend.raw_textarea`
- `usage.frontend.raw_select`
- `usage.frontend.custom_modal`
- `usage.frontend.custom_toast`
- `usage.frontend.direct_lucide`
- `usage.import.legacy_platform_alias`
- `usage.import.framework_internal`
- `usage.structure.large_file`
- `usage.backend.direct_sqlite`
- `usage.backend.direct_resend`
- `usage.backend.direct_ai_sdk`
- `usage.backend.direct_zvec`
- `usage.backend.direct_jwt`
- `usage.backend.console`
- `usage.backend.auth_stop_barrier_missing`

Then add root wiring and route-shape heuristics after the first pass is tested
against LaunchBoard and at least one generated package-mode app.
