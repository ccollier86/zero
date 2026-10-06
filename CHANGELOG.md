# Changelog

All notable Zero Platform changes are tracked here.

## 2.4.2 - 2026-10-06

Includes the complete 2.4.1 exact array-policy update and hardens the production
ReactiveDB automation boundary. No application row conversion or existing
trigger declaration rewrite is needed. Managed system migration
`038_workflow_system_start_receipts` adds Torrent's private permanent start ledger.

- Unrelated origin transactions no longer consume automation change budgets.
  Matching origin writes and all handler-generated tracked writes remain
  bounded; failures roll back origin, cascade and outbox state. Fabric's public
  256-item batch envelope remains unchanged.
- Added source-bound `zero.torrent.start` and trusted `startAsSystemOnce` with
  atomic run/steps/authority/memory/receipt creation, permanent scope/principal
  namespacing, command-conflict checks, live final fences, sealed replay
  integrity and recovery after interrupted first advancement.
- Existing non-idempotent start APIs remain intact. Async retry-safe starts
  reject enclosing transactions before creation; request/activity facades do
  not expose the privileged system-start method.
- Documented and exercised ordinary app-function invocation independent of
  Torrent, including exact parameter/version mapping, accepted-effect retries,
  Guardian/Fabric isolation and source suspension/shutdown fences.
- Updated new feature guides, reciprocal indexes, actual Markdown example
  checks, compatibility references and upgrade/migration instructions.

## 2.4.1 - 2026-10-06

This compatible authorization update adds exact string-array overlap across
Resources, bound Fabric queries and realtime Sync. It does not include the
unfinished documentation website/CodeBlock feature, UI redesign or changes to
Pantheon data. No framework database migration is required. Applications still
own their group-label/projection migration and trusted grant derivation.

### Added And Fixed

- Public `ResourceArrayOverlapConstraint` and `DatabaseFindArrayOverlapFilter`
  with `operator: 'arrayOverlaps'` and bounded string-array values. Resource
  SQL/find translation preserves this operator, ANDs it with tenant/client
  constraints, and applies it before ordered paging. Filtered Fabric cursor
  lists add optional `filters` without changing existing call sites.
- Shared SQL/in-memory exact matching rejects malformed, mixed-type, oversized
  and non-array retained data; empty allowed lists deny access. Case-sensitive
  element matching has no substring, affinity or scalar-coercion behavior.
  Guarded JSON traversal and bounded payload validation preserve actor and
  reader/executor admission.
- Validated returned resource constraints guard loaded get/update/delete rows
  and receipt replay as well as list queries. Full/lazy Sync, catch-up, live
  membership-label changes and live authority invalidation retain the predicate.
- Periodic Sync revalidation now checks durable authority before and after
  asynchronous bearer verification. Revoked memberships purge cached rows
  instead of being misclassified as an ordinary expired-token refresh; the
  existing same-authority refresh behavior is preserved.
- Updated resource/Fabric/Sync documentation, a complete
  [array-policy guide](./docs-next/backend/resources/array-overlap.md),
  and primary documentation routing from README, agent knowledge files,
  the compatibility Start Here page and generated app READMEs to `docs-next`.

## 2.4.0 - 2026-10-06

