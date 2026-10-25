---
id: zero.guides.practiceiq-upgrade.agent-handoff
type: operations
audience: [agent, developer, operator]
owner: zero-documentation
status: in-review
visibility: internal
system: cross-system
feature: practiceiq-agent-upgrade-handoff
maturity: planned
applies_to: ["PracticeIQ 1.3.0-piq.1 to pinned Zero 2.6.0 main"]
modes: [single-tenant, feature-branch, isolated-rehearsal]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "66035d0dad75ea2276ce2f888499e2292b1ee995"
  snapshot: dirty
  date: "2026-10-25"
  evidence_level: source-observed
---

# PracticeIQ Agent Handoff and Acceptance Gates

[PracticeIQ upgrade](./index.md) · [Documentation index](../../index.md)

Give the application agent this prompt with the pinned Zero artifact and this
guide. It covers feature-branch preparation and testing, not authorization to
convert live patient data or deploy.

## Starting Prompt

> You are working on PracticeIQ, an existing single-tenant healthcare app, not
> generating a new application. Read its complete AGENTS.md, identify the active
> user explicitly, and obey that user's feature/integration branch and remote
> rules. Use a separate worktree if the existing checkout is dirty. Do not change
> PracticeIQ main without explicit task authorization.
>
> Read the installed framework's llms.txt and Start Here, then the pinned target's
> docs-next/start-here.md and guides/practiceiq-upgrade/index.md, preparation.md,
> conversion.md, logging.md and this handoff. Inspect public exports; do not rely
> on memory, a version string or a planned API.
>
> Prepare and implement the upgrade on a focused application feature branch from
> the correct user's latest integration branch. Preserve the old archive,
> lockfile, source identity and tested private recovery bundle. The observed old
> pin is 1.3.0-piq.1 at 4ef1f85982eea038f1c193b7fc7e487d800ef415. Revalidate the
> reviewed normal main target and SHA-256 from the upgrade index before using it.
> The result must use normal Zero, without local framework patch reapplication or
> node_modules edits. Verify every old custom behavior before removing its patch.
>
> Record the actual deployed app revision and compare it with the source branch.
> Obtain an operator-authorized consistent backup of current live DB/storage and
> recovery dependencies into private offline scratch, not Git. Hot mode requires
> the old runtime's current-image snapshot or a quiescent supported backup, not
> blindly downloading a possibly stale snapshot/main file. Rehearsal paths must
> be explicit and independent. Disable outbound providers, schedulers and pending
> external effects until their isolated test adapters are installed. No source
> branch or package update is permission to mutate the live state.
>
> Keep single tenancy. Separate system/auth from clinical state through supported
> systemDb and Guardian contracts. Logging needs its own dedicated Fabric audit
> and operational files and supervised worker, not patient tables, the auth file
> or an artificial tenant. An application-wide actor conversion is a separate task.
>
> Preserve the main website's Better Behavioral colors, fonts, branding, assets,
> layouts and behavior. No public reskin, token overwrite, component rewrite or
> organization pass. Verify source hashes AND rendered/computed styles after
> installing the new package CSS.
>
> Inspect scripts first: dev/start migrate automatically. Doctor/status/config
> imports execute trusted app code. Use controlled environments and bun
> --no-env-file. Do not load real .env files, start production jobs, send mail,
> call AI or touch live DB/storage as an implicit diagnostic step.
>
> Classify query changes before rewriting repositories: reuse existing Zero
> operations, retain complex SQL in compatible registered queries, preserve atomic
> command semantics, and report genuine facade gaps. Read the application-client
> extension guide; qualify an exact archive containing it before using zero.data
> on the primary database. Register primary queries/commands through dataRealm.
> The current single-tenant split is not a mandate to rewrite all clinical queries
> or enable tenant mode.
>
> The preparation tools verify source and deliberately staged offline copies.
> For the canonical 1.3 split read backend/migrations/legacy-state.md and use
> planLegacyStateMigration, stageLegacyStateMigration and
> verifyStagedLegacyStateMigration from @zero/framework/migrations. Pin an
> archive qualified for those exports. Supply the complete app table inventory,
> independently approved migration checksums, exact source SHA-256 and reviewed
> plan fingerprint. Do not recreate accounts or import private framework SQL.
> Stage only into a new private generation; do not resume a failed generation.
> Keep clinical app adaptation separate and prove old-state restoration.
> Unknown source profiles remain a framework gap, not a bypass opportunity.
>
> Keep workflows false while pending imports await execution-authority review.
> A requires-reviewed-authority receipt preserves the rows but does not grant
> execution permission. WORKFLOW_LEGACY_MIGRATION_REQUIRED is a deliberate
> non-mutating recovery gate. Do not delete holds, mint private seals, discard
> pending work or replay external effects. This is a cutover blocker, not an
> obstacle to continuing the isolated app/UI upgrade.
>
> After isolated conversion and ordinary authorization pass, integrate logging
> through the facade, existing AppProvider and LoggingWorkspace. Inventory raw
> SQL, clinical reads, Storage/PDF/email/AI stages and background attribution.
> Never log clinical content or raw tokens. detailed is available, but strict
> compliance is still blocked by LOGGING_NOT_READY; do not bypass it or claim
> certification. Session replay is not part of this task.
>
> Complete the acceptance matrix below with synthetic/local providers and
> authorized isolated copies. Preserve identities, history, uncertain sends and
> old migration safeguards. Save an app-owned runbook, exact artifact identity,
> check results, remaining blockers and cutover/rollback checklist. No live
> conversion, restore, volume swap, DNS or deployment without separate approval.

