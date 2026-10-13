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
applies_to: ["2.6.0 working source; modal, backing-theme and versioned upgrade/chart source inspection"]
modes: ["AST source-only inspection", "configuration-backed usage heuristics"]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "645295dd1300164d31df52e80509eaff9f6903ee"
  snapshot: dirty
  date: "2026-10-13"
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
  upgrade: true,
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
| `usage.modal.controlled_close_bypass` | A managed interaction calls its exact controlled open-state callback with literal false; recommended, high-confidence warning |
| `usage.modal.close_retirement` | An interaction uses public disposal or bulk-close APIs; manual-review, medium-confidence warning, possibly deliberate teardown |
| `usage.modal.close_flow_review` | A controlled guard delegates to an unresolved controller and then always refuses dismissal; manual-review, low-confidence info, not proof of an incorrect controller |
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

## Managed Close Lifecycle

The source-only modal pass now checks the distinction between ordinary closing
and authoritative retirement. These checks do not require `--upgrade`; they run
when the selected installed facade establishes structured `modals.show` support.
Missing, older or unknown capability does not produce newer-facade close advice.

`ControlledModal` treats owner-driven `open=false`, identity replacement and
unmount as retirement. A normal Cancel/X/Escape, deliberate discard or acknowledged
save must instead use the exact managed opening's close path. Otherwise its
origin exit can be skipped even though its entrance looked correct. Use native
`role: 'cancel'` actions, a `beforeClose` predicate that returns its admission
decision, and acknowledged action results or `context.accept(value)`. Leave
`onOpenChange` to the adapter's settlement notification; do not call it from the
guard or save/cancel interaction merely to close the dialog.

The checker recognizes public `ControlledModal` and `modals.show`, named and
namespace aliases, effective local literal descriptors, immutable local callback
aliases, React `useCallback`, forwarding open-state callbacks and callback
arguments such as a local promise continuation. It examines guards, action
handlers and recognizable body interaction handlers. Analysis is bounded to
24 alias steps and 64 callbacks per interaction, respects lexical identity and
overriding spreads, and never executes those callbacks. In an explicitly
inspected framework workspace it also recognizes the canonical relative
ControlledModal implementation import; a same-spelling application-private
relative module is not treated as Zero.

It does not follow external controllers or certify arbitrary helper code, app
resolvers, computed descriptors or runtime intent. A delegated guard is therefore
informational review evidence rather than a proven bypass. A correctly refused
guard, settled-result notification or effect cleanup is not itself misuse.
`disposeHost`, `discardAll` and `closeAll` inside interaction callbacks require
review because they affect retirement or more than one opening; intentional
owner/scope teardown can be documented and narrowly allowed by exact code/path.
Cleanup outside those interactions is not classified as ordinary dismissal.

Strict mode fails on the proven-bypass and retirement-review warnings, not the
delegated-review info. Existing `rules` overrides and scoped `allow` entries apply
after parsing. Reports contain fixed guidance and source locations, not callback
names, titles, argument values or error payloads. Configuration-backed usage
heuristics do not become this AST lifecycle check merely by upgrading the CLI.

The corrected first-party Data Studio table and record dialogs provide examples:
their guards return admission decisions, saves return true only after the
existing writer acknowledges, and cancel/discard use the manager's own actions.
Persistent standalone fallback hosts retain closing paint after session
settlement. Explicit scope/target retirement remains immediate.

## Upgrade Auditing

The unreleased opt-in audit applies a versioned migration catalog to admitted
source. After installing an upgrade, inspect the installed framework:

```sh
bun --no-env-file ./node_modules/@zero/framework/src/cli/run.ts doctor \
  --source-only --project-root . --upgrade --json
```

To review before changing the app dependency, also pass
`--upgrade-target-root /explicit/framework-directory`. That directory must
contain the actual `@zero/framework` package. An application directory with a
nested installation is not substituted. No registry download, dependency
update, config import, app resolver, database inspection or source rewrite is
performed. `zero update` retains its existing separate authorization boundaries.

The report keeps installed metadata separate from target evidence. Target
capabilities and a deterministic **bounded public-source fingerprint** distinguish
local builds with the same version number. This fingerprint describes inspected
contract sources, not every file in an archive. Missing/unreadable, private,
ambiguous or unsupported export graphs remain unknown; the tool does not call
uncertainty a removed API.

Catalog version 2 distinguishes:

- Confirmed missing target named exports through inspected public bindings, and
  missing admitted literal helper/CSS references: required corrections.
- Recognizable Dropdown content scrolling assumptions: manual review. The
  semantic content ref remains compatible for focus/dimensions, while scrolling
  uses the inner `viewportRef`.
- Explicit outer-scrolling Popover bodies: review the optional `PopoverViewport`
  composition. Already-owned picker, Calendar, Command and Cascader viewports
  must not be wrapped again.
- Supported Recharts and legacy Zero chart dependencies, and proven rendered
  Recharts families: informational migration candidates, not removed APIs.

