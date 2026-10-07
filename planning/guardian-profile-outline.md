# Guardian profile and settings implementation outline

[Working plans](./index.md) · [Profile architecture](./guardian-profile-settings.md) ·
[Presence architecture](./guardian-presence.md)

## Scope and status

This is the checklist for the current profile/settings run, including the
phone input, avatar/profile expansion, reusable settings blocks, presence,
post-bootstrap feature provisioning and the final REUI Kbd step. Checked
items are implemented in the current branch, not a claim of publication.
Unchecked items are remaining qualification/follow-up gates, not a claim that
the implemented source is unavailable. Explicitly deferred domain features
are listed separately; they are not blockers for these reusable UI organisms.

The baseline is `55ca1e6` on `feature/adaptive-profile-settings`, October 6,
2026. Database-editable organization roles and individual permission grants
remain discussion items; they are not added to this implementation by asking
about them.

The implemented 2.6.0 checkpoint is
`bfc763919aeffa43d84556d6076ea18097b2cff1`, October 7, 2026. The earlier
942-file candidate passed, but two exact clean runs failed and a third exited
with incomplete runner output; focused closing corrections and the final
test-acknowledgment/output-lifecycle review are recorded in the
[qualification ledger](../docs-next/_work/audits/guardian-profile-qualification.md).
The current inventory is 945 files, including the private failure-receipt
regressions and the same ten separately recorded Chrome preview cases. Remaining
checkboxes include this checkpoint's exact clean-checkout/package qualification
and actual publication; this is not yet an instruction to update a live app.

## Design references and shared rules

The supplied Pantheon screenshot shows the failure to correct: an oversized
password form, a disabled-MFA card, no core profile editing, and generic
disconnected cards. The notification reference shows a compact single
section with setting names/descriptions, aligned channel choices, thin row
separators, a count and a footer. The integration reference shows grouped
lists with service identity, descriptions, compact status and contextual
actions. Match those relationships, not their literal non-Zero colors.

- [x] Compose existing Zero controls, services, SDKs, hooks, tokens and error
  presentation before adding any new primitive or engine.
- [x] Keep new settings organisms small and separate from domain persistence.
- [x] Use current Zero tokens throughout, including density, borders, icons,
  focus, motion and semantic status. No global theme redesign in this run.
- [x] Use restrained consistent microinteractions, reduced-motion behavior,
  real keyboard access and deliberate narrow-screen layouts.
- [x] Make hidden, read-only, required, pending, unavailable and error states
  explicit; a client prop must never widen server authority.
- [x] Keep Bun-first APIs, thin Elysia transport, services/stores separation,
  standard errors/logging and focused tests.

## Already implemented foundations

- [x] PhoneInput with searchable country selection and country flags.
- [x] United States default country, configurable through a prop.
- [x] E.164 value and supported possible/valid numbering-plan validation.
- [x] `field.phone` and generated-form/field-renderer integration.
- [x] Read-only phone number and country behavior, distinct from disabled.
- [x] Native read-only base Input presentation and form submission semantics.
- [x] MFA panel hidden when definitively disabled.
- [x] MFA configuration/readiness/loading/error handling without guessed methods.
- [x] Focused public-package, SSR, form and browser qualification for that work.
- [x] Documentation updates for those implemented contracts.

The foundations above do not themselves include phone ownership verification,
extended profile storage, avatar support or presence. Those are tracked in the
implemented sections below. The branch is not yet a release.

## Session recovery included in this run

- [x] Fix reproduced source-level "Session refresh required" recovery traps,
  including bounded ordinary refresh and replacement-family reconciliation.
- [x] Repair mismatched browser/page sessions through current credential
  restoration and cookie synchronization, not repeated blind document reloads.
- [x] Definitively rejected credentials reach a clean signed-out/login state.
- [x] Network, 5xx and malformed-response failures remain retryable without
  deleting a recoverable credential or mistaking user-null for signed-out.
- [x] Bound automatic recovery; provide useful Retry and explicit Sign out.
- [x] Preserve loader identity/role/organization/revision fences throughout.
- [x] Discard late recovery after account/organization replacement or disposal.
- [x] Real synthetic browser regressions and updated current/new documentation.