This additive component release includes Button Group and Context Menu with
their public exports, theme-aware presentation and focused interaction/package
checks. Existing Button, DropdownMenu and app call sites remain supported;
there is no database migration. The discussed global typography/density/motion
redesign is not part of this release. See the
[2.4 upgrade notes](./docs/upgrading-2.2.md#24-button-group-and-context-menu).

### Added

- Public token-themed Button Group primitives for joined/separated horizontal
  or vertical actions, text/count addons, separators, nested groups, split
  dropdowns and mixed inputs/selects. Separate single/multiple selection
  controls reuse Zero Button and Radix's keyboard/value semantics.
- A complete conventional Context Menu family: native pointer-anchored
  right-click and touch long-press, keyboard opening, leading icons, trailing
  metadata/shortcuts, labels and separators, destructive/disabled actions,
  checkbox/radio choices with optional right-side indicators, nested submenus,
  portals, collision-aware bounded surfaces and reduced-motion-aware entrance.
  Existing dropdown and radial menus remain unchanged. Public root/React and
  focused component paths, detailed guides and isolated regression checks
  accompany the additions.

## 2.3.0 - 2026-10-06

This additive release includes the new Cascader and SignaturePad component
families, plus focused Data Studio and Storage correctness/presentation fixes.
Existing public component call sites remain supported. Updating from 2.2.1
requires no database migration or application data conversion. See the
[2.x upgrade guide](./docs/upgrading-2.2.md#23-component-and-storage-update).

### Added

- A composable, token-themed Cascader for nested attributes and permission
  choices: drill-down navigation, checkbox multi-selection with a cap, global
  path-aware search, loading before navigation, and a pinned action footer with
  a responsive import menu. Optional external selection chips and the
  `useCascaderSelection` hook preserve full paths when labels repeat.
- Scoped, cancellable async child/search adapters, retry and current-intent
  fences, guarded footer actions, native hidden form values, and content-free
  frontend observability. The component does not grant Guardian authority or
  persist selections; applications retain those responsibilities. See the
  [Cascader guide](./docs/frontend/cascader.md).
- Browser, model, request-lifecycle, documentation-example and fresh packed
  consumer regressions for the new public component family. Export smoke builds
  now use isolated Bun CLI processes so filtered tests do not depend on the
  test runner's resolver being warmed by an earlier server build.
- A reusable SVG SignaturePad family with muted signing surfaces, pinned
  controls, undo/redo and keyboard shortcuts, native required/reset form
  integration, server-acknowledged agreement cards, and compact clause-initial
  compositions. Controls use Zero's design tokens and public root/React/focused
  exports; application code still owns signature persistence and agreement
  policy. See the [SignaturePad guide](./docs/frontend/signature-pad.md).

### Improved

- Reworked the Add Record dialog around the existing Zero field, dialog,
  calendar and time controls, with a bounded body, anchored heading/actions,
  stable typed drafts and acknowledged mutations. Data Studio defaults,
  filters and inline date/time editors now reuse those same temporal controls
  instead of native browser date/time inputs.
- Compact Storage access-grant forms adapt to the inspector width. Grant lists
  remain bounded and keyboard reachable; long IDs no longer widen the pane.
  Public-visibility controls explain disabled publication policy, while an
  already-public resource retains its make-private remediation action.
- Updated component/API documentation in both the existing guides and the
  isolated source-audited documentation tree. Filters integration remains a
  design plan, not a shipped Filters component.

### Fixed

- Corrected Storage HTTP wildcard paths so uploaded filenames containing
  spaces, Unicode or special characters work for deletion, downloads,
  information reads and metadata updates. URL segments are decoded exactly
  once before canonical validation and authorization; literal percent-escape
  names remain distinct. Invalid encodings/separators fail with the standard
  safe input error. The packaged hold-to-confirm flow now completes against
  these paths without the spurious `STORAGE_NOT_FOUND` response.
- Fenced stale/duplicate record and permission-panel operations, preserved
  explicit false/zero/null/default drafts, and kept accepted persistence from
  becoming retryable when a later notification callback fails.
- Preserved datetime seconds/fractions and supported timezone-bearing public
  inputs, rejected invalid calendar/DST values, prevented cell-popover clicks
  from dispatching surrounding-row actions, and corrected empty-grid spans.

## 2.2.1 - 2026-10-05

This patch fixes two package-mode release blockers reported after 2.2.0.
No database migration, schema conversion or application API change is required.
See the [2.2 upgrade guide](./docs/upgrading-2.2.md).

### Fixed

- Fabric now admits, validates and preserves the framework-owned declared Sync
  loading metadata emitted by both public schema builders. Explicit `full`,
  `lazy` and `auto` modes work in direct and composed realms, configuration
  normalization and real gateway/actor startup. Guardian references and mutation
  validators remain enforced; unknown symbols, malformed modes and accessors
  are rejected without invoking getters. Loading metadata does not become a SQL
  column or change schema checksums, realm fingerprints or durable namespaces.
- The normal saved-archive updater now stages a matching root framework override
  together with the root dependency. Workspace peer declarations remain
  untouched. Lockfile canonicalization checks the exact managed declarations and
  installed package, and successful updates restore the original manifest bytes
  even when Bun reformats them during installation. Conflicting overrides and
  unrelated semantic edits fail closed; rollback retains the original manifest,
  lockfile and archive. The reported override/peer workaround is no longer needed.
- Added public packed-consumer gateway/actor restart coverage and real Bun
  workspace update/failure-recovery tests to the package release gate.

## 2.2.0 - 2026-10-05

This release adds the redesigned Data Studio and shared workspace layout, plus
the focused correctness fixes found while rebuilding documentation against the
source. It continues the Zero 2.x Guardian/Fabric/Torrent architecture. Updating
from 2.1.1 adds no system migration or logical-table data conversion. See the
[2.2 upgrade guide](./docs/upgrading-2.2.md) for configuration and layout checks.
The maintained 1.3 line is not changed by this release.

### Added And Improved

- Data Studio now uses a schema-first spreadsheet workspace with visible
  empty-table headers, type/required indicators, sticky headings, local horizontal
  scrolling, TanStack column sizing and virtual rows, contextual column editing,
  accessible menu actions, and sleek revision-aware typed inline edits.
- Connected Data Studio defaults to bounded progressive reads rather than page
  buttons. Continuations share a same-read Fabric sequence fence, and reactive
  changes reconstruct the loaded prefix atomically. Changed sequences require a
  coherent refresh instead of silently joining shifted offsets. The standalone
  `useDataStudio` hook retains its paged default for existing custom screens.
- The optional inspector shows full record values or compact table metadata,
  starts hidden on desktop, and supports resizing. Mobile cell editing remains
  in the grid; explicit inspection opens details with a clear return action.
- The substantial Visual/JSON schema dialog shares one draft, preserves stable
  column IDs and unfinished JSON, captures its opening revision, handles
  save/discard/stay and schema-impact review, and keeps headings/actions visible.
- Added the token-themed reusable `JsonEditor` over `json-edit-react`, exported
  from the React/root and focused component entrypoints. It validates local
  drafts; domain controllers still own authorization and accepted persistence.
  A general-purpose code editor remains future work.
- Shared master/detail panes scroll independently with an anchored action bar.
  Additive `detailVisible`, `resizable`, navigation status/visibility and AppShell
  `contentMode` options provide a bounded workspace or an explicit document page.
  Resizing delegates to `react-resizable-panels`, not a custom pointer engine.
- Added the isolated, source-audited documentation tree in `docs-next`, with
  system inventories, detailed feature/configuration guides, indexes/backlinks,
  task examples and agent onboarding. It remains separate from the packaged
  documentation until an explicit publication cutover.

### Fixed

- Fenced stale, duplicate and unmounted UI work across forms, CRUD, tables,
  master/detail, storage, OTP, confirmations and navigation. Accepted writes
  remain accepted when a later notification callback fails.
- Preserved server-query membership/order separately from the shared row cache,
  corrected table selection/filter/control state, and hardened CSV escaping,
  formula-like text export, numeric inline clears and schema default inference.
- Corrected Scheduler error propagation for `catchErrors: false`, protected
  overlapping execution and cleaned partial setup failures with standard errors.
- Hardened synchronous SQL transaction and migration callback admission,
  rollback/depth recovery, quoted/default field validation and declared loading
  intent. Async migration callbacks now fail closed instead of reporting an
  unconfirmed commit.
- Corrected Guardian API-key role eligibility in the Administration Organization
  without granting customer organizations platform roles. Reserved MFA
  `rememberDevice` and `recoveryCodes` flags now reject `true` explicitly rather
  than projecting nonexistent features as enabled.
- Hardened AI session FIFO/history snapshots and stale-result fences, forwarded
  declared workflow AI controls, preserved typed agent context and rejected
  malformed/empty or excess generated video results.
- Corrected notification/room JSON and capacity admission, token expiry/lifetime
  arithmetic, observability body/retention bounds, PDF and vector app-local
  ownership, vector scope replacement/backpressure, and Fabric actor dotenv
  isolation. Events continue through Zero's standardized observability boundary.
- Corrected theme/tooltip/icon/sidebar/progress presentation and keyboard access,
  bounded animated tabs when changing layout modes, and excluded UI test/fixture
  modules from public wildcard resolution.

## 2.1.1 - 2026-10-04

This fix-forward release contains the complete 2.1.0 feature set below. The
2.1.0 checkpoint was retained locally rather than retagged and was not
published to npm.

### Fixed

- Fixed local and saved-package updates retaining the previous framework
  archive's transitive dependency graph after installing new framework source.
  The updater now resolves the replacement through one private, unique staged
  archive reference, restores the app's `package.json` byte-for-byte,
  canonicalizes only the managed framework lock reference and integrity, and
  removes staging. It verifies the canonical install leaves the resolved lock
  byte-identical and that archive-owned installed files exactly match, so a
  later frozen install cannot reuse the previous payload. This refreshes
  Zero-owned dependency metadata without deleting the app lockfile, broadly
  resolving unrelated packages, or requiring manual cache or `node_modules`
  cleanup. Update failures restore the prior manifest, lock, archive, and
  installed framework through the existing rollback boundary.

## 2.1.0 - 2026-10-04

This is an additive minor release on the Zero 2.x Guardian/Fabric/Torrent
architecture. The AI SDK 7 and DataTable surfaces do not require a database
migration or rewrite existing UI call sites; `onCellCommit` is an optional
custom-writer override. This release is not a migration of legacy 1.3 database
layouts and is not backported to the maintained `release/1.3` line.

### Fixed

- Administration Organization members can now hold ordinary tenant-scoped app
  roles, platform/application roles, or both. Ordinary app roles authorize only
  that organization's own app data; platform operations still require explicit
  live application authority, customer organizations still reject platform
  roles, and Guardian API keys issued there remain tenant-scoped. Invitation,
  role-management, MFA, packaged-control, and live-revocation paths now share
  the same boundary.
- Fixed ReactiveDB Sync WebSocket lifecycle tracking to use Bun's stable raw
  socket identity across Elysia callbacks. Disconnect and plugin disposal now
  permanently fence pending identity/access resolution, clear active tracking
  and handshake/revalidation timers, and prevent late authorization from
  reactivating a closed connection. Authorization state is committed to a
  socket only after every asynchronous check succeeds while that socket is
  still live.
- Exported `createAuthorityScopedServerServices` and its option/result types
  from `@zero/framework/server` for verified app-owned machine principals.
  The boundary requires both asynchronous and synchronous live Guardian
  authority fences and does not turn a caller-selected tenant into authority.

- Fixed direct and composed Fabric realm admission so tables are installed in
  deterministic foreign-key dependency order instead of lexical order.
  In-realm dependencies, including cross-contribution and quoted references,
  now create their parent tables first; Guardian's framework-owned identity
  anchors and migration-created support tables remain valid external parents.
  Unsupported in-realm cross-table dependency cycles fail startup with a
  stable database configuration error, while external references remain under
  runtime schema verification rather than composition-time rejection.
- Fixed a Guardian browser deadlock where an anonymous Sync reset advanced the
  authorization data revision and permanently hid public login or first-admin
  bootstrap UI behind “Restoring your secure session…”. A settled signed-out
  scope now remains readable after its cache is purged, while authenticated
  replacement data, stored-session restoration, logout, revocation, and scope
  transitions retain their fail-closed boundary.

### Improved

- Added the public, table-independent `DataTableControls` shell and reused it
  across DataTable, Data Studio, Storage Studio/file browsing, global-user,
  tenant-member, and platform-workspace toolbars. Search remains first before
  selectors and filters, uses the standard 112 px collapsed / 216 px expanded
  behavior, and optional controls/actions/supplemental content keeps one
  responsive layout. Existing table-aware slots, filtering, debounce, focus,
  and specialized component props remain unchanged; application call sites
  require no rewrite.

### Added

- Expanded `DataTableView` with an additive isolated server source for
  authenticated offset queries and custom cursor adapters; optional totals;
  partial controlled state; stable min/max/flex/wrap/truncate sizing; and
  authorization-fenced stale-request handling. Inline, row, and page-bulk
  actions now support awaited acceptance, pending/error state, confirmation,
  and lifecycle abort signals. Existing arrays, collections, lazy sources,
  synchronous actions, and collection `onCellEdit` notifications remain
  compatible; `onCellCommit` is the explicit custom-writer override. Server
  selection and CSV export remain loaded-page operations unless an app supplies
  an explicit all-matching backend target or export endpoint.
- Added exact-receipt optimistic mutation APIs for Sync and typed collections:
  `insertAsync`, `updateAsync`, and `deleteAsync`/`removeAsync`. Existing void
  mutations remain backward compatible. Async writes resolve only after their
  exact server acknowledgement and reject through secret-safe
  `SyncMutationError` codes on server rejection, transport timeout, snapshot
  replacement, reset, authorization-scope replacement, or disconnect. Caller
  abort and bounded wait timeout stop only the promise wait and never pretend
  to cancel a write that may still commit.

- Expanded Zero AI into a broad first-class official provider catalog across
  language, embedding, image, transcription, and speech adapters, including
  Vercel AI Gateway, Azure OpenAI, Amazon Bedrock, Google Vertex AI, Mistral,
  Together AI, DeepInfra, Cerebras, Fireworks, fal, ElevenLabs, and additional
  official AI SDK providers. Provider construction now uses focused cloud,
  language, media, and extended factories; config supports custom fetch,
  headers, and typed provider settings. Cloud readiness handles Bedrock's
  region/credential alternatives, Azure endpoint/key-or-token auth, Vertex
  express/ADC modes, and explicit Gateway OIDC without treating partial ambient
  config as active. Gateway OIDC uses `apiKey: null` so an ambient Gateway key
  cannot silently change the selected mode. Provider key/base-URL config now
  documents its omitted/string/`null` inheritance contract, including Bedrock
  `AWS_ENDPOINT_URL`. Provider IDs, absolute HTTP(S) endpoints, supported
  adapter settings, and capability ceilings now fail invalid config closed
  instead of accepting ambiguous or ignored values. Native DeepSeek,
  Perplexity, and Voyage adapters retain
  compatibility with their established explicit OpenAI-compatible configs.
  Initialization failures now use stable Zero AI errors and secret-safe
  observability, and provider docs/env/Doctor guidance cover the full catalog.
  Audited request contracts also cover Anthropic bearer auth, cloud credential
  precedence, current Gateway/direct model aliases, multimodal capability
  admission, fixed-origin audio proxying, streaming enforcement, and
  secret-safe provider status origins. Bedrock text-only turns now retain
  completed tool history through a bounded, non-executable text projection
  when native tool blocks would be invalid; unsafe projections fail closed.
  The discontinued direct Meta-hosted
  Llama transport was removed; its released imports and provider type now
  produce a no-network `AI_PROVIDER_RETIRED` migration error, while Llama
  remains available through supported hosts such as Bedrock, Groq, Together
  AI, Fireworks, Hugging Face, and OpenAI-compatible endpoints.
  `AI_CONFIGURED` plus provider/request events document the bounded metadata
  and caller-metadata redaction contract.
- Upgraded Zero's AI surface to AI SDK 7 while preserving the established
  `AIService` request contract. Additive APIs include `AIOutput` structured
  generation, provider-neutral reasoning and bounded timeout controls,
  `embedMany()`, reranking, provider-hosted reusable files, preview video
  operations, typed tools and ephemeral agents, and Torrent-backed durable
  resumable agents with signed approvals. Managed generation and agent paths
  now share capability admission, app-local lifecycle/request telemetry,
  immutable bounded JSON contexts and tool results, and Bun-native DNS-pinned
  prompt downloads that reject private destinations and enforce redirect,
  cancellation, timeout, and aggregate byte limits.
- Added declarative ReactiveDB database functions and AFTER triggers through
  `@zero/framework/database-automations`. Synchronous transaction functions can
  enforce same-commit invariants and rollups, while durable functions use a
  source-local transactional outbox, fenced leases, bounded retry/dead-letter
  handling, crash recovery, authority-scoped Zero services, Fabric-wide source
  discovery, and exact idempotent Torrent event delivery. Configuration,
  actor-protocol admission, Doctor diagnostics, observability, package exports,
  and deployment documentation are included. System migrations `036` and `037`
  add Torrent system-event receipts and the automation source catalog.
- Added opt-in Storage Studio: Guardian-scoped application, organization, and
  personal managed drives over the existing Storage engine, with stable keys,
  quotas, lifecycle and durable cleanup jobs, typed browser/scoped-server APIs,
  server-backed file search, object ACL editing, previews, and an adaptive
  control plane. It is independent of Fabric and disabled by default, so
  existing Storage routes, hooks, and bare `StorageManagement` usage remain
  behaviorally compatible. System migrations `034` and `035` add Studio
  sidecars and shared-CAS leases. Custom adapters must declare cooperative or
  durably journaled shutdown behavior and provide synchronous fenced deletion;
  enabling Studio additionally requires the adapter's `shared-cas`
  declaration and closes legacy unmanaged drive creation.

- Added the opt-in Data Studio feature for organization-owned runtime data in
  Fabric tenant databases. It includes fixed ReactiveDB storage for bounded
  logical schemas and rows, Guardian permission/role fragments, registered
  actor queries and commands, scope-closed Elysia APIs, typed browser clients
  and hooks, lightweight Sync invalidation metadata, and an adaptive packaged
  control plane with smooth geometry-preserving inline cell editing. Complete
  installation is admitted only for multi-tenant, advanced-authorization,
  tenant-database Fabric deployments. The official Resource fragment must be
  installed unchanged: partial, altered, or otherwise unsupported normalized
  Resource contracts fail closed with `DATABASE_CONFIG_INVALID` during startup.
  Admission also pins the official fixed schemas and Guardian metadata,
  mutation validators, actor query/command handlers, and catalog-full/row-lazy
  client Sync modes; same-name substitutions fail closed.
- Added the tokenized, display-only `SecretField` component for masked API
  keys, tokens, and signing secrets. It supports bounded prefix/suffix masking,
  controlled or uncontrolled reveal state, permanently masked and non-copyable
  policies, full-value clipboard copy with accessible status, narrow and React
  barrel exports, `zero add components/secret-field`, keyboard-safe manual
  selection, and Guardian's masked one-time issue/rotation reveal. The adapted
  MIT-licensed Mischief UI source is pinned in `THIRD_PARTY_NOTICES.md`.

## 2.0.0 - 2026-10-02

Major platform release unifying Zero's three named foundations: **Guardian**
for identity, tenancy, and authorization; **ReactiveDB Fabric** for isolated
multi-database application data; and **Torrent** for durable, versioned
workflow orchestration. These are product/documentation names—the established
`auth`, `databaseTopology`, and `workflows` APIs remain stable.

This release intentionally separates Zero/Guardian/Torrent system state from
application data. Fresh applications receive the split automatically. Legacy
combined databases must follow the documented backed-up, offline,
application-specific split procedure; Zero fails closed instead of moving
authority data silently. Applications that must remain on the legacy 1.3
database topology can use the maintained `release/1.3` Torrent compatibility
line without adopting Guardian/Fabric 2.0.

### Added

- Added a responsive DataTable toolbar contract with compact, table-only
  animated search; accessible Escape/Enter and reduced-motion behavior;
  configurable search widths and labels; arbitrary `controls`, `actions`, and
  `supplemental` slots; table/search/filter/selection render context; and
  wrapper forwarding through optional `tableToolbarSlots`. Existing boolean
  `searchable` and `toolbarActions` call sites remain source-compatible and
  require no migration, while the new public Popover
  package path supports first-class filter and action compositions.
- Upgraded `ThemeTogglerButton` with one inline SVG that rotates and reshapes
  between sun and moon states, a click-origin circular View Transition for the
  full page, keyboard-centered activation, resolved system-theme rendering,
  reduced-motion handling, and immediate fallbacks for unsupported browsers.
- Added the MIT-licensed Mischief UI `StreamingText` component as a first-class
  Zero surface for static, caller-owned progressive, replayed, and live async
  string output. It includes a semantic-token cursor, reduced-motion behavior,
  sentence-level polite announcements, source replacement fencing, callbacks,
  root and narrow package exports, `zero add` support, and browser lifecycle
  coverage. The package retains the immutable upstream source and license
  notice in `THIRD_PARTY_NOTICES.md`.

- Added a safe-by-default installation bootstrap ceremony at `auth.bootstrap`.
  Fresh authenticated apps now require an operator-held secret of at least 32
  characters (or an explicit `public`/`disabled` choice); Zero rejects invalid
  setup authority before password hashing, rechecks it under the serialized
  registration transaction, and durably closes bootstrap with the first admin.
  Public/admin config responses expose only readiness flags, the packaged
  register form supports the setup key, Doctor diagnoses missing/public setup,
  and upgraded databases with existing users are sealed automatically.
- Added explicit auth capability axes for `tenancy: 'single' | 'multi'` and
  `authorization: 'simple' | 'advanced'`. Existing/omitted configuration
  normalizes to `single/simple`; all four profiles now resolve through the same
  app-local authorization kernel. The existing global `users.role` remains a
  legacy compatibility boundary for declared global-admin routes and global-
  role mutation; it is distinct in both directions from advanced application
  permissions and never grants customer-tenant data access.
- Added durable multi-tenant browser sessions, explicit tenant selection and
  refresh-family-backed switching, transactional tenant creation, protected
  owner invariants, live membership/tenant generation validation, and
  tenant-aware native sessions. Registration can atomically provision the
  protected Administration Organization during installation bootstrap or
  return an identity-only onboarding continuation after bootstrap.
- Added static declarative permissions and simple/advanced scoped roles with
  retained assignment history, protected ownership transfer, optimistic role
  revisions, live grant-ceiling checks, and inert cleanup of retired role
  definitions. `single/advanced` includes the namespaced `/auth/application`
  control plane, typed client surface, identity-safe hook, and application-role
  composition in the adaptive `UserManagement` control plane.
- Added multi-tenant member administration, one-time expiring invitations,
  invitation-bound account creation, retained join requests, typed tenant
  administration clients/hooks, and packaged member, onboarding, creation,
  selection, and switching controls. The adaptive member control plane includes
  a focused invitation dialog with pending-only cursor pagination, explicit
  revoke confirmation, capability-projected roles, and one-time manual-token
  handling.
- Added one protected Administration Organization for each multi-tenant app,
  created atomically at bootstrap and visibly distinguished from customer
  organizations by the required tenant `kind`. The bounded `/auth/platform`
  control plane, `client.platformAdmin`, scope-fenced hooks, and capability-
  driven packaged controls now manage its members, invitations, roles, and
  ownership; browse/create/suspend/reactivate customer organizations; and
  inspect or administer customer memberships and roles without accepting an
  administration tenant ID from the browser. Cross-workspace member writes
  require `application.tenants:read`, `application.users:read`, and the new
  `application.tenant-members:manage`; reuse tenant role-revision, grant-
  ceiling, ownership, error, audit, and transaction guarantees; and never
  grant customer application-data access or global account controls to tenant
  organization managers. The adaptive Workspaces view composes these actions
  into its selected workspace/people control plane.
- Added opt-in verified-company-domain request onboarding with exact DNS and
  current-mailbox proof, non-enumerating discovery, retained fixed-role join
  requests, packaged administration/onboarding controls, and an owner-only
  release lifecycle with retained provenance and a seven-day cross-tenant
  quarantine. Domain autojoin, aliases/wildcards/subdomain inference, direct
  transfer, and upstream enterprise SSO remain separate future capabilities.
- Added a bounded append-only authorization and account-security control-plane
  audit. Protected mutations write their event transactionally where the
  underlying change is local; authorized platform/tenant list and export,
  retention, strict browser parsing, hooks, and a packaged viewer are included.
  This is deliberately not a general page/read/application-CRUD activity log.
- Added a sanitized current-authorization browser snapshot plus permission,
  tenant, and platform-admin gates. Browser credential transport now owns
  restoration, refresh, multipart authentication, authorization epochs,
  response-body fencing, cross-tab coordination, Zero-owned hook cache purging,
  and app-subtree/overlay replacement so UI state cannot be reused across
  accounts or tenants. Apps with their own caches can consume the public,
  credential-free `useAuthorizationScopeBoundary()` key and readiness state.
  Administration sessions also receive a separate additive
  `applicationScope` projection for live application-control-plane permissions;
  permission helpers inspect both projections, while tenant gates remain bound
  only to the active tenant scope.
- Added `authorizationPolicy()` for server-only resource declarations. Managed
  CRUD, lazy `/api/data`, and WebSocket Sync now evaluate the same structured
  access requirement and live application/tenant RBAC scope used by route
  guards, including advanced additive assignments and transaction/socket
  authority fencing.
- Added an explicit server-owned resource `exposure` axis: `internal`, `http`,
  `sync`, or `all`. Multi-tenant mode requires every registered resource to
  choose one; single mode preserves omitted-as-`all` compatibility. Sync-only
  resources must use full Sync, while lazy or auto-lazy Sync hydration requires
  `all` because it also reads through `/api/data`. Explicit `actions: []` now
  means no managed operations, and per-action policy maps reject unknown or
  undeclared action keys instead of silently retaining dead policy.
- Added opt-in immutable registered-resource field allow-lists through
  `defineResourceFields({ read, create, update, filter, sort })`. Managed CRUD,
  `/api/data`, Sync snapshot/catch-up/live/ack delivery, filters/sorts, caches,
  packaged forms, and cache-backed exports now use the same projection and
  client-write contract. Writes default to no fields once the contract is
  present; direct SQL, unregistered tables, custom endpoints, and app-owned
  exports remain trusted application code.
- Added migration `020`'s durable auth-authority revision. Security-relevant
  account/session/tenant/membership/assignment writes advance it through
  SQLite triggers, and managed Sync runtimes sharing the file poll it to
  promptly revalidate local sockets and managed ephemeral bindings.
- Added migration `021`'s join-request provenance fence. Verified-domain
  evidence now names its exact retained-request revision/source, legacy rows
  remain fail-closed until explicit resubmission, approve and deny require an
  optimistic `expectedRequestRevision`, and fixed/default approval roles stay
  entirely server-owned.
- Added migration `023`'s durable installed-auth-profile identity and monotonic
  generation. Startup now distinguishes exact restarts from supported
  simple-to-advanced adoption, transactionally preserves retained
  multi-tenant roles and live browser/native session families, rejects
  ambiguous legacy or reverse/tenancy-axis reinterpretation, blocks transitions
  around pending registration provisioning, and fences stale runtimes and Sync
  authority through the shared revision clock.
- Added migrations `024` through `028` for the protected Administration
  Organization, server-owned MFA assurance, invitation grant snapshots, and
  the durable authorization-registry manifest, plus exact administrator-user
  provisioning receipts. Legacy or missing MFA assurance
  steps up under the configured policy; pre-snapshot pending invitations must
  be reissued and current grants may narrow but never widen; and permission,
  role, profile, and evaluator semantics are fingerprinted behind monotonic
  `auth.authorization.registryVersion`. Same-version drift, rollback, corrupt
  manifests, and retained-assignment role reactivation fail startup, registry
  changes are system-audited, and stale runtimes fail closed.
- Hardened the durable Sync log as an exact, versioned compatibility boundary:
  storage classes, collations, indexes, triggers, and affected-row counts are
  validated; application/log writes remain atomic; history gaps reset policy
  state synchronously; and observer, filter, or projector failures now latch
  the runtime closed for current, pending, and future sockets instead of
  advancing past an authorization event. Managed writes now use PK-targeted
  ABORT upserts, canonical persisted row ids, target postconditions, lossless
  JSON payloads, rollback-only synchronous transactions, validated polling
  intervals, exact `RETURNING` confirmation for durable log inserts, and reject
  unobservable cascading/value-setting foreign-key actions. Replica dispatchers
  also latch closed if a trusted sequence or pruning watermark moves backward.
  Schema definition is now atomic and prohibited inside managed transactions;
  internal change row IDs must be non-empty strings; and pruning verifies the
  exact sequence, watermark, and retained-row postconditions before commit.
  Every outer managed write also fences the exact protected main/temp trigger
  set after any schema-version change and again after in-transaction DDL.
  Main-schema changes additionally revalidate every registered table's stored
  `CREATE TABLE` definition, object, column/default/constraint/collation/
  primary-key structure, and nonmutating FK actions. DDL-only schema installers
  remain supported, while transactions that mix any DDL with tracked changes
  roll back to prevent create/use/remove trigger or cascade side effects from
  escaping the durable log. Trusted scoped reads/writes and optimistic expected-
  row predicates now require exact JavaScript, SQLite storage-class, and
  `BINARY` equality, so declared `NOCASE` collations or affinity coercion cannot
  broaden an authorization boundary.
  Snapshot readers are explicitly synchronous and managed-read-only: escaped
  continuations remain poisoned, and caught write/schema/dispose attempts still
  roll back any enclosing transaction. Listener thenables are reported as
  contract violations with later rejections consumed, and listeners receive
  isolated canonical payloads through stable subscription snapshots and whole-
  batch reentrant ordering.
- Added the authoritative Zero auth philosophy, phased implementation
  checklist, and detailed audit/design record covering tenant isolation, RBAC,
  onboarding, verified domains, upstream SSO, Elysia integration, packaged
  control UI, installed clients, and the server-only schema-adjacent table-
  security direction.
- Documented the Zero 2.0 boundary explicitly: the protected Administration
  Organization and bounded platform tenant lifecycle UI are implemented;
  upstream enterprise SSO, break-glass, tenant-custom roles, broader
  populated-app discovery/migration tooling beyond exact pre-024
  administration reconciliation, verified-domain autojoin/aliases/direct transfer, and
  distributed coordination for separate-database/cross-host replicas remain
  deferred. Shared-file row
  fanout/auth invalidation and managed resource field policy are implemented;
  `hot`/`ephemeral` runtime replication, a cross-runtime ephemeral topic bus,
  application-owned caches, and raw SQL/custom response projection are not
  implied by those managed boundaries.
- Added ReactiveDB Fabric, an opt-in actor-backed multi-database topology which
  keeps the shared application database pinned while routing named or
  authenticated physical-tenant application data into independently reactive
  SQLite files. Guardian/Zero authority stays in the separate pinned system
  database.
  Fabric provides per-database FIFO writers, optional same-file WAL readers,
  concurrent work across admitted files, bounded file/hot/hybrid placement,
  strict root/file/logical identity and orphan-actor fencing, durable
  idempotency receipts, bounded restart backoff, app-local structured
  observability, and stable database/HTTP/Sync failure contracts.
- Integrated physical tenant databases through generated Resource CRUD,
  `/api/data`, request-local `zero.data`, and multiplexed ReactiveDB Sync. The
  server derives routing only from live authenticated tenant authority;
  snapshot pages materialize one exact durable head before contiguous replay,
  authority is rechecked across asynchronous and commit boundaries, and file,
  receipt, queue, binding, snapshot-session, payload, and transfer work all
  have explicit limits. Added the declarative `databaseTopology`/actor-realm
  surface, Doctor findings, package exports, deployment constraints, and the
  full Fabric architecture and SDK documentation. Zero 2.0 supports this
  inside the documented single-coordinator, exclusively owned local-root
  deployment boundary.
- Added always-separate pinned system and application database planes. `db`
  remains the application-facing `zero.db`/`zero.sql` plane; `systemDb` owns
  Guardian authority and Zero service state behind the privileged
  `zero.system` facade (or deliberate `zero.unsafe.system` boundary in
  multi-tenant request code). Startup rejects handle, main-file, snapshot,
  WAL/SHM/journal, filesystem-alias, and authority-sidecar collisions. This is
  a breaking storage-boundary change: legacy combined Guardian/application
  layouts fail closed with `DATABASE_SCHEMA_MISMATCH` and
  `requiredAction: 'split-system-database'`, while an application-owned
  `users` table alone remains valid. Existing deployments own a deliberate
  backup, stop, offline extraction, anchor seed, and verification migration;
  Zero does not silently mutate them. A future automated offline splitter is a
  convenience rather than a prerequisite for new separated-plane installs or
  deliberately migrated deployments.
- Added schema-declared, ID-only Guardian user and membership anchors for
  application and physical-tenant foreign keys. Guardian commits enqueue a
  durable system outbox; idempotent target receipts, watermarks, leases,
  quarantine, and installation binding drive shallow projection without
  copying credentials, email, roles, permissions, profile properties, or
  other PII. The authenticated data-realm readiness routes, client API/hook,
  and `DataRealmReadyGate` keep application collections closed until required
  anchors are ready while Guardian controls remain usable. The server-only
  auth barrel also exposes the stores, service, lifecycle hook, stable error
  codes, options/target contracts, and installation constant needed by
  advanced standalone adapters; managed apps continue to let `createApp()` own
  this lifecycle, and internal projection table rows are not an app query API.
- Added migration `029` and first-class Guardian user API keys. Keys are bound
  to one live user and, in multi-tenant mode, one live organization membership;
  only a SHA-256 digest and bounded lifecycle metadata are retained after the
  one-time secret reveal. Declarative policy controls self-service and tenant-
  administrator issuance, lifetime, and active-key limits. The typed client,
  hooks, packaged controls, audit events, Bearer authentication, rotation, and
  revocation all reuse Guardian's live RBAC and authority-generation checks.
  Service-level keys, HMAC request signing, and IP allow/deny policy remain
  separate future security slices rather than implied capabilities.
- Added one authority commit protocol across the separate system/application
  files. Process-local shared/exclusive leases close the final validation gap,
  and file-mode system authority adds the crash-released, zero-wait
  `<systemDb.path>.authority-fence.sqlite` lock so independent processes cannot
  interleave either a pinned or Fabric tenant application commit with a
  Guardian authority commit. Tenant writer actors reread the captured system
  revision at their own final commit edge and take compatible shared sidecar
  leases, preserving concurrent commits across different tenant databases.
  The sidecar stores no identity or application data.
- Added stable Sync negative-acknowledgement recovery codes
  `SYNC_DATA_REALM_NOT_READY` and `SYNC_DATA_REALM_UNAVAILABLE`, alongside the
  existing receipt-expiry/capacity codes. `sync.ack` now carries its owning
  `plane` when required by multiplexing plus optional machine-readable
  `errorCode`; clients roll back the rejected optimistic attempt and follow
  readiness state instead of parsing or tight-looping the human error string.
  `ClientConfig`/`SyncClientConfig` and both client surfaces now expose
  `onMutationRejected`, delivering the exported table/operation/plane/code/
  source record only after local rollback without allowing observer failures
  to interrupt Sync progress.
- Added the runnable `examples/guardian-fabric-proof` application as the
  combined Guardian/Fabric/Torrent acceptance fixture for the Administration
  Organization, customer workspaces, advanced RBAC, user API-key lifecycle,
  ID-only Guardian anchors, physical tenant task databases, multiplexed
  realtime Sync, and a versioned human-review workflow whose approved branch
  writes through its actor-scoped Fabric capability. Its tests use the same
  pure configuration factory as the runnable server so fixture-only policy
  cannot drift from the documented example.
- Added a safe, configurable web-auth return flow. Apps can set the top-level
  `postLoginPath` option (also available on `AppProvider`) while one validated
  local `redirect` deep link takes precedence after login. Server guards retain
  the requested path and query, client guards can also retain the fragment, and
  authenticated visits to the login route no longer strand users there.
- Added `useAuth().isRestoring` and coordinated browser refresh-token rotation.
  Browsers with Web Locks serialize one-time token rotation across tabs and
  workers, and each waiter rereads the current persisted token after acquiring
  the lock before it refreshes.
- Added native desktop and mobile authentication through a registered public
  OpenID Connect Authorization Code + PKCE provider and the
  `@zero/framework/native` SDK. Native sessions use the existing Zero users,
  MFA/account gates, route/resource authorization, live revocation generation,
  rotating refresh-token families, system-browser registration, and secure
  platform storage adapters; no client secret or copied signing key is used.
- Added packaged, dependency-free desktop loopback and mobile browser-session
  adapter recipes, plus outside-tree tarball compilation coverage for the public
  native SDK entry point in Bun desktop and browser-compatible build targets.
- Added a process-shared native credential broker and revision-ordered IPC
  client so multi-window apps keep one vault owner and cannot apply delayed
  authentication or access-token responses after sign-out.
- Documented the Chrome Manifest V3 public-client profile: service-worker
  credential operations, revision-ordered extension-page messaging, exact
  `chromiumapp.org` redirects, Chrome Identity, narrow host permissions, and
  non-synced credential storage. Privileged extension pages remain explicitly
  trusted because Chrome storage is not worker-isolated. The independently
  versioned Chrome adapter is a functional private `0.0.0` preview and is not
  bundled into applications created or updated by Zero. Its extension-global
  storage binding prevents server, client, persistence, or namespace changes
  from orphaning an older refresh family.
- Added safe-by-default native authorization admission keyed from the direct
  socket peer, plus explicit trusted-proxy CIDR unwrapping that ignores spoofed
  forwarding headers from untrusted connections and rejects universal `/0`
  trust ranges.
- Added `zero update` for narrowly scoped framework dependency upgrades in
  existing apps, with local-checkout and published-package sources, dry-run
  planning, opt-in project checks, installed-package verification, and
  transactional backup plus attempted rollback of Zero-managed artifacts when
  installation fails. Rollback failures preserve a recovery backup and are
  reported explicitly. Added a checkout-bound `zero-update`
  wrapper for safely refreshing local package-mode apps without regenerating
  app code.
- Added opt-in browser-grade PDF rendering through `zero.pdf` and
  `@zero/framework/pdf`, including modern HTML/print CSS support, secure
  resource defaults, bounded rendering, direct storage composition, stable
  errors/observability, and replaceable renderer/storage adapters.
- Added `zero pdf install` and `zero pdf status`, generated-app convenience
  scripts, Platform Doctor PDF checks, deployment configuration, real Chromium
  integration coverage, and comprehensive PDF documentation.
- Added **Torrent**, Zero's durable versioned workflow graph engine. The code DSL and canonical
  JSON-safe IR now support trusted versioned activities, persisted choices,
  concurrent branches with deterministic joins, bounded keyed array fan-out,
  channel-neutral human/external interactions, and ReactiveDB-backed private
  scratch memory. Code and database definitions share append-only versions,
  canonical fingerprints, mutable revision-fenced drafts, activation and
  retirement, plus an administrator definition API guarded by the explicit
  `databaseCallable` activity boundary.
- Added real-time graph observability through safe owner/scope-manager-filtered
  `workflow_steps`, `workflow_events`, and `workflow_interactions` projections.
  React workflow hooks now expose all active nodes, ordered redacted events,
  open waits, accurate parallel/input-wait flags, stable root-node progress,
  separate fan-out/delivery progress, version-pinned starts, and idempotent
  response submission whose privacy-safe result retains public validator
  rejection codes/messages without returning response values. The scope-fenced
  `useWorkflowTopology` hook loads a
  run's immutable sanitized presentation topology once and reports current
  transport failures through a stable frontend observability code. Definition
  IR, memory, policies, every event payload, interaction bodies, and all
  workflow instance/step inputs, outputs, and raw errors remain server-only.
  The frozen
  migration `030` adds graph/version/interaction state and conservatively
  backfills compatible Zero 1.3 workflow history. Appended migration `031`
  preserves that history while adding tenant-scoped interactions, per-scope
  definition names, immutable parent scope, and non-cascading observable
  workflow relations.
- Hardened workflow Sync composition with a composite owner/manager plus
  delegate read-authority fence. Delegate denials, predicates, projectors, and
  validators remain authoritative; advanced-RBAC management resolution must
  be synchronous, and stale or non-comparable filtered sockets fail closed
  before final row delivery.
- Bounded durable workflow execution state with a 1 MiB per-value limit, a
  transactional 32 MiB per-run execution-value budget, per-interaction
  submission count/byte limits, and per-run event inbox/retention count and
  byte quotas. Paused graph runs buffer authenticated named events but reject
  direct interaction submissions with retryable `WORKFLOW_DRAINING`, preventing
  authorization or validation work from racing resume.
- Bound delayed authenticated event responses to a private MAC-sealed Guardian
  authority and exact actor snapshot, with live actor revalidation before
  policy and commit. Added an explicit scope-checked system-event entry point;
  legacy/unsealed events can no longer answer interactions.
- Fenced custom interaction authority through the final response transaction.
  Synchronous policies are reevaluated at commit, while asynchronous allows
  must return a revision-aware lease with a synchronous commit assertion;
  unfenced async allows fail closed as invalid configuration.
- Sealed the complete durable event command/private envelope and made it
  immutable. Event-delivered interaction responses now carry a trusted origin
  and exact event foreign key; the public `event` channel/submission namespace
  is reserved, released rows upgrade as untrusted external submissions, and
  terminal/restart cleanup no longer infers runtime authority from public
  strings.
- Added migration `032` and a private durable workflow runtime generation
  lease. One live service owns recovery and execution for each physical
  workflow database; heartbeat expiry permits takeover, while exact-generation
  commit fences reject late legacy, graph, fan-out, interaction, authority,
  event/pause, and definition/draft writes from a former owner.
- Added migration `033`, a topology-independent Torrent integrity layer shared
  byte-for-byte with the maintained 1.3 compatibility line. SQLite now rejects
  malformed definition catalog values, cross-source active versions, invalid
  retirement transitions, drafts whose source or base version does not belong
  to their definition, and incoherent claimed/consumed/discarded event-delivery
  markers on either legacy or authority-sealed schemas.

### Fixed

- Rebuilt durable workflow execution around a strict sequential frontier and
  crash-safe attempt fencing. Retries can no longer let later steps overtake
  an unfinished predecessor; buffered events, claimed payloads, wait and retry
  deadlines, pause duration, and idempotency identity now survive restart;
  cancellation, pause, timeout, and late handler completion use first-winner
  durable transitions. Startup registers application handlers before a
  whole-set recovery preflight, publishes the ready service before recovered
  work is dispatched, and fails closed on malformed state or missing live
  handlers without partially normalizing stored runs. Workflow HTTP and Sync
  reads are now owner-scoped, with manager access limited to the active
  application/tenant service-data scope; executable topology
  remains server-only, definition start/inspect access is declarative, and all
  Sync writes to framework workflow tables are denied. Added stable workflow
  error/observability codes, structured client `ApiError` handling, live React
  run/progress actions, indexed repository queries, immutable ownership/parent
  guards, deterministic restart/concurrency/lifecycle coverage, and complete
  registration, recovery, authorization, hooks, and Zero 1.3 upgrade docs.
- Made event-delivered interaction acceptance crash-consistent. Accepted
  responses retain their exact claimed event until claim consumption, queue
  accounting, and wait completion commit together; restart and competing
  external-response races now atomically discard losing reservations and
  claims without reapplying a response or stranding queue capacity.
- Hardened workflow composition boundaries: app Sync filter projections are
  composed with Zero redaction across snapshot, catch-up, and live delivery and
  fail closed if they change row identity; managed workflow observability
  emitters reassert live authority immediately before sink writes.
- Added a shared browser authorization-data revision for live same-scope policy
  changes. Sync purges now cancel scoped HTTP work, clear cached authorization
  and workflow topology, reject late responses, and mask official hooks until
  replacement authority validates even when account and tenant IDs are stable.
- Made KV same-key mutations genuinely atomic within one service instance.
  Compare-and-set, counters, and all limiter shapes now make their decision and
  commit under one per-key boundary, return the result produced by their own
  mutation, use one recorded timestamp across decision and replay, preserve
  independent-key concurrency for unbounded stores, and coordinate globally
  when bounded capacity can evict unrelated keys. Durable journals now use a
  strict v2 sequence format with compatible v1 migration, exact result capture,
  crash-durable file/directory sync, torn-tail repair, journaled TTL cleanup,
  and atomic fsynced checkpoints. Startup gates downstream Elysia routes until
  recovery completes; managed lifecycle and background-persistence events stay
  bound to their owning app runtime. Granular flush/checkpoint failure codes
  are dual-emitted with the deprecated background-persistence umbrella code
  during a compatibility window. Deterministic concurrency, lifecycle,
  persistence, checkpoint, upgrade, failure, and restart coverage protects the
  contract.
- Made Fabric coordinator existing-only acquisition prove the target file
  exists before reserving or evicting capacity, then recheck after admission to
  close disappearance races. Missing targets no longer evict a healthy idle
  actor at capacity. Aggregate drain/shutdown failures now include bounded,
  privacy-safe canonical failure-code counts without accepting actor-supplied
  aggregate metadata.
- Consumed every background Sync authorization-revalidation rejection and
  report it through `SYNC_AUTH_REVALIDATION_FAILED` with only the channel and
  trigger before fail-closed invalidation. Local socket authorization state is
  cleared even when subscription teardown, capability release, observability,
  or transport close throws, preventing one broken connection from preserving
  or blocking cleanup of the remaining sockets.
- Fenced identity-projection acknowledgements, releases, and quarantines by a
  monotonic lease-attempt generation, closing stale-worker ABA races even when
  the same worker ID is reused. Rebuilt-target replay now leaves immutable
  completed source history intact on retryable target failures, validates the
  exact durable lease/watermark schema, and keeps tenant target registration
  plus initial user/membership seeding atomic.
- Kept tenant Sync snapshot TEMP-table cleanup outside the durable authority
  commit guard so one completed snapshot cannot detach other live bindings.
  ID-only Guardian anchor projection now rechecks its private routed
  capability at the actor FIFO head without taking application-data commit
  authority, allowing an immediately added member to switch into the tenant
  while ordinary application writes remain revision-fenced.
- Moved persisted automatic Sync-mode decisions into `systemDb` while still
  measuring application rows from `db`, and reserved every ID-anchor/projection
  mirror table from generic Sync reads and writes. Separate application/system
  snapshots, catch-up cursors, built-in services, and physical table placement
  now have adversarial integration coverage.
- Distinguished a retryable Guardian mutation collision with an active data
  commit as `AUTH_COMMIT_CONFLICT` instead of incorrectly telling a current
  user that authentication state changed. Browser SDK errors expose the
  server-owned `retryable` flag without changing existing call shapes.
- Validated physical-tenant Sync catalogs during plugin composition and stopped
  disguising unexpected catalog/protocol construction defects as tenant-auth
  failures; only the exact missing-tenant-authority condition receives the
  authentication close code, while server defects follow standard Sync
  observability and failure handling.
- Made migration drift classification and `ADD COLUMN` draft generation share
  one SQLite-aware parser. Unsupported primary-key, unique, generated,
  autoincrement, default, `NOT NULL`, and foreign-key combinations are now
  omitted for explicit rebuild review; data-dependent supported additions are
  marked guarded, and foreign-key `SET DEFAULT` actions are no longer confused
  with a column default.
- Enforced one lossless primary-key contract across direct ReactiveDB schema
  definition, app-config resolution, Fabric realm admission, and physical
  actor startup. Application tables now accept only declared SQLite `TEXT` or
  `INTEGER` affinity primary keys; `REAL`, `BLOB`, `NUMERIC`, typeless, and
  composite keys fail before use. Column definitions are isolated before SQL
  generation with SQLite-aligned tokenization, so top-level separators,
  injected table constraints, comment-split constraints, or ambiguous quoted
  type declarations cannot create a hidden composite key. Safe integer keys
  canonicalize to protocol string row IDs, and Platform Doctor reports
  definition or affinity failures at the exact table column.
- Moved deterministic Fabric realm incompatibilities to definition-time
  admission. `defineDatabaseRealm()` now rejects non-primary `BLOB`/typeless
  columns, generated columns, mutating foreign-key actions, SQLite/Zero-owned
  object names, and natural-identity index/table collisions with
  `DATABASE_CONFIG_INVALID`; actor startup retains independent physical
  hidden-column, affinity, and schema-drift defenses.
- Restricted registered Fabric commands to a frozen tracked-data capability.
  Command handlers retain ReactiveDB CRUD, identity, query, transaction, and
  post-commit APIs without access to raw SQL/SQLite handles, schema mutation,
  listeners, lifecycle controls, or internal-change surfaces. The per-command
  facade is revoked after result validation so retained methods cannot mutate
  outside the receipt/publication boundary.
- Preserved hot-image write exhaustion as the closed `max-bytes` classifier
  across actor and coordinator sanitization. The existing app-local operation
  failure event now reports `failureReason: 'hot-max-bytes'` while continuing
  to discard paths, SQL, row data, raw SQLite errors, and measured byte values.
- Made tenant-member role selection explicit across validation and service
  boundaries. Creation defaults an omitted role list to `member`, rejects an
  explicit empty list, requires exactly one simple-mode role, and bounds
  advanced creation to 32 roles without silently choosing the first value.
  Customer membership updates may still deliberately clear assignable roles,
  while Administration Organization memberships must retain administration
  authority. Application and customer advanced replacement now treat only a
  literal empty array as a deliberate clear; malformed, sparse, blank, and
  duplicate headless inputs fail with stable validation errors instead of
  being filtered into a different grant set.
- Validated verified-domain request roles as customer-organization roles even
  while the feature is disabled, hardened tenant input canonicalization against
  non-string values, and kept empty/runtime auth service contexts structurally
  identical.
- Kept verified-domain onboarding `/start` non-enumerating during internal
  failures while reporting `AUTH_DOMAIN_START_FAILED` through the app-local
  error channel, retained private DNS causes without reflecting them to Auth
  clients, and deferred transaction-coupled Auth success events plus every Auth
  email-outbox worker wake until the outer commit succeeds. Invalid headless
  status/filter inputs now fail with stable typed errors before mutation,
  explicit runtime `null` role selections no longer become defaults, stale DNS
  leases emit no result, and platform-admin SDK role contracts encode non-empty
  selections with their required revision fence. Caller-owned registration,
  invitation-acceptance, and user-creation inputs are now detached before
  password hashing, DNS, proof, and live-authority callbacks can yield or mutate
  audit/authorization state; a failed post-commit observer can no longer report
  a committed domain verification as a failed request.
- Updated the Elysia, validation, file detection, Tailwind/Vite/PostCSS, and
  synchronized AI SDK dependency families within their supported major lines,
  eliminating all advisories reported by `bun audit`. Dependency auditing is
  now an explicit release and clean-checkout gate.
- Bound authenticated browser fetches to the configured Zero server origin.
  Cross-origin targets now fail locally with
  `AUTH_REQUEST_ORIGIN_MISMATCH` before restoration or credential access, while
  relative, root-relative, and same-origin absolute requests keep their public
  behavior.
- Restricted native identity state and Chrome broker IPC to the documented
  standard OIDC identity claims. Arbitrary signed private claims are discarded
  after validation instead of being persisted or copied across the public
  credential-free boundary.
- Made application startup and shutdown ownership atomic. Managed Auth, KV,
  and Workflow services now finish startup before `createApp()` publishes the
  app; standalone plugins gate requests on the same caught startup promise and
  stop their listener after failure. Failed composition disposes app-local
  registrations and owned SQLite, while Scheduler, PDF, Vector, and KV cleanup
  is idempotent and awaited by the runtime stop barrier.
- Closed a hot-SQLite shutdown durability race: a final synchronous snapshot
  now supersedes older in-flight periodic work without allowing that older
  completion to overwrite the close snapshot, and a failed final snapshot
  leaves the database open for an explicit retry.
- Fixed `multi/simple` to `multi/advanced` upgrades silently retaining only
  protected owners. Zero now validates and adopts every non-removed active or
  suspended membership role, preserves owner behavior, excludes removed
  history, rolls back the complete transition on any registry/readiness/audit
  failure, and records framework adoption with system provenance instead of a
  fabricated user actor.

- Fixed public tenant-onboarding request admission so invitation inspection,
  join-request submission, and verified-domain onboarding use the same
  exhaustive six-flow runtime and persistence contract. Append-only migration
  `022` preserves legacy rows and indexes while widening historical databases;
  migration `012` remains immutable, and tenant-only onboarding routes are
  concealed before admission in single-tenant mode.
- Made managed app shutdown transport-first and deterministic on Bun: Zero now
  force-closes the native listener before runtime/database cleanup, then runs
  Elysia stop hooks. Accordingly, `createApp().stop(false)` and `.stop()` also
  force-close active native connections; applications that need a protocol-
  level drain must complete it before calling `stop()`.
- Bound live Sync mutation origins to exact committed local sequences instead
  of ambient delivery state. Transaction batches retain one socket origin,
  reentrant application writes remain originless, delayed local drains keep
  their attribution, and rollback, gap, invalidation, external, and replay
  paths cannot leak it.
- Serialized concurrent migration runners on SQLite's writer lock and rechecked
  durable state inside each forward/rollback transaction, preventing two stale
  replicas from both applying the same migration during startup. Opposing
  forward/rollback operations now fail safely instead of creating dependency
  gaps, and incomplete registries refuse unknown durable versions. Lock-
  acquisition timeouts do not create false failure events; failed rollbacks
  retain their applied state; rollback keeps `_migrations` synchronized; and
  partial or previously stale legacy ledgers reconcile per version. Concurrent
  backup contenders retain one audited backup, while skipped copies are
  discarded. Migration Doctor now reports the latest failed attempt separately
  from the last successful applied/rolled-back state.
- Closed mutation-authority time-of-check/time-of-use windows across platform
  user administration, application-role administration, tenant invitations,
  join review, verified-domain operations, and related lifecycle email work.
  Long-running mutations now capture a secret-free reference to the exact
  request session and revalidate it at the transaction/commit boundary; email
  delivery rechecks authority before persisting usable links. Auth responses
  now use private/no-store cache policy except for public JWKS discovery.
- Hardened shared auth-authority polling against startup and concurrency races.
  A first durable revision observed after a socket handshake now revalidates
  that socket, and authority changes arriving during an in-flight socket or
  managed-ephemeral sweep queue a follow-up pass instead of waiting for the
  slower periodic fallback.
- Moved ReactiveDB change-sequence allocation from a process-local counter to
  a SQLite-owned transactional log state. Application writes, explicit-format
  replay rows, sequence advancement, pruning-watermark movement, and physical
  pruning now commit or roll back together; retained legacy-v0 histories resume
  above their existing maximum without collisions across file-backed writers.
  A reserved seq-0 sentinel, immutable-log triggers, exact startup validation,
  and a poisoned legacy allocator make format/downgrade mistakes fail closed.
  The first fenced upgrade requires a coordinated stop of every pre-fence
  process sharing the SQLite file and cannot be rolled back to an older binary.
  Database reopen retains replay history by default; intentional clear now
  discards retained positive rows without resetting/reusing the sequence.
  File-mode Sync now
  polls that durable log, relays other connections' writes through each
  runtime's ordinary policy/fanout path, suppresses local duplicates, and
  classifies retention/continuity/format gaps, synchronously resets stateful
  authorization-policy caches, and closes sockets for a clean snapshot.
  Missing/async/throwing resets and non-retryable log failures latch the
  runtime closed for current, pending-auth, and future sockets until restart.
  Managed table and State SQL is explicitly bound to SQLite's `main` schema so
  connection-local temporary tables cannot shadow durable writes. This shared-file
  support does not replicate `hot`/`ephemeral` databases, separate database
  files, cross-host messages, or RAM-only ephemeral topic values.
- Closed default `createApp()` framework-table Sync reads across snapshots,
  catch-up, and live delivery: users, workflow definitions, and Storage
  metadata are private; notifications, receipts, rooms, and workflows now use
  their target/owner/membership policies. Room authorization revisions update
  independently of requested tables, and each app's policy captures its own
  ReactiveDB instance.
- Hardened framework authorization boundaries for notification receipts, room
  membership/detail routes, workflow ownership, inherited file-route API auth,
  middleware user properties, and Storage property grants. Direct
  `StorageService` consumers using property grants must now provide
  `isPolicyTrustedProperty`; without it, new property grants are rejected and
  persisted property grants fail closed.
- Tenant-scoped registered resources now server-stamp their discriminator and
  enforce it in generated CRUD, `/api/data`, Sync snapshot/catch-up/live
  delivery, mutations, and final SQL commit boundaries. Notifications, rooms,
  Storage, state/ephemeral channels, and durable workflow execution use the
  same live tenant authority; a global platform administrator receives no
  implicit tenant data-plane access. Startup also verifies that the actual
  SQLite table has the configured resource primary key as its sole primary key
  and that its tenant discriminator exists, is `NOT NULL`, and is not the row
  primary key; Doctor separately warns when declared index guidance does not
  show the tenant field leading a likely index.
- Added request-bound server service facades for multi-tenant routes and sealed,
  revalidated workflow execution authority. Raw database and setup services
  remain available only through the explicit `zero.unsafe` escape hatch in
  tenant-shaped request code.
- Hardened local auth navigation against external, scheme-relative, malformed,
  duplicate, recursive, backslash/control-character, and canonicalization-unsafe
  redirect targets. Login paths with equivalent trailing slashes are treated as
  the same route, and unsafe return targets fall back to `postLoginPath`.
- Upgraded `DatePicker` from a button-only calendar trigger to a synchronized
  typed input and calendar control. Unambiguous U.S. numeric dates with `/` or
  `-` normalize to the existing long display, while invalid or disabled dates
  are never emitted through the controlled value contract.
- Fixed authenticated Eden Treaty requests, including multipart `File`
  uploads, so the browser sends exactly one bearer value, replaces it after a
  401 refresh, and waits for an in-flight session restoration before sending
  the request body.
- Made Sync reconnects authoritative across server restarts, authorization-scope
  changes, sequence gaps, and socket backpressure. Clients now replace stale
  full and lazy caches when required, purge data after access changes, and use
  bounded privacy-safe mutation receipts so an uncertain retry either returns
  the current authorized result or fails closed without executing a write
  twice.
- Made `create-zero --force` transactional and boundary-safe: CLI option values
  can no longer become deletion targets, broad/overlapping/symlinked paths fail
  closed, generation and local package installation finish in a sibling staging
  directory, and replacement uses a checked backup/swap with rollback.
- Isolated independently versioned Rust/Tauri and Chrome SDK repositories from
  framework packaging, test discovery, generated apps, and updates. Scaffold
  replacement now refuses targets containing root or nested Git repositories,
  and custom templates never copy `.git` metadata. Both SDK repositories remain
  functional private `0.0.0` previews, not released framework packages.
- Moved public password-recovery and verification-resend delivery onto a
  durable privacy-safe outbox with identical immediate responses, bounded
  leasing/retry/dead-letter behavior, terminal PII scrubbing, crash recovery,
  per-attempt provider idempotency, and shutdown ordering that joins delivery
  before Sync or SQLite teardown. Deterministic provider 4xx responses now
  dead-letter once with a stable safe code, while 408/425/429, network failures,
  and 5xx responses retain bounded retry behavior without storing provider
  response details.
- Made email verification a single atomic security transition: consuming one
  link now verifies the account, revokes pre-verification sessions, advances
  the auth generation, and invalidates every sibling verification link before
  a new session is issued. Standalone `createAuthPlugin()` compositions can use
  `installAuthStopBarrier()` so `await app.stop()` joins auth email delivery
  before the caller disposes its injected database; Doctor warns when a direct
  public plugin composition omits that barrier.
- Bound every local authentication completion to the exact security generation
  proved or committed by its password, registration, email-verification, MFA,
  invitation, or password-change ceremony. A concurrent reset or revocation can
  no longer let an older proof adopt a newer generation while token signing is
  in flight; the handoff fails with `AUTH_STATE_CHANGED`. Tenant-onboarding
  continuation consumers also recheck that generation inside the invitation or
  join-request transaction before consuming the one-time proof.
- Named Zero's integrated identity, tenancy, session, and authorization system
  **Guardian** in documentation without renaming any `auth.*` configuration,
  route, package export, database object, or TypeScript API.
- Preserved the documented single-tenant page-cookie upgrade path: a verified
  pre-upgrade cookie with no generation claim may adopt the current generation
  only through its exact live refresh row, while explicit mismatches and all
  unbound multi-tenant legacy credentials continue to fail closed.
- Replaced per-app anonymous SIGINT/SIGTERM listeners with one process-shared
  createApp shutdown dispatcher. Normal stops unregister cleanly, repeated
  signals share one shutdown, and every active app lifecycle settles before the
  process exits.
- Derived a stable RFC 7638 key ID when a managed `AUTH_SIGNING_KEY` JWK omits
  `kid`, keeping JWT headers and JWKS discovery consistent across restarts and
  replicas that share the same key material.
- Bounded canonical auth-email inputs to the practical 254-character mailbox
  limit before identity lookup, storage, or background delivery admission.
- Added centralized, generous auth HTTP request bounds so oversized login
  identifiers and passwords are rejected before Argon2, oversized tokens before
  hashing or JWT work, and oversized admin search/profile/property payloads
  before database work, while retaining structured JSON user-property values.
- Bound native access tokens to live session families so sign-out, replay
  detection, family eviction, client removal, and administrator revocation are
  enforced on the next Zero HTTP request instead of waiting for JWT expiry.

- Made guarded native-auth migration backups WAL-safe by snapshotting the live
  SQLite connection before schema rebuilds, so committed WAL pages and existing
  application data are present in the recovery copy.
- Auth-enabled apps now default WebSocket Sync to authenticated-only. Apps that
  intentionally expose anonymous Sync must opt in with `syncAuth: 'public'`;
  startup observability and Platform Doctor report when the secure default is
  inherited so upgrades are explicit.
- Restored readable dark-mode contrast for warning badges in the admin-user
  security and auth-readiness surfaces, and added a reusable theme-aware
  `warning` Badge variant.
- Canonicalized auth email identities by trimming and lowercasing addresses
  across registration, administration, login, and password recovery while
  leaving usernames case-sensitive. Password-reset confirmations are now
  enumeration-safe, and privacy-safe requested, delivered, suppressed, and
  failed-delivery outcome events distinguish operational results without
  logging addresses, action tokens, or provider credentials.
- Made administrator-forced password gates delivery-only: setup/reset email
  must be accepted before Zero gates the account and revokes sessions, generic
  user updates cannot enable the gate, failed admin-created setup delivery
  rolls back only an exact untouched new account, concurrent identity or
  durable-reference adoption preserves the account, expired receipts recover
  by the same rule, and an explicit confirmed recovery action can clear an
  already-stranded gate for another user while invalidating sessions and
  outstanding links.
- Made reset/setup password completion atomic and sessionless. A successful
  action consumes its exact one-time link, saves the new password, clears the
  password gate, revokes existing sessions, clears browser auth state, and
  requires a fresh login, so later MFA delivery or session-signing failures
  cannot make a committed password change appear to have failed.
- Hardened email lifecycle readiness and failure cleanup. Sender/reply-to and
  Resend API-key environment fallbacks now contribute to real readiness,
  link-email capabilities additionally require a public app URL, rejected
  recipients fail closed, and undelivered reset/verification tokens plus email
  MFA challenges are removed so retries are not trapped behind silent
  cooldowns.
- Upgrade note: action links created before this hardening do not carry the new
  identity/generation binding and are rejected after upgrade. Resend any
  still-pending setup, reset, or verification email from the upgraded admin UI.
- Preserved authentication across browser refreshes and direct protected-page
  navigation with a revocable HttpOnly page session, while keeping APIs,
  mutations, server extensions, and sync strictly Bearer-authorized. Authenticated
  SSR now bypasses ISR and uses private/no-store response policy.
- Made locally linked `zero-new` projects typecheck cleanly by preserving
  package symlink boundaries in generated TypeScript configuration.
- Declared Elysia's required runtime peers in the framework package so fresh
  package-mode projects can run Doctor and start without missing-module errors.
- Changed local app creation to install a publish-style framework archive,
  preventing duplicate React runtimes and checkout-only file links in apps.
- Expanded package regression coverage to install a packed framework in a
  temporary outside-tree app, verify packaged docs, typecheck, and render SSR.
- Increased the package integration-test timeout for slower mounted filesystems.

## 1.3.3 - 2026-10-02

Maintained compatibility release for applications that must remain on Zero's
legacy single-database 1.3 topology. Use the exact `v1.3.3` tag or the
maintained `release/1.3` branch; the normal stable update wrapper follows 2.0.

### Added

- Added a public token-aware Popover subpath for composing table filter menus
  and other app controls without importing internal Animate UI files.
- Added the MIT-licensed Mischief UI `StreamingText` component as a first-class
  Zero export for AI, agent, and live text output. It supports async string
  sources, caller-owned progressive text, known-text replay, semantic-token
  cursor styling, reduced motion, and sentence-level screen-reader
  announcements. The package, source-copy registry, docs, tests, and required
  Tinkerers Labs notice are included together.

### Improved

- Upgraded DataTable's toolbar into a responsive control plane with a compact,
  table-only animated search, schema-aware exact/contains/array filters,
  selection-aware `controls`/`actions`/`supplemental` slots, accessible
  pagination, wrapper forwarding, and packed-package coverage. The existing
  `toolbarActions` outlet remains backwards compatible.
- Reworked the theme control around one masked sun/moon SVG and a native View
  Transition that reveals the new theme in a circle from the activated toggle.
  Keyboard users receive a control-centered reveal, reduced-motion preferences
  switch immediately, unsupported browsers retain a safe fallback, and
  multiple toggles use independent hydration-safe SVG masks.

### Fixed

- Updated the maintained 1.3 line's coordinated AI SDK 6 provider family
  within its existing major versions so fresh 1.3.3 installs resolve the
  patched `@ai-sdk/provider-utils` cohort. The 1.3 line now commits its Bun
  lockfile so release verification is reproducible.

## 1.3.2 - 2026-10-02

Maintained compatibility patch for applications that must remain on Zero's
legacy single-database 1.3 topology. Use the exact `v1.3.2` tag or the
maintained `release/1.3` branch; the normal stable update wrapper follows 2.0.

### Fixed

- Made event-delivered interaction acceptance crash- and race-consistent.
  Accepted responses retain their exact claim until claim consumption, queue
  accounting, and wait completion commit together. A direct response that wins
  while event policy is pending now atomically releases the losing reservation
  and claim, including after restart, without stealing a later wait's event.

## 1.3.1 - 2026-10-02

Compatibility release for applications that must remain on Zero's legacy
single-database 1.3 topology. It names and hardens the **Torrent** workflow
subsystem without importing Guardian multi-tenancy, ReactiveDB Fabric, or the
2.0 system/application database split. This initial compatibility tag is
superseded by `v1.3.2` and should not be selected for new updates.

### Added

- Added the versioned workflow graph engine, database definitions and drafts,
  durable interactions, conditional/parallel/fan-out nodes, private scratch
  memory, owner-scoped real-time projections, and migrations `030`, `032`, and
  topology-neutral `033`.

### Fixed

- Hardened Torrent sequencing, retry/recovery, cancellation, pause, timeout,
  event/wait delivery, fan-out, definition integrity, privacy, authorization,
  single-owner runtime fencing, and accepted-event crash recovery.
- Made ReactiveDB tracked writes and durable sequence records atomic across
  handles, rejected asynchronous transaction callbacks, and preserved commit
  order for reentrant listeners and live Sync delivery.
- Included the maintained 1.3 line's KV concurrency/durability, authenticated
  multipart transport, auth-navigation, native-auth, Sync recovery, PDF,
  packaging, security, and lifecycle fixes accumulated since 1.3.0.

## 1.3.0 - 2026-07-06

Framework-readiness release focused on package-mode development, safer app
composition, stronger auth flows, richer admin surfaces, and a Zero-driven
LaunchBoard reference app.

### Framework Distribution

- Added a stabilization plan focused on audit, docs, package-mode hardening,
  local app creation, and release readiness instead of new feature expansion.
- Added a root `README.md`, comprehensive canonical `llms.txt`, and `llm.txt`
  compatibility pointer so humans and agents have clear framework entry points.
- Improved `create-zero` with `--local`, `--install`, and `--template` support
  for unpublished framework development and local app initialization.
- Converted `scripts/create-project.sh` into a package-mode wrapper over the
  local `create-zero` flow instead of copying framework source into apps.
- Added package metadata and a package `files` allowlist that includes the
  source exports, package-mode starter, docs, README, agent guide, and
  changelog.
- Added `bun run test:package`, including a tarball smoke test that packs the
  framework, verifies the package-mode starter is included, extracts the
  tarball, and runs `create-zero` from the packed package.
- Expanded the generated app README with setup, project shape, canonical import
  examples, `.env.example` guidance, and the packaged docs location.
- Expanded `llms.txt` into a full agent-facing framework documentation bundle
  with setup, package mode, backend/frontend usage, built-in systems, UI rules,
  verification, and a complete docs catalog with descriptions for every docs
  Markdown file.
- Added Doctor source usage audit checks for app-owned frontend/backend code,
  including raw controls, custom modal/toast usage, direct backend provider
  bypasses, internal imports, backend `console` calls, and large-file
  responsibility warnings.
- Added `zero-doctor` local wrapper support for running the framework checkout's
  doctor from generated apps before the package is published.
- Reworked the package-mode starter into a blank app-owned project shape with
  server-rendered default layout/page files, empty schema/config defaults,
  app-owned `components/`, `hooks/`, `lib/`, and `server/resources/` folders,
  and no TypeScript fallback aliases into `@zero/framework/src`.
- Added `bun run install:local-tools` to install repeatable local `zero-new`
  and `zero-doctor` wrappers in `~/.bin`; `zero-new` can create a target
  folder or initialize the current directory while keeping Zero in
  `node_modules/@zero/framework`.

### Auth And Account Security

- Expanded the built-in auth lifecycle with configurable public/private
  registration, first-user admin bootstrap, email verification, password reset,
  setup-password, and branded account email flows.
- Added optional or enforced MFA support with email OTP and self-hosted TOTP
  authenticator methods, including enrollment, challenge, method storage,
  challenge persistence, and recovery-safe token handling.
- Split the auth implementation into smaller responsibility-focused plugins and
  services for sessions, runtime wiring, MFA, user properties, schemas, response
  mapping, and account email templates.
- Improved default auth screens with the platform layout, smoother transitions,
  subtle token-driven input focus states, animated icon behavior, email
  verification screens, MFA enrollment/challenge screens, and reset/setup
  password flows.
- Updated admin user management to support richer account lifecycle actions,
  user-property editing, admin promotion controls, and the newer auth contracts.

### LaunchBoard Reference App

- Reworked LaunchBoard into a package-mode reference app using root
  `zero.config.ts`, a thin `app/server.ts`, framework imports through
  `@zero/framework/*`, app-owned route files, and explicit resource
  registration.
- Added public registration defaults for LaunchBoard with first-user admin
  bootstrap, optional MFA, and email verification disabled by default for local
  demo use.
- Made LaunchBoard categories, boards, columns, and cards owner-scoped through
  resource policies, row-filtered sync, `owner_id` fields, and owner-aware
  mutation helpers.
- Removed seeded demo assumptions so new users start from clean empty states in
  the category switcher, sidebar, and board workspace.
- Added LaunchBoard table compatibility and owner-index helpers, then registered
  those indexed fields with Doctor so owner-filtered app data avoids noisy
  index warnings.
- Split LaunchBoard data code into focused type, utility, collection, and
  mutation modules so the reference app stays easier for agents to read and
  extend.

### Doctor And Runtime Guidance

- Added Doctor source usage audit checks for app-owned frontend/backend code,
  including raw controls, custom modal/toast usage, direct backend provider
  bypasses, internal imports, backend `console` calls, and large-file
  responsibility warnings.
- Added `doctor.indexedFields` app config so apps can document known indexes for
  policy-filtered fields without hard-coding every app table into the platform.
- Made Doctor resource-aware for sync policy checks so tables covered by
  registered resource policies are not reported as unprotected app sync tables.
- Improved Doctor output so info-only runs finish as completed reports rather
  than warning reports.
- Added tests for package exports, distribution packaging, scaffold behavior,
  Doctor usage audit checks, resource-aware sync policy reporting, and app
  config typing.

### Admin And Storage UI

- Improved storage management with richer drive detail surfaces, settings,
  permissions, auth-aware configuration helpers, bucket visibility, and clearer
  admin inspection paths.
- Expanded reusable admin data-management surfaces around master-detail state,
  data browsing, row detail views, and table-style platform UI composition.
- Improved AppShell sidebar behavior for empty workspace/category lists so
  users can still reach create actions without seed data.

### Docs

- Added and updated docs for package-mode apps, framework developer surfaces,
  LaunchBoard, auth architecture, MFA/email verification planning, Doctor usage
  audit rules, storage/admin surfaces, SDK imports, component inventory,
  platform configuration, release flow, and start-here guidance.
- Expanded `llms.txt` into the canonical agent-facing guide and docs catalog so
  agents can discover Zero APIs before creating duplicate app infrastructure.

## 1.2.1 - 2026-07-02

Patch release for the public frontend component lane and Zero website/demo
composition.

### Frontend Components

- Added reusable `CtaSection` and `FooterSection` public components with
  package exports, `@zero/framework/react` barrel exports, and `zero add`
  registry support.
- Improved `FeaturesSection` icon bullets so Zero animated icons trigger from
  feature-row hover instead of rendering as static decoration.
- Expanded `Faq` composition support with custom header/list class hooks and
  title-less layouts for pages that provide their own section heading.

### Public Demo And Docs

- Expanded the public component docs and examples around landing-page
  composition using Zero public sections, text effects, code blocks, FAQ, CTA,
  footer, and the public design-token lane.
- Polished the reusable footer layout with labeled navigation, CTA copy,
  resource/social links, responsive overflow-safe footer actions, and stronger
  full-width visual hierarchy.
- Updated public component docs, component inventory, framework surface docs,
  SDK reference, start-here guidance, package exports tests, and `zero add`
  copy coverage for the new frontend components.

## 1.2.0 - 2026-07-01

Sitemap release for package-mode apps and public route discovery.

### Framework Runtime

- Added opt-in `sitemap` app config for serving request-time XML sitemaps from
  public static file-router pages.
- Added automatic route discovery that omits API routes, dynamic routes,
  catch-all routes, protected page/layout branches, and route-group folder
  names from sitemap output.
- Added manual sitemap entries, default `changefreq`/`priority`, public URL
  normalization, path excludes, and fail-closed behavior when route config
  cannot be imported safely.

### Tooling And Docs

- Updated `create-zero`, the package-mode fixture, and the legacy
  `create-project` script so generated apps show the sitemap setup.
- Added sitemap coverage to router, start-here, platform configuration,
  framework, system map, package-mode, and frontend docs.
- Added tests for sitemap config normalization, XML generation, auth/public
  route filtering, generated-app smoke behavior, and router mounting before the
  catch-all route.

## 1.1.0 - 2026-07-01

Framework-mode release that turns Zero into a package-first app platform while
preserving the in-repo LaunchBoard reference app as a durable example.

### Framework Runtime

- Added package-mode app composition through public `@zero/framework/*` exports, config-driven app startup, app-owned server routes, middleware, plugins, and service access.
- Added file-router route groups, route-owned layout branches, explicit route auth metadata, and client-side protected-route blanking/redirect behavior when auth is lost.
- Added a provider-only root layout plus route-group AppShell pattern so public flows, dashboards, and root-mounted app shells can coexist cleanly.
- Wired shared hot SQLite persistence into the platform runtime with memory-backed operation, snapshot recovery, file mode, and ephemeral mode options.
- Added durable platform KV/cache runtime with checkpoint/journal recovery, counters, namespaces, TTL, LRU eviction, and rate-limiter helpers.
- Reopened existing zvec collections cleanly so vector storage can recover and reuse persisted collections across restarts.

### Frontend And Reference App

- Preserved LaunchBoard as a tracked reference app under `app/`, using AppShell, ReactiveDB, platform modals, Radix-backed forms/selects, KanbanBoard, theme switching, and hot persistence.
- Added the route-group LaunchBoard structure at `/`: `app/(launchboard)/layout.tsx` owns shell chrome while `app/launchboard/launchboard-page.tsx` owns board content.
- Improved AppShell with the Animate UI/Radix sidebar pattern, workspace switcher, nested nav, breadcrumb/header row, theme toggler support, action menus, and animated icon handling.
- Improved form helpers, Radix-backed field rendering, Sonner styling, component inventory docs, forms docs, and frontend SDK docs.

### Tooling And Docs

- Expanded platform doctor coverage for route auth, package-mode config, resource policies, and newer runtime guidance.
- Updated start-here, framework, AppShell, router, LaunchBoard, SDK, auth, token, platform configuration, roadmap, and package-mode example docs.
- Added durable docs for webhooks and component inventory so app-building agents can discover existing Zero surfaces before creating duplicates.

## 1.0.0 - 2026-06-28

Initial versioned platform release.

### Platform

- Hardened the Elysia/Bun backend foundation with stricter sync policy, safer `/api/data` querying, result limits, pagination, sorting, filtering, and platform doctor guidance.
- Added first-class migration tooling with status, planning, rollback safety classification, schema history, drift checks, and doctor integration.
- Added centralized observability contracts, stable event codes, default sinks, frontend reporting, and a protected platform event endpoint.
- Added auth account lifecycle support for controlled registration, admin-created users, password reset/setup flows, email delivery through the platform email service, and admin user management capabilities.
- Added natural identity support for relationship-style tables so apps can keep one ReactiveDB sync primary key while enforcing composite uniqueness semantics.
- Added AI service integration for Vercel AI SDK providers, model aliases, provider readiness, conversation helpers, workflow bridges, tool registration, and documentation for required provider environment variables.
- Added zvec-backed vector storage with collection management, query helpers, AI bridge utilities, doctor checks, and documentation.

### Frontend

- Added and documented reusable admin user management, storage management, data table, details view, auth, storage, sync, workflow, AI, vector, upload, and platform-specific hooks.
- Added a generic hook library for common React behavior such as idle detection, clipboard, click-away, OS detection, text selection, debounce, and throttle helpers.
- Added Animate UI animated Lucide icons as the default platform icon pack through `@platform/frontend/icons`.
- Improved auth persistence and session refresh behavior so expired or invalid sessions redirect through the configured login route.

### Tooling And Docs

- Added `docs/start-here.md`, platform feature docs, frontend hook/icon docs, AI/vector docs, and updated environment examples.
- Added `bun run version:bump -- <semver>` for explicit package version metadata updates.
