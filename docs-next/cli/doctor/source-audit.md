---
id: zero.doctor.source-audit
type: reference
audience: [developer, agent, operator]
owner: doctor
status: draft
visibility: internal
system: doctor
feature: source-audit
maturity: supported
applies_to: ["2.6.0 source; structured-modal/source-only upgrade unreleased"]
modes: ["AST source-only inspection", "configuration-backed usage heuristics"]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "1b5a1fa0281deba69b3809471d2467d596516e4b"
  snapshot: dirty
  date: "2026-10-08"
  evidence_level: source-observed
---

# Source-Only Inspection And Scoped Migration Review

[Doctor index](./index.md) · [Documentation index](../../index.md)

Doctor has two source paths. **The structured-modal upgrade is an unreleased
source baseline**, not a claim that an older installed framework already exposes
the new facade.

- `runSourceOnlyDoctor` uses TypeScript's parser for targeted modal/import/native
  nesting checks. It does not discover or import app configuration, initialize
  services/plugins, read `.env`, open databases, or execute app/package source.
- `runUsageAudit` retains the existing configuration-backed heuristics described
  below. Ordinary `zero doctor --config …` still executes trusted configuration
  and can inspect selected existing infrastructure.

## Source-Only Command And API

```sh
zero doctor --source-only --project-root . --json
```

The root is required; it is never silently derived from executable config.
`--config` and `--no-usage-audit` cannot be combined with this mode. Repeatable
`--usage-include`, `--usage-exclude`, `--max-file-lines`, `--strict` and `--json`
remain available. Includes replace convention roots; excludes append to defaults.

Bun may load environment files **before any CLI code executes**. The source-only
child launched by Zero explicitly uses `--no-env-file`, but that cannot undo an
outer process's environment loading. To disable loading in the initial Bun
process as well, run the installed declared CLI script deliberately:

```sh
bun --no-env-file ./node_modules/@zero/framework/src/cli/run.ts doctor \
  --source-only --project-root . --json
```

Programmatic example, with no app-config import:

```ts
import { runSourceOnlyDoctor } from "@zero/framework/doctor";

const report = await runSourceOnlyDoctor({
  projectRoot: "/explicit/application-directory",
  include: ["app", "components"],
  exclude: ["components/vendor/**"],
  strict: true,
  allow: [{ code: "usage.modal.direct_primitive", path: "components/managed-special/**" }],
});
```

The async report includes `mode: "source-only"`, `scannedFiles`, `findings`, `ok`
and `installedFramework`. Default roots are `app`, `src`, `components`, `hooks`,
`lib` and `server`; this mode deliberately does not import config to discover
custom directories. List those explicitly. The scanner reads source through
Bun's file/glob APIs. Canonical path checks reject file symlinks escaping an
admitted root. It does not follow directory symlinks during a walk; an explicitly
included directory alias is admitted as its canonical root. External source
directories are allowed only when explicitly included. Default exclusions cover
test/spec/declaration/generated/vendor files and hard-excluded build, runtime,
cache, repository and dependency directories. Files above 2 MB are skipped with
a coverage warning. Scan/read/parse failures are reported, not called successful.

## Structured Modal Migration

The AST recognizes literal imports, import aliases, namespace access, multiline
calls and local literal descriptors. Comments and strings are not calls. Unknown
wrappers, dynamic descriptors and spreads do not prove a required-field failure;
recognizable uncertainty is labeled for manual review. This is not a project
typechecker or an inter-file data-flow analysis.

| Finding codes | Meaning / default disposition |
| --- | --- |
| `usage.modal.legacy_open` | Legacy string-ID API remains compatible; migration is recommended only when the inspected package exposes `modals.show` |
| `usage.modal.unavailable_show` | A known installed legacy facade lacks `show`; required correction |
| `usage.modal.title_required` | Local effective descriptor definitely lacks a nonempty visible title; required correction |
| `usage.modal.unsupported_option`, `invalid_option`, `mixed_layout`, `sections_required` | Recognizable literal contract/layout-shape errors; required correction |
| `usage.modal.motion_option`, `motion_value`, `motion_pace` | Literal motion option/preset/type/range errors; `durationMultiplier` is 0.5–2.5 and replaces ambiguous `speed` |
| `usage.modal.dynamic_descriptor`, `dynamic_title`, `dynamic_option` | Unknown descriptor/spread behavior; manual review, informational |
| `usage.modal.direct_primitive`, `custom_frame` | Direct dialog primitives or manual dialog frames need manager/shell integration review; not proof of broken visuals |
| `usage.modal.nested_interactive` | Native button/link wrapping another native control; restructure as a semantic row with separate controls |
| `usage.import.private_zero`, `missing_export` | Recognizable private alias or unavailable installed package subpath; required correction |
| `usage.source.package_unknown` | Installed capability could not be established; no newer API is assumed available |
| `usage.source.root_invalid`, `outside_root`, `parse_failed`, `read_failed`, `scan_failed`, `file_too_large` | Root/coverage problems; resolve before claiming complete inspection |