The [qualification ledger](../docs-next/_work/audits/guardian-profile-qualification.md)
records the source/browser gates and remaining archive/release boundary.
Same-origin disk-backed restart tests preserve valid proof or reach login after
definitive invalidation. They do not identify the deployed Pantheon build or
prove the production incident's cause or resolution.

## Adaptive user profile

- [x] Public reusable profile/settings composition with full, compact and
  read-only modes plus independently reusable sections.
- [x] Identity summary, editable first/last name, and consistent display name.
- [x] Honor username-enabled and email-as-username configurations.
- [x] Preferred name, biography, website and bounded social-profile links.
- [x] Configure supported fields individually: enabled, editable and required.
- [x] Keep expanded profiles separate from generic additional properties.
- [x] Show app/system/organization role information with clear scope labels;
  read-only normally, with separate authority-checked management actions.
- [x] Use the existing password-change and MFA actions in a more compact
  account-security composition, not duplicate authentication logic.
- [x] Hide genuinely disabled sections and show truthful provider/readiness states.
- [x] Expose minimal authorized directory information without leaking global
  private profile/contact state across organizations.

The directory is the minimal Guardian avatar/display-name endpoint, not a
global profile search API. Web reads require live shared active organization
membership in multi-tenant mode; native profile reads remain self-only.

## Avatars

- [x] Configurable avatar shape and size using existing Avatar primitives.
- [x] Default name initials; fallback to first two username/email letters.
- [x] Configurable fallback presentation without forced image upload.
- [x] Edit action with browse/upload/remove and compact avatar drop target.
- [x] Local image selection and crop before upload; cancel preserves the old image.
- [x] Existing crop engine wrapped in Zero Dialog/controls; no bespoke cropper.
- [x] Tokenized crop UI with correct sizing, keyboard and reduced-motion behavior.
- [x] Identity-bound staging/finalization through existing storage transport.
- [x] Actual raster decoding, dimensions/pixel/byte bounds and normalized output.
- [x] Opaque immutable asset reference, deliberate delivery/privacy/cache policy.
- [x] Single-use staging receipts and revision/live-authority checks after I/O.
- [x] Safe abandoned/superseded cleanup; no premature deletion of current avatar.
- [x] Cancellation, stale scope, invalid image and duplicate-finalization source tests.

Actual organization/native boundary tests cover directory and private delivery.
Provider operations follow the existing Storage drain contract: custom adapters
must settle admitted calls before SYSTEM disposal; forced abandonment is not
promised. Final installed-archive qualification remains a release gate below.

### Avatar stack

- [x] Integrate the exact REUI `c-avatar-29` avatar group with icon count and
  optional add button, using Zero's existing avatar/group primitives.
- [x] Add button is configurable, with an accessible app-supplied action;
  showing it does not grant invitation/member-management authority.
- [x] Preserve configured avatar shape/size and individual presence indicators.
- [x] Render presence rings/status only when app presence is enabled and the
  caller supplies an admitted observation; disabled presence is a plain avatar
  stack with no implied offline state or presence subscription.
- [x] Square avatars use a matching rounded-square presence outline, not a
  circular ring imposed over the app's square configuration.
- [x] Stack overlap/z-index must not clip presence rings, count or keyboard
  focus; include tooltip/full member labels and narrow-width behavior.
- [x] Tokenize the reference styling and document standalone presentation usage.
- [x] Wire and document the connected Guardian profile/presence adapter.

The [current avatar-group guide](../docs-next/frontend/components/avatar-group.md)
documents the presentation component. `useAvatarPresence` observes the shared
SDK owner, and the profile avatar editor uses it. Arbitrary visual metadata does
not prove a live status; unconfirmed, expired or disconnected observations omit
the connected ring.

## Verified contacts