The chart checks emit `upgrade.chart.legacy_dependency` once per source module
with a proven dependency and `upgrade.chart.legacy_usage` once per rendered
Recharts family per module. Named aliases, namespaces, immutable aliases and
admitted local re-exports retain their origin; unrelated/type-only/shadowed
components do not become rendered migration findings. Component names alone do
not prove library ownership.

Replacement suggestions appear only when the exact handmade export is available
in the inspected target. For example, a rendered Recharts `LineChart` can point
to native `XYLineChart`; a `BarChart` needs deliberate grouped/stacked/horizontal
selection. Missing/unknown target evidence never claims a replacement exists.
The [Zero Charts manual](../../frontend/charts/index.md) owns the actual data,
query projection, dimensions and interaction contracts. Doctor does not rewrite
imports or migrate a chart's data model automatically.

Both chart findings are `info`/`manual-review` by default, so supported legacy
charts do not fail `--strict`. `upgrade.chartReviews` counts chart findings after
policy/allow filtering; `checkedImports` still counts inspected Zero public
named bindings, not Recharts imports or proposed replacement lookups. The common
`reviewCounts.manualReview` includes these chart candidates. Use existing rule
overrides/allow entries for an intentional legacy consumer without hiding real
missing-export or modal findings.

Named imports, aliases, namespaces and bounded local re-export chains are
recognized; shadowed/non-Zero lookalikes are not treated as framework components.
Admitted source aliases resolve relative bindings at their canonical source
location while diagnostics retain the caller's filename. Parser/depth limits
report incomplete inspection and do not prevent independent files being audited.
Dynamic wrappers, aliases needing application resolution and uncertain source
shapes remain bounded review evidence. Compatible old Card parts, native props,
Select positioning and deliberate custom motion are not errors merely because
new optional parts exist.

The audit preserves customized source copies. Without a recorded copy baseline,
it cannot infer their age from a filename or prove which local edits came from
an earlier version. Literal missing dependencies are actionable; speculative
copy replacement is not. Catalog entries must be extended alongside future
breaking contracts. A clean result is **not proof that every future upgrade,
custom layout, runtime service or persisted-data migration is covered**. Keep
type/build, focused interaction and visual qualification as separate gates.

Existing `rules`, `allow`, exclusions and strict/JSON behavior apply. Invalid
target/root admission cannot be suppressed into a trustworthy scan. The report
includes applicable catalog entries, inspection counts and explicit coverage
limits so agents can distinguish completed checks from review work.

Static inspection cannot prove header placement, clipping, scroll behavior,
animation quality, focus trapping, portal layering or accessibility. It performs
no automatic rewrites and does not certify migration completion; follow it with
focused component/runtime tests and visual checks where those are affected.

## Backing Theme Diagnostics

Opt into the foundation check without executing app configuration:

```sh
bun --no-env-file ./node_modules/@zero/framework/src/cli/run.ts doctor \
  --source-only --theme-foundation --project-root . --json
```

The programmatic equivalent adds `themeFoundation: true` to
`runSourceOnlyDoctor`. The flag is false/omitted by default. Its report adds
`themeFoundation` with catalog/version, bundled-style parity, legacy-alias
coverage and static review counts. It checks the Doctor package's own versioned
generator and assets; it does not claim an app uses the same version merely
because the running Doctor does.

| Finding | Meaning and default disposition |
| --- | --- |
| `theme.foundation.option_invalid` | The programmatic opt-in is not a boolean; rejected before project-source inspection. |
| `theme.foundation.generated_stale`, `styles_unavailable`, `legacy_root_unavailable`, `alias_missing` | Owned package parity or compatibility cannot be established; error. Repair the framework asset/mapping, not app customization. |
| `theme.foundation.unresolved_reference` | Mandatory `--zero-theme-*` or `--zero-type-*` reference lacks a declaration in the inspected source/catalog; manual-review warning with file/line. |
| `theme.foundation.copied_styles_modified` | A conventional app-owned copied supplement differs from the Doctor baseline; warning, possibly intentional customization or version difference. No replacement is performed. |
| `theme.foundation.source_unavailable`, `import_limit` | Bounded declaration coverage is incomplete; review warning. |

CSS joins the admitted source scan only for this opt-in. Literal relative CSS
imports are followed through a bounded closure with canonical root fences,
lexical and target exclusions, a 2 MB file cap and 512-import limit. Actual
targets must remain admitted source/CSS types; a `.css` or source alias does not
authorize reading environment files, database files or blocked runtime/build
directories. Remote/package/font imports, application modules and Tailwind
configuration are not executed. Copied stylesheets use the same read-only
admission; their real custom declarations can satisfy local references without
adding generated palette values to app review counts. Old aliases and literal colors remain aggregate
review counts rather than automatic migration findings; strict mode still fails
on warnings. Declaration coverage is not proof of computed scopes or visuals.

The local maintenance helper `scripts/check-theme-foundation.ts` additionally
compiles the framework's known Tailwind import closure in memory for its own
source inventory. That development helper and config-free Doctor have different
read/execution boundaries; Doctor does not invoke it or execute app Tailwind.

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
