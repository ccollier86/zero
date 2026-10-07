# Guardian profile and settings implementation outline

[Working plans](./index.md) · [Profile architecture](./guardian-profile-settings.md) ·
[Presence architecture](./guardian-presence.md)

## Scope and status

This is the checklist for the current profile/settings run, including the
phone input, avatar/profile expansion, reusable settings blocks, presence,
post-bootstrap feature provisioning and the final REUI Kbd step. Checked
items are implemented in the current branch, not a claim of publication.
Unchecked items are requested work or qualification gates, not existing API.

The baseline is `55ca1e6` on `feature/adaptive-profile-settings`, October 6,
2026. Database-editable organization roles and individual permission grants
remain discussion items; they are not added to this implementation by asking
about them.

## Design references and shared rules

The supplied Pantheon screenshot shows the failure to correct: an oversized
password form, a disabled-MFA card, no core profile editing, and generic
disconnected cards. The notification reference shows a compact single
section with setting names/descriptions, aligned channel choices, thin row
separators, a count and a footer. The integration reference shows grouped
lists with service identity, descriptions, compact status and contextual
actions. Match those relationships, not their literal non-Zero colors.

- [ ] Compose existing Zero controls, services, SDKs, hooks, tokens and error
  presentation before adding any new primitive or engine.
- [ ] Keep new settings organisms small and separate from domain persistence.
- [ ] Use current Zero tokens throughout, including density, borders, icons,
  focus, motion and semantic status. No global theme redesign in this run.
- [ ] Use restrained consistent microinteractions, reduced-motion behavior,
  real keyboard access and deliberate narrow-screen layouts.
- [ ] Make hidden, read-only, required, pending, unavailable and error states
  explicit; a client prop must never widen server authority.
- [ ] Keep Bun-first APIs, thin Elysia transport, services/stores separation,
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

These do not include phone ownership verification, extended profile storage,
avatar support or presence. The committed branch is not yet a release.

## Session recovery included in this run

- [x] Close the reported post-rebuild "Session refresh required" recovery trap.
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

## Adaptive user profile

- [ ] Public reusable profile/settings composition with full, compact and
  read-only modes plus independently reusable sections.
- [ ] Identity summary, editable first/last name, and consistent display name.
- [ ] Honor username-enabled and email-as-username configurations.
- [ ] Preferred name, biography, website and bounded social-profile links.
- [ ] Configure supported fields individually: enabled, editable and required.
- [ ] Keep expanded profiles separate from generic additional properties.
- [ ] Show app/system/organization role information with clear scope labels;
  read-only normally, with separate authority-checked management actions.
- [ ] Use the existing password-change and MFA actions in a more compact
  account-security composition, not duplicate authentication logic.
- [ ] Hide genuinely disabled sections and show truthful provider/readiness states.
- [ ] Expose minimal authorized directory information without leaking global
  private profile/contact state across organizations.

## Avatars

- [ ] Configurable avatar shape and size using existing Avatar primitives.
- [ ] Default name initials; fallback to first two username/email letters.
- [ ] Configurable fallback presentation without forced image upload.
- [ ] Edit action with browse/upload/remove and compact avatar drop target.
- [ ] Local image selection and crop before upload; cancel preserves the old image.
- [ ] Existing crop engine wrapped in Zero Dialog/controls; no bespoke cropper.
- [ ] Tokenized crop UI with correct sizing, keyboard and reduced-motion behavior.
- [ ] Identity-bound staging/finalization through existing storage transport.
- [ ] Actual raster decoding, dimensions/pixel/byte bounds and normalized output.
- [ ] Opaque immutable asset reference, deliberate delivery/privacy/cache policy.
- [ ] Single-use staging receipts and revision/live-authority checks after I/O.
- [ ] Safe abandoned/superseded cleanup; no premature deletion of current avatar.
- [ ] Cancellation, stale scope, invalid image, duplicate finalization and package tests.

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
- [ ] Wire and document the connected Guardian profile/presence adapter.

The [current avatar-group guide](../docs-next/frontend/components/avatar-group.md)
documents the presentation component. A connected Guardian profile/presence
adapter remains part of the later service stage; the visual metadata does not
prove a live status by itself.

## Verified contacts