- [x] Verified email and phone badges reflect actual server-held proof.
- [x] Distinguish required-auth verification, possession proof and admin attestation.
- [x] Optional email verification even when signup verification is not required.
- [x] Candidate-email change leaves old login address active until proof succeeds.
- [x] Phone contact with optional configured delivery/verifier adapter.
- [x] Explicit unavailable state if delivery is disabled, absent or not ready.
- [x] Proofs bound to contact, identity, generation, purpose, expiry and consumption.
- [x] Rate/attempt limits, hashed secrets where appropriate and secret-free logging.
- [x] Format validation never presented as ownership verification or SMS MFA.

## Regional preferences

- [x] Language/locale selection.
- [x] Timezone selection and explicit app/system default.
- [x] 12-hour/24-hour display preference.
- [x] Start-of-week preference.
- [x] Typed global-user persistence, not active-organization UI state.
- [x] Clear effective values without silently saving inferred browser/server settings.

## Required first-use completion

- [x] App-configurable required profile fields at signup and invited first sign-in.
- [x] Deliberate enforcement rollout for existing accounts, off by default.
- [x] Backend completion continuation before ordinary app access.
- [x] Preserve email/MFA assurance and tenant/native/invitation continuation.
- [x] Short-lived narrowly scoped completion credential with generation checks.
- [x] Final requirements revalidation and atomic continuation consumption.
- [x] No bypass through invitation, password setup, native login, refresh or tenant choice.
- [x] Accessible reusable completion UI with only the configured required fields.

The completion form narrows rendering/validation locally to enabled required
profile fields. Original server policy stays authoritative, and optional values
are omitted from submission rather than cleared. Proof stays in memory, not
in URL parameters or local storage.

## Save interactions and shared form behavior

- [x] Optional small Save/check and Cancel/X controls beside dirty editable fields.
- [x] Geometry-preserving inline presentation using existing editing primitives.
- [x] Typed controls including PhoneInput, Select and Zero temporal controls.
- [x] Optional floating bottom-center Save/Discard bar for dirty page forms.
- [x] Accepted server result becomes the new baseline; newer pending edits survive.
- [x] Field saves do not erase other unsaved settings or race shared revisions.
- [x] Save/Discard/Stay decision for in-app navigation and modal close.
- [x] Browser-native `beforeunload` protection for tab close/reload, not a promised
  custom async dialog at that browser-controlled boundary.
- [x] Security logout/scope retirement cannot be blocked by an unsaved-draft guard.
- [x] Pending locks, duplicate-click prevention, preserved conflict drafts and retries.
- [x] Public composition pattern and additive form/router compatibility tests.

## Settings matrix

- [x] Reusable row name/description and one to three choice columns.
- [x] Column icons/labels, aligned choices, thin separators and compact spacing.
- [x] Enabled/editable counts and a clearly attached optional help footer.
- [x] Existing Checkbox/Switch/Table and consistent per-cell state feedback.
- [x] Per-cell read-only/permission locks with explanatory reasons.
- [x] Responsive labeled choices without offscreen/clipped checkbox columns.

Notification-specific preference persistence and delivery adapters are deferred
domain work, not part of this controlled matrix contract. Apps own their data,
capabilities and callbacks; the organism does not invent notification endpoints.

## Integration settings list

- [x] Single section or multiple labeled groups, matching the supplied list reference.
- [x] Leading icon/logo, title, description and compact labeled status.
- [x] Existing DropdownMenu/ContextMenu actions with icons and destructive styling.
- [x] App-defined async Review/Reconnect/Remove callbacks with live scope fences;
  the owning adapter still authorizes actual server operations.
- [x] Confirmation, pending states and secret-free errors; actual data refresh
  remains the controlled callback/adapter's responsibility.
- [x] No duplicate OAuth/connection backend implied by a presentation component.

The standalone [matrix](../docs-next/frontend/components/settings-matrix.md)
and [integration list](../docs-next/frontend/components/integration-settings-list.md)
are source-qualified controlled UI foundations. App-owned user/org/platform
adapters must authorize their own operations; adding OAuth/connection endpoints
is explicitly deferred and is not required to complete these organisms.

## Guardian presence