## Staged Acceptance

Each stage has its own evidence and stop condition. An app boot is not proof
that its clinical data, access policy or recovery path survived.

| Stage | Required evidence |
| --- | --- |
| Source/package | Exact old/new pins and digests, disposition of every custom patch, clean branch, source guard. Package-only installation changes no app source/design/config/state. |
| Recoverability | Complete old private recovery bundle restored and exercised with the old pin in isolation; credentials/keys remain outside Git and reports. |
| Conversion | Every legacy table classified, complete clinical IDs/values/history preserved, correct system authority/anchors/ledgers and interrupted-generation rejection. |
| Ordinary app | Functional/security/realtime/workflow/Storage/public-site checks below pass before enabling logging. |
| Logging | Independent Fabric files/worker, declared semantic coverage, honest evidence, denial/revocation, restart/backpressure and representative concurrent load. Strict gaps remain visible. |
| Cutover | Operator approves exact target paths/artifacts, backup proof, downtime/write freeze, pending effects, go/no-go and restoration procedure. |

### Ordinary Application Checks

- **Accounts and roles:** existing passwords work; trusted `practice_role`,
  account status and privileged access retain meaning. Admin, support staff,
  clinician and TCM access are correct; suspended/unassigned users remain denied.
  Account creation must not quarantine identity projection or expose a new public
  empty-install bootstrap.
- **Busy authentication:** repeat login, refresh, protected reads and revocation
  during representative writes/workflows. No recurring `AUTH_COMMIT_CONFLICT`,
  false password rejection or lost final authority check. Set and measure a real
  host/app latency budget; do not hide a defect with unlimited retries, weaker
  auth or a file-mode switch chosen only to evade contention.
- **Clinical state:** patient search/detail, intake/resume/verification,
  assessments, consents, signed/history records, care plans, notes, tasks and
  reporting preserve identities and policy. Test direct API/Sync denials, not
  only hidden buttons.
- **Storage/PDF:** existing private object IDs, bytes, checksums, grants and
  clinical references remain valid. Exercise scoped upload/download, missing
  files and revoked access. No public patient-asset route.
- **Letters/email:** use existing domain/document/runtime tests on normal Zero.
  Preserve `isEmailAttachmentDeliveryReady`, exact file bytes/MIME, sender/provider
  readiness, worker readiness and uncertain-send recovery on both Resend and SMTP
  through synthetic/local boundaries. Never resend accepted old work or silently
  convert queued link deliveries to document email.
- **Durable work:** register exact retained handlers before recovery; exercise
  waits, retries, interruptions, cancellation and duplicate callbacks. No lost
  history or duplicate AI/PDF/email effects. Imported nonterminal work needs a
  separately reviewed supported authority-admission contract before enabling
  recovery; preserving rows alone does not satisfy this acceptance gate.
- **Realtime/tables:** authorized pages get live changes and revoked clients
  stop. New rows must not blank the table or replay initial-load animation;
  pagination uses directional motion. Keep component keys/data sources stable.
- **Staff UI:** test public modal/select/popover/chart facades, scroll behavior,
  keyboard/focus, mobile and reduced motion. Preserve approved shell behavior.
  Do not assume the planned TanStack/SSR/server-action switch shipped.
- **Main website:** source-protection checks plus old/new synthetic screenshots
  and computed font/color/spacing. Verify navigation, FAQ/finder, no-JavaScript
  SSR, assets, canonical metadata, sitemap exclusions and public-to-intake links.
  Marketing must not gain a patient feed, duplicate provider or clinical collector.

Run reviewed relevant/full app tests, typecheck, Doctor/strict Doctor and build
against disposable controlled targets. Classify preexisting warnings honestly.
Doctor cannot prove row preservation, role semantics, pixel parity, delivery
or compliance coverage.

The existing `scripts/preview-public-site.ts` and
`scripts/verify-public-site-http.ts` are useful starting points, not automatically
v2-safe. Review/adapt system DB, migrations, isolated paths, plugins, side effects
and binding first. The old preview binds `0.0.0.0`; an isolated replacement
should bind loopback. Do not run it unreviewed against the split-plane package.

## Cutover and Rollback Runbook

Save an app-owned operator runbook with concrete targets and these gates:

1. Revalidate exact old/new app commits, Zero archive digests, locks, build
   artifacts and private backup receipt immediately before the run.
2. Inventory every web, Fabric, logging, scheduler and automation owner. Freeze
   writes, stop/join managed lifecycles and record uncertain external effects
   before the final consistent capture.
3. Check source boundary, staging destinations, free space, backup lifetime and
   all-target reconciliation. Never mix old/new writers or replace live actor files.
4. Publish/restart deliberately, apply bounded smoke checks, and abort on failed
   auth/storage/realm readiness before releasing ordinary clinical traffic.
5. Prove whole-state restoration with the old artifact. A package downgrade or
   SQL down migration is not rollback of a split or of external provider effects.
6. Define post-write recovery explicitly: restoring an old bundle after new
   clinical writes loses them unless preserved/reconciled. Never overwrite new
   care data with a pre-cutover snapshot silently.
7. Retain the recovery artifacts through observation and owner acceptance.
   Removing old pins/backups/fallbacks is separate approved cleanup.

## Related Guides and Next Steps

- [Preparation tools](./preparation.md) provide source and offline checks.
- [Conversion](./conversion.md) specifies the app-specific implementation work.
- [Logging](./logging.md) defines independent files and coverage gates.
- [UI migration](../ui-upgrade.md) indexes the component/manual changes.
- [Verification](../verification.md) connects framework and app evidence.