- [ ] Verified email and phone badges reflect actual server-held proof.
- [ ] Distinguish required-auth verification, possession proof and admin attestation.
- [ ] Optional email verification even when signup verification is not required.
- [ ] Candidate-email change leaves old login address active until proof succeeds.
- [ ] Phone contact with optional configured delivery/verifier adapter.
- [ ] Explicit unavailable state if delivery is disabled, absent or not ready.
- [ ] Proofs bound to contact, identity, generation, purpose, expiry and consumption.
- [ ] Rate/attempt limits, hashed secrets where appropriate and secret-free logging.
- [ ] Format validation never presented as ownership verification or SMS MFA.

## Regional preferences

- [ ] Language/locale selection.
- [ ] Timezone selection and explicit app/system default.
- [ ] 12-hour/24-hour display preference.
- [ ] Start-of-week preference.
- [ ] Typed global-user persistence, not active-organization UI state.
- [ ] Clear effective values without silently saving inferred browser/server settings.

## Required first-use completion

- [ ] App-configurable required profile fields at signup and invited first sign-in.
- [ ] Deliberate enforcement rollout for existing accounts, off by default.
- [ ] Backend completion continuation before ordinary app access.
- [ ] Preserve email/MFA assurance and tenant/native/invitation continuation.
- [ ] Short-lived narrowly scoped completion credential with generation checks.
- [ ] Final requirements revalidation and atomic continuation consumption.
- [ ] No bypass through invitation, password setup, native login, refresh or tenant choice.
- [ ] Accessible reusable completion UI with only the configured required fields.

## Save interactions and shared form behavior

- [ ] Optional small Save/check and Cancel/X controls beside dirty editable fields.
- [ ] Geometry-preserving inline presentation using existing editing primitives.
- [ ] Typed controls including PhoneInput, Select and Zero temporal controls.
- [ ] Optional floating bottom-center Save/Discard bar for dirty page forms.
- [ ] Accepted server result becomes the new baseline; newer pending edits survive.
- [ ] Field saves do not erase other unsaved settings or race shared revisions.
- [ ] Save/Discard/Stay decision for in-app navigation and modal close.
- [ ] Browser-native `beforeunload` protection for tab close/reload, not a promised
  custom async dialog at that browser-controlled boundary.
- [ ] Security logout/scope retirement cannot be blocked by an unsaved-draft guard.
- [ ] Pending locks, duplicate-click prevention, preserved conflict drafts and retries.
- [ ] Public composition pattern and additive form/router compatibility tests.

## Settings matrix

- [x] Reusable row name/description and one to three choice columns.
- [x] Column icons/labels, aligned choices, thin separators and compact spacing.
- [x] Enabled/editable counts and a clearly attached optional help footer.
- [x] Existing Checkbox/Switch/Table and consistent per-cell state feedback.
- [x] Per-cell read-only/permission locks with explanatory reasons.
- [x] Responsive labeled choices without offscreen/clipped checkbox columns.
- [ ] Notification preference adapter distinct from notification receipts/inbox.
- [ ] Actual persistence/delivery constraints when used for notifications.

## Integration settings list

- [x] Single section or multiple labeled groups, matching the supplied list reference.
- [x] Leading icon/logo, title, description and compact labeled status.
- [x] Existing DropdownMenu/ContextMenu actions with icons and destructive styling.
- [x] App-defined async Review/Reconnect/Remove callbacks with live scope fences;
  the owning adapter still authorizes actual server operations.
- [ ] User/org/platform scope adapters without trusting a browser scope selector.
- [x] Confirmation, pending states and secret-free errors; actual data refresh
  remains the controlled callback/adapter's responsibility.
- [x] No duplicate OAuth/connection backend implied by a presentation component.

The standalone [matrix](../docs-next/frontend/components/settings-matrix.md)
and [integration list](../docs-next/frontend/components/integration-settings-list.md)
are source-qualified UI foundations. Their domain persistence/delivery adapters
and the full Guardian profile composition remain separate unchecked stages.

## Guardian presence