- [x] Available/online, idle, away, busy and offline semantics.
- [x] Optional on-call/custom statuses with configured labels, semantic tones and icons.
- [x] Manual status/expiry separate from connectivity and automatic activity.
- [x] Real inactivity detection and multi-tab/device aggregation.
- [x] One provider/SDK-owned tracker, no heartbeat per rendered avatar.
- [x] Close/TTL/reconnect lifecycle, no stale buffered heartbeat replay.
- [x] Guardian live authority, application/active-organization scope and revocation isolation.
- [x] Lightweight transient leases; meaningful Reactive DB publication only.
- [x] Read-only canonical feed and actual admitted Fabric read projection/service.
- [x] Explicit freshness/owner epoch so durable cached online rows cannot lie forever.
- [x] Named single-owner topology; unsupported multiple aggregate writers fail closed.
- [x] Tokenized avatar ring/dot/badge, accessible status label and configurable size/shape.
- [x] Actor lifecycle, shutdown, retry/recovery and readonly source qualification.
- [x] Actual managed HTTP/WebSocket behavior and shutdown qualification.
- [ ] Final installed-package qualification.

Detailed data flow, optimization and acceptance are in the
[presence architecture](./guardian-presence.md). Presence is advisory state,
not proof that a human is watching or a replacement for authorization. The
Guardian feed is application/active-organization scoped; generic room presence
is a separate existing Sync surface, not a new Guardian room directory.

Current reproducible server gates are the managed HTTP/WebSocket suite
(`bun --no-env-file test src/presence/presence-http-sync.integration.test.ts`:
4 passed /63 assertions, normal exit), real Fabric actor suite (4 /30), and
focused pure presence gate (15 /124). Counts are separate overlapping evidence,
not an additive whole-platform test total. The managed run is recorded in
`guardian-presence-managed-http-final.log` under the external diagnostics root.

## Post-bootstrap feature provisioning

- [x] Detect desired features versus installed schema/resource state.
- [x] Disabled-to-enabled startup path qualified against populated synthetic schemas.
- [x] Ensure typed profile tables/columns/indexes and managed avatar media storage.
- [x] Keep fields nullable/versioned; disabling does not drop columns or delete data.
- [x] Correct targeting for SYSTEM, pinned application DB and Fabric organization realms.
- [x] New organizations receive current admitted contributions before feature use.
- [x] Existing unopened tenants receive migration receipts and before-use barriers.
- [x] Eager startup enumeration plus durable ordered presence publication retry.
- [x] Idempotent schema/resource receipts, conflict/concurrency protection and retry.
- [x] Readiness capabilities drive the UI; configuration alone never means ready.
- [x] Provider bucket creation only through supported provision-capable adapters;
  existing resources are not overwritten or destroyed.
- [x] Startup/config-deployment path first; runtime toggles require an explicit
  supported reconciliation operation, not client-driven DDL/hot plugin mutation.
- [x] Doctor desired/installed diagnostics and upgrade guide for supported modes.
- [x] Existing-user completion rollout and disable/re-enable/data-preservation tests.

There is no generic durable discovery-cursor job or browser-driven feature
installer. Presence enumerates current eligible scopes at startup, persists
publication work and uses actual per-target admission before use. No live
Pantheon migration or provider provisioning was performed for qualification.

## Kbd as the final component step

