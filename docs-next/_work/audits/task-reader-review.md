---
id: zero.documentation.task-reader-review
type: operations
audience: [agent, maintainer]
owner: zero-documentation
status: in-review
visibility: internal
---

# Task-Guide Independent Walkthrough

[Audit index](./index.md) · [Documentation index](../../index.md)

This review first followed the reader documentation without using source to
fill missing instructions. The reviewer had prior Zero development history;
this is **not** a fresh-history/clean-room or installed-package qualification.
The source was consulted afterward only to validate corrections and the new
correlation example. No application, configuration module, Doctor, database,
provider, compiler or browser was executed during the docs-only walkthrough.

## Plans Derivable From The Reader Tree

| Task | Reader path | Plan available from the documentation |
| --- | --- | --- |
| Single/simple user-owned realtime app | Start Here → choose modes → user-owned records → Schema references → Resource ownership/exposure → frontend data sources | Enable Guardian, bootstrap deliberately, keep canonical users system-owned, install minimal local anchors, bind owner writes to current identity, and hydrate authorized data through the official source/provider. |
| Multi/advanced Fabric app with Administration members, Storage and Data Studio | Organization guide → Guardian bootstrap/control plane/RBAC → Fabric configuration/actors/realm composition → Studio installation and permission references | Create the Administration owner; assign ordinary app-only or mixed roles independently of platform powers; resolve physical tenant files from live authority; install each Studio's server tables/resources/permissions/router as well as its UI. |
| Upgrade a legacy application | Upgrade guide → CLI updater → data planes/migrations → Torrent compatibility | Treat an installed-code update separately from combined-DB separation, tenant/data ownership conversion and definition/schema upgrades; retain backups, previous pin and explicit validation. |
| Resume one correlated Torrent wait | Automation guide → Torrent authoring/events/authority → database functions/triggers/delivery → machine services | Persist exact correlation, authenticate the originating reply independently, perform a tracked origin write, deliver through the source-bound durable helper and let the instance-specific inbox claim the matching event. |

These are dry plans, not evidence that the corresponding application was built
or that every profile combination has passed runtime testing.

## Concrete Findings And Disposition

1. **Torrent configuration contradiction.**
   `backend/torrent/configuration.md`, “Managed Registration,” called its object
   a complete configuration while omitting `auth`. Guardian's configuration
   reference says omission disables authentication, and Torrent says disabled
   auth cannot enable managed workflows. Corrected the example to `auth: true`,
   clarified complete value versus running installation, and linked the
   first-owner prerequisite. The default secret is not invented/provisioned.

2. **Lazy user-owned frontend assembly gap.**
   `guides/user-owned-records.md`, “Frontend And Writes,” chose a lazy table but
   originally did not show the demand-loading/source setup needed to observe
   realtime rows. Corrected with named browser-safe schema, server-only config
   and an explicit server-query DataTable page. All three actual modules compile
   together; the collection-versus-query/Sync distinction is explained.

3. **Organization file assembly ambiguity.**
   `guides/organization-app.md`, “Choose The Data Boundary,” linked the required
   same-entry actor branch but did not supply one coherent module/entrypoint
   layout for the starter. Corrected with the linked organization-assembly
   recipe: twelve named modules spanning config, immutable realm, actual server
   entry, provider, account pages and Studios. Independent experience review
   found no blocking filename, authority or installation join; modules compile
   together without executing configuration or starting an app.

4. **Legacy conversion checklist too indirect.**
   `guides/upgrade.md`, “Changes That Need An App Plan,” correctly warned about
   canonical data separation but sent readers to a generic Torrent index and
   lacked a decision checklist separating package-only, combined-DB split,
   tenancy/ownership and legacy workflow changes. Corrected with eight actionable
   decisions and direct legacy-workflow, migration-plane and backup links.
   No automated migration capability is inferred.

5. **Unmatched wait/delivery examples and missing complete correlation task.**
   Torrent authoring waited for `reply-received` while the durable function
   example emitted `reply`. Corrected authoring to exact `reply`; created
   [the correlation task](../../guides/correlated-workflow.md), linked from the
   guide index, automation overview and automation/Torrent integration. It
   supplies complete contribution, registered workflow and verified-reply
   service modules, with a private table, deterministic instance correlation,
   stable mutation receipt, atomic row-equals assertion/update, source-bound
   durable function and matching wait schema. It labels the app-owned transport
   and provider authenticator as trust prerequisites, not fake implementations.

## Correction Boundaries Checked Against Source

The correlation example uses public imports and the actual Fabric async
`mutate`/`batch` contract, not a nonexistent async `insert` API. Strict background
`zero.data` is available only for tenant-database isolation, so this sample is
explicitly Fabric/multi rather than claiming the pinned single-mode facade has
the same member. Private business correlation remains in the tenant file;
Torrent's canonical runs/events remain in the system file. The bridge is
receipt-backed and at-least-once, not a cross-database transaction.

Only one external request per instance is modeled. More than one question in
a run requires per-question correlation/interactions, not an implicit broadcast
or one overwritten shared record. The sample exports inert declarations and
registration functions; no example executed a provider or created data.

## Remaining Gates

Actual Markdown source compilation completed after the docs-only walkthrough:
`bun --no-env-file test docs-next/_work/checks/workflow-examples.test.ts` passed
1 test / 19 assertions, covering 18 actual complete Markdown modules, including
the three new correlation modules. The in-memory host resolves supported public
source facades; it does not execute those examples, evaluate app config, open
data or call a provider. This checks the dirty development source, not an
installed artifact. The structural check before adding this evidence page
passed 688 pages/unique IDs/reachable pages with no problems.

Independent correction review and all three task-assembly corrections are
complete. The final platform Markdown check passed 1 test / 78 assertions,
including twelve organization modules and three user-owned modules; the final
structure check passed 690 pages/IDs/reachable with zero problems. Root reviewed
the correlation helper's source-bound scope/receipt fences and the organization
assembly. These are independent docs/source reviews, not executed app tasks.
A fresh-history reader task, installed-artifact
import/example qualification and explicit public-only projection are still
distinct pending publication gates.