- [ ] Available/online, idle, away, busy and offline semantics.
- [ ] Optional on-call/custom statuses with configured labels, token colors and icons.
- [ ] Manual status/expiry separate from connectivity and automatic activity.
- [ ] Real inactivity detection and multi-tab/device aggregation.
- [ ] One provider/SDK-owned tracker, no heartbeat per rendered avatar.
- [ ] Close/TTL/reconnect lifecycle, no stale buffered heartbeat replay.
- [ ] Guardian live authority, organization/room scope and revocation isolation.
- [ ] Lightweight transient leases; meaningful Reactive DB publication only.
- [ ] Read-only canonical feed and actual admitted Fabric read projection/service.
- [ ] Explicit freshness/owner epoch so durable cached online rows cannot lie forever.
- [ ] Named supported topology; multi-gateway guarantees require real ownership/fan-in.
- [ ] Tokenized avatar ring/dot/badge, accessible status label and configurable size/shape.
- [ ] Actor lifecycle, shutdown, retry/recovery and readonly/package qualification.

Detailed data flow, optimization and acceptance are in the
[presence architecture](./guardian-presence.md). Presence is advisory state,
not proof that a human is watching or a replacement for authorization.

## Post-bootstrap feature provisioning

- [ ] Detect desired features versus installed schema/resource state.
- [ ] Safe disabled-to-enabled path for an already populated app such as Pantheon.
- [ ] Ensure typed profile tables/columns/indexes and managed avatar media storage.
- [ ] Keep fields nullable/versioned; disabling does not drop columns or delete data.
- [ ] Correct targeting for SYSTEM, pinned application DB and Fabric organization realms.
- [ ] New organizations receive current admitted contributions before feature use.
- [ ] Existing unopened tenants have tracked pending versions and before-use barriers.
- [ ] Bounded/resumable eager rollout if app-wide migration is requested.
- [ ] Idempotent schema/resource receipts, conflict/concurrency protection and retry.
- [ ] Readiness capabilities drive the UI; configuration alone never means ready.
- [ ] Provider bucket creation only through supported provision-capable adapters;
  existing resources are not overwritten or destroyed.
- [ ] Startup/config-deployment path first; runtime toggles require an explicit
  supported reconciliation operation, not client-driven DDL/hot plugin mutation.
- [ ] Doctor desired/installed diagnostics and upgrade guide for each mode.
- [ ] Existing-user completion rollout and disable/re-enable/data-preservation tests.

## Kbd as the final component step

- [ ] Add public `Kbd`/`KbdGroup` from the primitive used by
  [REUI's six examples](https://reui.io/components/kbd).
- [ ] Preserve the reference's compact default key/group/icon treatment using
  explicit tokens and Zero's existing theme/font/cn infrastructure.
- [ ] Keep public shortcut wrappers/string props and trailing metadata slots compatible.
- [ ] Reuse for record action-bar and documentation search hints where appropriate.
- [ ] Adapt tooltip context to Zero's actual rendered surface, not an unmatched
  upstream `data-slot` selector.
- [ ] Semantic accessible key markup, SSR-safe platform labels and documentation.
- [ ] Keep hints separate from actual hotkey registration; do not imply a displayed
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

Each stage gets focused unit/API/package/browser tests appropriate to its risk.
Code must be reviewed against this outline and the detailed architecture before
its checkbox is marked complete. No production DB, provider or app changes
are needed for development qualification.

## Documentation and release gates

- [ ] Current guides and new `docs-next` guides match implemented public contracts.
- [ ] Feature/configuration/upgrade pages include modes, readiness and examples.
- [ ] Frontend indexes/catalogs include every new public component and hook.
- [ ] Guardian, Fabric, Reactive DB, storage, rooms and forms guides cross-link.
- [ ] Start-here guidance routes people/agents into the correct documentation.
- [ ] Public exports, SSR and a fresh package-mode consumer pass.
- [ ] Real synthetic browser checks cover the supplied layout relationships in
  light/dark themes, narrow widths, keyboard/touch and reduced motion.
- [ ] Upgrade tests use populated previous schemas and interrupted/retried migrations.
- [ ] Only intended qualified branch changes are merged/pushed; no unrelated
  worktree changes or premature release claims.

## Questions kept outside this implementation

Optional config-seeded organization-editable role definitions and direct
membership permission grants are feasible future Guardian features. Today
config remains authoritative; its SQL manifest is a consistency snapshot,
and advanced assignments are role keys. A narrow add-on role is the current
supported way to grant one extra capability. These authorization ideas require
their own bounded catalog/resolver/invalidation design before implementation.