Source findings add optional `line`, `category` (`required`, `recommended`,
`manual-review`) and `confidence` (`high`, `medium`, `low`) fields without changing
existing configuration findings. Severity still controls exits: errors fail;
warnings also fail under strict; info does not. A category is an action-review
classification, not a second exit policy. Confidence describes the static evidence,
not certainty that the whole app is correct.

The selected app's installed `node_modules/@zero/framework/package.json` and
public export targets determine version/capability advice. A directly selected
framework workspace is labeled `workspace`; missing/unreadable metadata or
unrecognized compiled facade shapes remain unknown. The inspector parses public
export targets without executing them. It does not infer availability from the
Doctor process's version alone. Exact export denials take precedence over wildcard
allowances. An app-owned `#zero` alias targeting its own source is distinguished
from a copied framework-private mapping.

Do not mechanically rename `open` to `show`: the former returns a string ID and
accepts content; the latter returns an owned result handle and a structured
descriptor. Review save acknowledgment, close guards, nested ownership and scopes
using the [modal migration guide](../../frontend/modals/migration.md).

Static inspection cannot prove header placement, clipping, scroll behavior,
animation quality, focus trapping, portal layering or accessibility. It performs
no automatic rewrites and does not certify migration completion; follow it with
focused component/runtime tests and visual checks where those are affected.

## Existing Configuration-Backed Usage Heuristics

`runUsageAudit` heuristically reads app-owned TypeScript/JavaScript source.
It returns Doctor-compatible findings; it does not execute business handlers or
prove AST-level correctness. Its CLI configuration-loading stage is separate
and still executes trusted code.

Default scan roots are the configured app/server plugin/middleware/endpoint/
route/resource directories plus components, hooks and lib. A nonempty include
list replaces them. Always-excluded segments include .git, .zero, .build,
.storage, coverage, dist and node_modules. Default patterns additionally exclude
test/spec/declaration/generated/vendor files; caller excludes append.

### Heuristic Rule Families

| Codes | Intent |
| --- | --- |
| usage.frontend.raw_button/raw_input/raw_textarea/raw_select/raw_table | prefer reusable Zero controls |
| usage.frontend.custom_modal/custom_toast/direct_lucide/internal_animate_ui | use the public shared presentation boundary |
| usage.frontend.custom_data_fetch/custom_sync_socket/local_auth_storage | use authenticated SDK/session/Sync transports |
| usage.import.legacy_platform_alias/framework_internal | avoid legacy/private imports |
| usage.backend.direct_sqlite/direct_resend/direct_ai_sdk/direct_zvec/direct_jwt/console | use scoped platform services and standard observability |
| usage.frontend.app_provider_missing/theme_provider_missing/toaster_missing | root wiring heuristic |
| usage.backend.auth_stop_barrier_missing | standalone auth composition needs awaited stop joining |
| usage.structure.large_file | review mixed responsibilities above default 400 lines |

Rules search matching source lines; comments beginning with // are skipped in
ordinary per-line rules. False positives/negatives are possible. A trusted
exception does not imply ordinary browser/server code has new unsafe access.

## Paths And Exceptions

Literal patterns match an exact relative path or directory prefix. * matches
within one segment; ** spans directories; **/ admits zero or multiple
directories. Both audit paths retain scoped code/path exceptions and caller
severity overrides. Invalid source-only project-root and escaped-root findings
cannot be suppressed into an apparently valid scan.

Complete options value example:

```ts
import type { UsageAuditOptions } from "@zero/framework/doctor";

export const usagePolicy = {
  include: ["app", "server", "components"],
  exclude: ["server/vendor/**"],
  maxFileLines: 400,
  rules: { "usage.backend.console": "error" },
  allow: [{ code: "usage.frontend.raw_button", path: "components/specialized/**" }],
} satisfies UsageAuditOptions;
```

An allow entry suppresses only its matching code/path after scanning; path line
suffixes are removed before matching. Record why the app needs that exception.
Do not turn off whole families just because one specialized file requires them.

## Verification And Related Guides

Source-only tests use disposable synthetic source/package/config fixtures,
including a config that would write a marker if evaluated. They exercise aliases,
namespaces, installed legacy/current/missing capabilities, parser failures,
roots/exclusions/exemptions, strict exits and config-free CLI execution. This
dirty source baseline is not installed-package or production-app qualification.
[Options](./configuration.md#sourceonlydoctoroptions), [CI](./usage.md) and
[agent conventions](../../agents/tooling/building-conventions.md) connect source
rules to real platform APIs; backend authority still requires integration tests.
