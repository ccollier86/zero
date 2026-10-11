---
id: zero.doctor.roadmap
type: roadmap
audience: [developer, agent, operator]
owner: doctor
status: draft
visibility: internal
system: doctor
feature: roadmap
maturity: supported
applies_to: ["2.6.0 working source; publication qualification pending"]
modes: ["configuration values", "trusted CLI modules", "explicit infrastructure snapshots"]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-10"
  evidence_level: source-observed
---

# Doctor Roadmap

[Doctor index](./index.md) · [Documentation index](../../index.md)

Current Doctor already includes domain configuration checks, source usage rules,
system/app-plane inspection and explicit automation health/fingerprint checks.
It is not only a future foundation.

The 2.6.0 working source includes opt-in [backing-theme diagnostics](./source-audit.md#backing-theme-diagnostics)
on the source-only path: owned bundle parity/alias integrity, admitted canonical
references and manual-review evidence for app-owned copied styles. It executes
neither application configuration nor Tailwind, opens no application database
and rewrites no styles. A fresh installed-package CLI consumer qualifies that
path; global theme activation and automatic migration are not part of Doctor.

## Upgrade Audit Delivery Sequence

This follows the completed Select/picker/menu/ScrollArea/Card component pass.
Its first source-only implementation is opt-in, read-only and catalog-driven;
it does not redefine every old component as incompatible.

- [x] Qualify target version/capability/fingerprint inspection and literal named
  public exports, including same-version local artifacts and unknown graphs.
- [x] Qualify AST binding/re-export analysis, Dropdown scroll-owner guidance and
  optional long Popover body review without false errors for compatible usage.
- [x] Qualify admitted literal CSS/helper integrity, exclusions/symlinks and
  CLI JSON/strict/config/environment tripwires in synthetic and installed consumers.
- [ ] Add source-copy provenance: record rewritten baseline/version/closure
  hashes for newly copied files, preserve skipped/modified copies, and report
  upgrade diffs without automatic overwrite. Existing unrecorded copies remain
  manual review; this is **not part of the first implementation**.
- [ ] Expand the migration catalog as real backend/frontend contracts change,
  with source-backed applicability and per-rule regressions. Persisted-data and
  service migrations keep their own owning validation gates.
  Include deliberately breaking component import/copy-path and stylesheet
  changes from the [organization plan](../../_work/frontend-component-organization-plan.md).
  The current audit has no automatic rename or theme-ready-to-delete verdict.
- [ ] Evaluate explicit post-update audit orchestration. Never convert update's
  optional app scripts into automatic config execution or source repair.

See [upgrade audit](./source-audit.md#upgrade-auditing) for current options,
classification and coverage boundaries. Full application visual approval and
release/publication remain separate from static qualification.

Working-source qualification on 2026-10-10: **115 tests / 553 assertions across
nine files**, zero strict TypeScript diagnostics across the **2,178-file** public
Doctor/CLI and test dependency closure, and clean whitespace checks. Regressions
cover canonical source aliases, parser exhaustion, declaration-only/CommonJS
uncertainty and malformed static CLI flags as well as ordinary consumers.

A fresh isolated installed archive passes **1 test / 46 assertions**, including
public Card/Select/PopoverViewport/ScrollArea and Doctor imports, browser CSS
assets, theme parity and the source-only upgrade CLI. Installed SHA-256 values
match the final checkout for all **15 selected qualification sources**. The
synthetic consumer executes no application config, loads no `.env`, starts no
application services and creates no database files. This is a local dirty-source
qualification, not a published version, full repository test run or application
visual approval. The next stage is source-copy provenance; there is no historical
baseline for existing unrecorded customized copies.

## Further Work

Future ideas, not current APIs:

- [ ] Source-verified capability discovery and compact coding-agent routing.
- [ ] More representative installed-package/mode verification recipes.
- [ ] Clearer machine-consumable documentation destinations for stable findings.
- [ ] Evaluate additional focused configuration organization checks as those features exist.
- [x] Implement working-source [modal migration analysis](./source-audit.md#structured-modal-migration):
  focused import/JSX checks, installed Zero capability inspection and file/line
  migration hints. The owning [modal plan](../../_work/modal-system-redesign-plan.md#phase-6--existing-consumers-public-distribution-and-doctor)
  records its separate qualification. Current source audit is heuristic;
  unknown wrappers and runtime layout/focus behavior must not be reported as
  statically proven. Preserve project-root fences, exclusions and exceptions,
  and do not execute application configuration for static migration analysis.
- [ ] Add capability-aware rules for the
  [latest Arc component follow-up](../../_work/arc-interaction-follow-up-plan.md)
  only after those contracts are implemented: changed scroll options/owners,
  managed drawer migration, numeric/table helpers and input defaults/native forms.
  Separate required unavailable exports/assets from optional adoption and custom
  copy review. Do not mark all Sheet, native numeric input or legacy TagInput
  usage broken, promise complete semantic detection or overwrite app-owned source.

Automatic repair, security certification, MCP discovery and agent lifecycle
hooks are not shipped by this checker. Confirmed defects are corrected with
focused tests rather than becoming roadmap caveats. See
[current source rules](./source-audit.md),
[agent plans](../../agents/tooling/roadmap.md) and
[tooling roadmap](../tooling/roadmap.md).
