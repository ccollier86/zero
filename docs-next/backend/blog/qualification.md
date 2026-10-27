---
id: zero.blog.qualification
type: reference
audience: [developer, agent, operator, maintainer]
owner: blog
status: in-review
visibility: internal
system: blog
feature: publishing-qualification
maturity: supported
applies_to: ["2.6.0 source/local builds containing c9c5fb9; not older same-version archives"]
---

# Publishing And Logging UI Qualification

[Blog index](./index.md) · [Safe upgrade](./upgrade.md) · [Publishing workspace](../../frontend/components/public-pages/blog/publishing-workspace.md) · [Logging workspace](../../frontend/components/logging.md)

## Exact Code Baseline

The clean code candidate is `c9c5fb92e559cf88a0743ae06c4aaa04cf8bfe62`.
Its candidate archive SHA-256 is
`64ed430072bba7218d0bab425305f50626f35ce0daaed4294fce94c0b09a3c82`.
The documentation-only release follow-up records these completed checks and
replaces obsolete preview labels. Do not infer the selected package from
`2.6.0` alone: `zero-release --status` and an app's `zero-release.json` identify
the exact committed-main archive installed by the normal updater.

The candidate passed every gate below, with no test-file retry, omission,
interruption or production access. Earlier failed candidate runs remain in the
[implementation history](../../_work/blog-publishing-implementation.md); none
was silently substituted for this complete run.

| Gate | Evidence |
| --- | --- |
| TypeScript | Full root typecheck passed. |
| Documentation | 864 pages, no graph/schema problems. |
| Dependencies | `bun audit` reported no vulnerabilities for this locked candidate. |
| Build | Official build passed using the external output root. |
| Browser runtime | PDF/browser install and status checks passed. |
| Installed package | Canonical `test:package` passed, including its sequential installed consumers. |
| Native Linux/amd64 | Exact candidate archive installed in an isolated container; source setup followed by two official bundled-server/restart generations passed. |
| Existing-app updater | A populated disposable app moved from the prior qualified main to the exact archive; dry-run preserved state, apply preserved protected configuration, environment, custom public CSS and SQLite data, and a later frozen reinstall matched all 5,629 package-owned files. |
| Complete regression | All 1,341 files passed; zero failed, zero unrun, no interruption. The canonical fresh-process runner used concurrency two and existing per-case deadlines. |
| UI behavior | Real Chromium tests exercised reader/search, publishing/editor/author/media behavior and the logging investigation interface; unit assertions alone were not treated as browser proof. |

The retained diagnostic root is
`/Volumes/code-bank/artifacts/zero-platform/diagnostics/blog-publishing`.
`qualification-c9c5fb9.json` records all ten gates, exact commit/archive/hash and
the final `qualified: true` result. Its `stableSelectionChanged: false` means
the test script does not publish; main selection is a separate explicit release
step. Framework qualification never deploys PracticeIQ, Pantheon or another app.

## Included Behavior

Blogging remains opt-in. `blog: true` supplies user-backed authors, explicit
public bylines/photos, one private Fabric content file by default in either
tenancy mode, immutable publication/revision snapshots, conditional drafts,
taxonomy, private Storage media, indexed search and optional aggregate metrics.
Default public routes are the Magazine list and sidebar-TOC article. The native
`BlogWorkspace` supplies authoring, inline selection formatting, media, taxonomy,
authors and history using the existing SDK, Guardian and design system.

Logging retains its existing private databases, workers, strict admission,
authorization and evidence semantics. The repaired workspace supplies compact
magnetic tabs, actual connection status, server filters/chips, readable outcomes,
managed event dialogs and the normal live DataTable source. Incoming rows do not
restart the initial-load animation; it does not invent totals or human-attention
claims. The logged-in investigator still needs the configured server permission.

The release also includes the reviewed FIFO async-context fix and bounded
ContextMenu animation ownership. Test harness changes distinguish dependency
setup, functional checks and owned cleanup. In particular, native FTS fixture
setup and retirement now have separate 20-second stage budgets around the
existing 20-second migration test. This increases aggregate fixture admission;
it is not a production speed repair. An earlier timed-out native-vector run
crashed; the current passing gate does not establish the cause of that old
native crash or guarantee behavior after arbitrary native timeouts.

## Activation And App Acceptance

1. Make an app feature branch and inspect `zero-update --dry-run` before the
   normal update. Verify the selected commit/archive identity, not only version.
2. Preserve all existing tenancy, accounts, custom public CSS and configuration.
   An updater installs the package; it does not activate blogging or migrate
   live databases. Follow the [upgrade guide](./upgrade.md) for explicit backup,
   migration planning and additive SYSTEM migrations `046`–`048`.
3. Add `blog: true` only when desired. Rebuild with Zero's official build so the
   managed reader assets and retained worker sources match the installed package.
   Mount `BlogWorkspace` inside the existing protected shell/provider.
4. Rehearse publishing, private preview, author/photo privacy, search, images,
   draft conflicts and restart on isolated application data. Test the app's
   chosen public origin, indexing policy and route-prefix ownership.
5. Existing `LoggingWorkspace` imports/props remain compatible. Verify authorized
   filters, scoped event details, live arrivals, older-page incoming controls and
   failure/recovery in the actual app. A connected UI is not a custody-health
   certificate and does not grant investigators access.

Scheduled publishing, collaborative editing, translations, Gutenberg/WordPress
interchange, full RankMath parity, distributed Fabric, a broader public npm
deployment matrix and automatic reconstruction of missing retained state are
not part of this release. Audio/video preview metadata is not a transcoding
pipeline. Existing original themes/components are retained. The separate durable
messaging branch is not included or advertised as complete by this archive.
