---
id: zero.guides.practiceiq-upgrade
type: index
audience: [developer, agent, operator]
owner: zero-documentation
status: draft
visibility: internal
system: cross-system
feature: practiceiq-upgrade-preparation
maturity: planned
applies_to: ["Unreleased logging completion branch based on 2.6.0"]
modes: [single-tenant, separate-system-database, Fabric-logging]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "fc61dcc4cd107c6467bff498d3a772e8f5bdea9d"
  snapshot: dirty
  date: "2026-10-25"
  evidence_level: source-observed
---

# PracticeIQ Upgrade Preparation

[Guides index](../index.md) · [Documentation index](../../index.md)

Prepare PracticeIQ's application agent to upgrade on its own feature branch.
This is a runbook and tested verification toolkit, **not an executed migration,
automatic data converter or deployment approval**. The toolkit cannot install
Zero, start the application, move records, restore backups or change configuration.

The separate public [legacy state staging boundary](../../backend/migrations/legacy-state.md)
now handles the admitted 1.3 canonical split. It is not a live migration or a
permission grant for pending work. Use the qualified archive containing both
this boundary and the primary data facade; the historical archive below does
not contain them.

The target remains one PracticeIQ installation with one business tenant. Keep
the public Better Behavioral website's custom colors, Montserrat typography,
branding, assets, layouts and behavior. Do not recreate it with the new default
theme. Adopt internal UI changes deliberately; do not combine the migration
with unrelated component organization or product redesign.

## Read in Order

1. [Preparation and verification tools](./preparation.md): source/archive checks,
   private rehearsal workspace, consistent backups and offline table evidence.
2. [Data and compatibility conversion](./conversion.md): classify every legacy
   table, preserve identities/workflows/files, separate the system plane and
   retire the custom framework pin only after its behavior is covered.
3. [Logging integration](./logging.md): dedicated Fabric files and worker,
   clinical attribution, browser observations, permissions and release limits.
4. [Application agent handoff](./agent-handoff.md): copyable starting prompt,
   staged acceptance checks, cutover approval and rollback requirements.

## Source and Destination Identity

Source observed in PracticeIQ's `zero-release.json` on October 25, 2026:

| Field | Existing pin |
| --- | --- |
| Version | `1.3.0-piq.1` |
| Source | `refs/heads/fix/piq-email-attachments-exact-1.3.0` |
| Commit | `4ef1f85982eea038f1c193b7fc7e487d800ef415` |
| Archive SHA-256 | `00c9d8ca6a025786f57898e77f9248f60bfa418f47e78512f0d948151e07d515` |

Earlier qualified main baseline for logging and the standardized attachment fix
for both Resend and SMTP (historical reference, **not** the facade upgrade target):

| Field | Reviewed destination |
| --- | --- |
| Version | `2.6.0` |
| Source | `refs/heads/main` |
| Commit | `202b9f7f35c761192ce9089e7ea84c4fbe9c58c3` |
| Archive SHA-256 | `e6d9e170e9878ca9dece4369ecbef157a9d057e4d53972bd129e337dcf82560e` |

For this upgrade select a newer qualified normal main archive containing the
[application-client extension](../../backend/fabric/application-client.md).
It must also contain the [legacy-state exports](../../backend/migrations/legacy-state.md).
For real-source rehearsal it must include the subsequent runtime-table extension
for `_sync_mutation_receipts` and `_zero_sync_table_modes`; `054941b` alone lacks
that admission. The table upgrade also needs public stable-source refresh on
DataTable/DataTableView and MasterDetail. The corrected package must pass both
checks; a previous synthetic conversion pass does not establish real-source
profile completeness.
Record its full commit and SHA-256 from the release handoff and
`zero-release --status`; verify the archive before using it. Those exact values
become `PIQ_TARGET_COMMIT` and `PIQ_TARGET_SHA256` in the preparation commands.
Do not substitute the historical baseline or assume a moving main/version
string identifies the approved bytes. Recheck if source/destination changes.
Keep the old archive, lockfile and private restore
bundle until the upgraded application is accepted. Do not commit patient data,
backups, credentials or verification evidence to either repository.

## Target Storage Boundaries

| Plane | Target responsibility |
| --- | --- |
| Application | One clinical/business database; retain patient, document, task and other app-owned identities. |
| System | Independent `systemDb` for canonical Guardian users/authority and Zero-owned services. It is currently a pinned managed plane, not a fabricated tenant or an actor-backed auth database. |
| Audit logging | Dedicated private Fabric database file, separate from clinical and system storage. |
| Operational logging | Another dedicated private Fabric database file, independently retained from audit evidence. |
| Storage and KV | Preserve their own bytes, metadata, ownership and recovery dependencies; neither becomes a log or clinical table by inference. |

Logging uses its own Fabric coordinator and supervised delivery subprocess. It
does not require changing Guardian to multi-tenant mode or enabling application
`tenant-database` isolation. Do not replace existing application accesses with
named actor calls as an incidental migration. A broader business-data Fabric
conversion needs its own explicit composition and acceptance work.

## Current Release Boundaries

The [application data facade](../../backend/fabric/application-client.md) removes
the need for a PracticeIQ-owned primary/Fabric adapter. It is not in the
historical archive above; qualify the exact newer destination before adopting it.

Canonical rows and immutable migration ledgers can now be staged through the
public offline boundary rather than app-private SQL. Pending workflow imports
are held intact for reviewed execution authority. Keep `workflows: false`
during isolated conversion; a held generation is not approved for cutover.

The attachment capability/helper is normal Zero functionality, not a new
PracticeIQ-only patch. The logging subsystem remains **opt-in**. PracticeIQ
requires the actual compliance preset: the completion branch supplies strict
source/admission/custody/export controls, but must still pass final committed
archive selection and app acceptance. Do not use the older preview or
substitute detailed/disabled audit. A successful update, logging screen or
browser observation does not establish clinical coverage or certification.
Follow the [logging acceptance guide](./logging.md), and plan the dashboard
review with the user before application handoff.

## Related Guides and Next Steps

- [General upgrades](../upgrade.md) explains package versus data ownership.
- [UI upgrade handoff](../ui-upgrade.md) indexes the new components and manuals.
- [Migration planes](../../backend/migrations/data-planes.md) explains why a
  combined legacy file is not silently converted at startup.
- [Logging coverage](../../backend/logging/events-and-coverage.md) separates
  automatic capture from declared app instrumentation.