- [x] Add public `Kbd`/`KbdGroup` from the primitive used by
  [REUI's six examples](https://reui.io/components/kbd).
- [x] Preserve the reference's compact default key/group/icon treatment using
  explicit tokens and Zero's existing theme/font/cn infrastructure.
- [x] Keep public shortcut wrappers/string props and trailing metadata slots compatible.
- [x] Reuse for record action-bar and documentation search hints where appropriate.
- [x] Adapt tooltip context to Zero's actual rendered surface, not an unmatched
  upstream `data-slot` selector.
- [x] Semantic accessible key markup, SSR-safe platform labels and documentation.
- [x] Keep hints separate from actual hotkey registration; do not imply a displayed
  shortcut is functional unless the consuming action wires it.

## Implementation order

1. Agree and validate config, data ownership, proof/revision and capability contracts.
2. Correct session recovery and implement feature provisioning/migration readiness
   for existing/new installations.
3. Implement profile/regional self-service and the minimal directory projection.
4. Add staged avatars, optional contact proof and required completion.
5. Extend existing form/router save seams and build compact settings organisms.
6. Compose the adaptive profile and implement the scoped presence architecture.
7. Complete shared Kbd, documentation, upgrade qualification and release checks.
8. Finally, address the page-size position-preservation fix below.

Each stage gets focused unit/API/package/browser tests appropriate to its risk.
Code must be reviewed against this outline and the detailed architecture before
its checkbox is marked complete. No production DB, provider or app changes
are needed for development qualification.

## Documentation and release gates

- [x] Current guides and new `docs-next` guides match implemented public contracts.
- [x] Feature/configuration/upgrade pages include modes, readiness and examples.
- [x] Frontend indexes/catalogs include every new public component and hook.
- [x] Guardian, Fabric, Reactive DB, storage, rooms and forms guides cross-link.
- [x] Start-here guidance routes people/agents into the correct documentation.
- [ ] Public exports, SSR and a fresh package-mode consumer pass.
- [x] Real synthetic browser checks cover the supplied layout relationships in
  light/dark themes, narrow widths, keyboard/touch and reduced motion.
- [x] Upgrade tests use populated previous schemas and interrupted/retried migrations.
- [ ] Only intended qualified branch changes are merged/pushed; no unrelated
  worktree changes or premature release claims.

## Questions kept outside this implementation

Optional config-seeded organization-editable role definitions and direct
membership permission grants are feasible future Guardian features. Today
config remains authoritative; its SQL manifest is a consistency snapshot,
and advanced assignments are role keys. A narrow add-on role is the current
supported way to grant one extra capability. These authorization ideas require
their own bounded catalog/resolver/invalidation design before implementation.

## Final follow-up: preserve position when page size changes

Added at the user's request after the profile/presence work, October 6, 2026.
Do not start this before the preceding run is finished.

- [x] Changing the table's results-per-page setting should preserve the current
  result position, rather than unconditionally return to page one.
- [x] For array, complete reactive collection and offset/page sources, retain the
  first visible row's logical offset and choose the new page containing it.
- [x] For cursor sources, preserve the query position only where the source
  contract can do so honestly; document any unavoidable refresh boundary.
- [x] Keep search/filter/sort resets distinct from page-size changes, handle
  shrinking results safely, and add focused source-mode regression tests/docs.

## Next discussion after this run

The user wants a major review of the modal manager's default UI, its composition
and usage ergonomics only after the complete profile/presence/Guardian run and
the small follow-ups are genuinely qualified. Do not begin that redesign while
this release is still incomplete. Existing narrowly scoped save/close safety
fixes are part of this run, not authorization for the later visual redesign.

### Later discussion: reactive table motion

The user also wants optional polished table animations for Reactive DB changes,
after this run and its small follow-ups. Reuse the existing motion primitives:
stable-ID row entry/exit/reordering and restrained changed-cell emphasis. Design
it with virtualization, bounded batches, rapid-update coalescing, scroll anchors,
selection and active-edit preservation, and reduced-motion behavior. Animation
must not weaken organization/result-query fences or pull cached records from
another query into the visible result. This is a deferred design request, not
implemented behavior or another release blocker for the current upgrade.

### Closing review and the next visual design

The user reaffirmed a complete closing review of this upgrade: every new
component/system and the reported repairs must follow Zero's service/SDK/Elysia
boundaries, reuse existing primitives, use the design tokens, and route errors
and diagnostics through the established observability boundary. Review real
permission/read-only states, pending/cancelled work, lifecycle cleanup,
responsive layout and reduced motion, not only happy-path test counts. Fix
concrete defects and polish gaps with focused regressions before frozen-source
and clean-checkout release qualification.

The user has also had a new table visual design prepared and wants that taken
up after this upgrade/review. Preserve it as the subsequent design input; do
not invent its contents, start the table redesign during this run, or imply
that the deferred row-animation request has been implemented. Prefer changes
in the packaged Zero components so consuming apps inherit the design.
