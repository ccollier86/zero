# Guardian profiles and adaptive settings

[Requirements outline](./guardian-profile-outline.md) · [Working plans](./index.md) ·
[Presence architecture](./guardian-presence.md) ·
[UI direction](./ui-rework.md)

## Scope and implementation status

This is the proposed implementation plan for configurable account profiles,
avatars, contact verification, regional preferences, required profile
completion, and reusable settings compositions. It is not a supported API
guide. The source baseline is `55ca1e6` on
`feature/adaptive-profile-settings`, reviewed on October 6, 2026.

The phone-input family, E.164 schema/form integration, native read-only input
behavior, and corrected MFA settings gating are implemented on that branch.
The profile, avatar, verification, settings-save, and first-class presence
features below are not implemented there yet. Database-editable roles and
direct permission grants are questions for a later authorization change, not
part of this implementation.

The intended result is a packaged profile/settings experience that adapts to
the app's declared features and live capabilities. Apps should configure what
is available, not recreate authentication, uploads, forms, or authorization.
Extended profiles are first-class typed features, separate from
`userProperties` and from the auth runtime's existing use of the word
"profile" for its tenancy and authorization mode.

## Product experience

The profile begins with an identity summary: avatar, display/preferred name,
current account identity, and an optional presence indicator. The main body
uses compact settings rows and purposeful sections rather than a wall of
large single-action cards. Profile, account security, regional preferences,
and app-provided settings can appear together or as independently mounted
sections.

Always show the applicable core identity fields. Honor existing username
behavior, including apps that use email as the username. Show roles as
scope-labeled, read-only information by default. A self-profile edit must
never become a way to assign roles, change account status, or grant authority.

Render optional features only when both configuration and the server's live
capabilities permit them. For example, disabled MFA has no empty MFA card;
configured but unavailable verification has an understandable unavailable
state rather than an inert "Verify" button. Unknown configuration, failed
loading, disabled features, and unavailable providers remain distinct.

Provide deliberate compact, read-only, and editable compositions. On narrow
screens, sections stack, labels remain visible, and controls and save actions
stay reachable. Do not change the global design system in this feature; use
its current tokens and the direction in the [UI plan](./ui-rework.md).

## Existing foundations to reuse

| Responsibility | Existing foundation | Required extension |
| --- | --- | --- |
| Identity and live authority | Guardian user stores, access resolver, authority references and final transaction fences | Own-profile service, field capabilities and revision-aware writes |
| Profile display | Public Avatar, Badge, Input, PhoneInput, Select, Switch, existing typography and layout utilities | Compact adaptive profile sections and an avatar/status composition |
| Password and MFA | Existing account actions, PasswordInput, MFA service and management panel | Compose the existing actions; preserve their readiness and error semantics |
| File transport | Storage CAS, byte limits, MIME checks, upload SDK/hooks and grants | Identity-bound staged avatar receipt and image processing |
| Local file interaction | Storage dropzone rendering and upload hooks | Selection-before-upload mode for cropping, not automatic upload on drop |
| Form state | Public `useForm`, draft/preference hooks and acknowledged collection mutations | Accepted baseline and a shared save/leave controller |
| Inline text edits | Public `InlineEditText` with geometry, validation and conflict handling | Optional explicit Save/Cancel controls and typed settings fields |
| Confirmation | Modal manager, Dialog, AlertDialog, existing Data Studio discard workflow | General Save/Discard/Stay controller and guarded close/navigation |
| Settings choices | Table, Checkbox, Switch, ButtonGroup, Tooltip, Separator | Responsive settings matrix with up to three option columns |
| Integration actions | Avatar/icon presentation, Badge, DropdownMenu and ContextMenu | Grouped integration-list organism with authorized app-supplied actions |
| Reactive updates | Existing scoped SDK subscriptions and read-only system Sync plane | Explicit profile/directory projections, not unrestricted SYSTEM collections |

The public [frontend barrel](../src/frontend/index.ts),
[upload dropzone hook](../src/storage/upload-dropzone-hooks.ts),
[inline editor](../src/components/ui/inline-edit-text.tsx),
[form hook](../src/hooks/use-form.ts), and
[router](../src/frontend/client/router-context.tsx) are the integration seams.
The existing storage dropzone uploads accepted files immediately. It cannot
be used unchanged for a crop-before-save flow. No reusable cropper was found
in the reviewed source; the internal presence-avatar example is demo data,
not a connected Guardian component.

## Declarative configuration and capability projection

Add a strictly validated profile configuration adjacent to the existing
Guardian account settings. Final names and shapes must be settled with the
public config types before implementation; the following is a vocabulary,
not usable configuration yet.

Configuration should cover:

- Core-field visibility and self-edit policy, including first/last name and
  username behavior. Security-sensitive contact changes use their own
  ceremonies, not an ordinary form patch.
- Optional preferred name, biography, website and a bounded set of social
  links. Each field has enabled, editable and completion requirements.
- Avatar enablement, shape, sizes, allowed raster formats, upload limits,
  cropping policy, and fallback choice. Default fallback uses name initials,
  then the first two letters of username/email when a name is unavailable.
- Optional phone contact and email/phone possession verification. Delivery
  adapter readiness is separate from the feature being configured.
- Regional preferences: language/locale, timezone, 12/24-hour time display,
  and first day of the week. "Use the app/system default" is an explicit
  value, resolved at display time rather than silently persisted from the
  browser or server timezone.
- Required-completion policy for new accounts and invited first sign-in.
  Existing-account enforcement is a separate explicit rollout choice.
- Presence enablement and policies described in the
  [presence plan](./guardian-presence.md).

Extended fields default disabled or optional unless the app explicitly
enables them. Disabling a feature hides it without deleting its data. Do not
silently adopt similarly named additional properties into canonical fields.

Publish a secret-free capabilities response for the signed-in user or the
narrowly admitted completion flow. It describes visible/editable fields,
verification availability, current completion requirements, read-only role
summaries, and supported avatar operations. UI props can narrow this response
but cannot grant capabilities absent from it.

Doctor must reject contradictory configuration, unsupported completion
requirements, invalid locale/timezone/status values, and enabled required
verification without a usable delivery path. Startup/readiness must make an
unavailable adapter actionable without exposing secrets.

## Enabling features on an existing installation

Configuration can change after bootstrap. Treat desired feature configuration
and installed feature state separately: enabled in config does not yet mean
provisioned and available. Reconcile them before publishing a ready capability
or serving a feature mutation.

For avatars, ensure the typed profile/media receipt schema and a managed media
namespace exist. For extended profiles, ensure the supported typed nullable
fields and indexes exist. For presence actor reads, ensure the relevant
organization-realm contribution is admitted and migrated. Do not create a new
bucket per user or copy global profiles into every tenant merely because an
organization database exists.

Reuse the platform Migrator, immutable registries, schema/realm composition,
database manager and existing readiness lifecycle. Add only the missing
feature-installation manifest/reconciliation responsibilities. The manifest
should record feature/schema version, target identity, configuration generation
where relevant, provisioned resource identity and state. A retry resumes the
same intended operation rather than creating another bucket or advancing an
incorrect success marker.

Resolve targets from feature ownership and the configured database mode:

| Mode or data plane | What feature reconciliation owns |
| --- | --- |
| Managed SYSTEM | Global profile/contact/manual-status schemas, receipts and media metadata |
| Pinned application database | Only explicit application-owned read projections/contributions |
| Fabric organization realm | Its admitted minimal directory/presence projection and realm-specific migrations |
| Existing unopened Fabric target | Durable desired-version state plus migrate-before-use; an explicit bounded rollout can reconcile it ahead of access |
| New organization | Latest admitted realm contribution and required installation state before that feature becomes ready |

Never apply SYSTEM migrations wholesale to an application/tenant file. Never
guess targets from directory names or open raw tenant handles outside Fabric.
Track progress per actual target; an unvisited actor is not successfully
migrated. A requested app-wide eager rollout needs bounded enumeration,
coordinator admission, failure reporting and resumability. Lazy migration is
acceptable only with an enforced before-use readiness barrier and clear
remaining-target diagnostics.

Use feature status such as disabled, provisioning, ready, blocked and failed
for the capability projection. Keep unrelated app features usable where safe;
required completion can block only when its required services are actually
available. Failure must have a standard code and recovery path, not an endless
spinner or partially admitted feature. Tenant-specific readiness must not leak
another organization's migration state to ordinary members.

Keep schema installation, projection backfill, adapter readiness and user
authorization distinct in that response. Existing identity-realm readiness
proves identity anchors/watermarks, not the new feature schema. The automation
source catalog is not a full tenant inventory: never-opened tenants may be
absent. Discover rollout targets from authoritative eligible organizations in
SYSTEM, with a durable discovery cursor and per-target acknowledgments.

Settle startup ownership explicitly. Today DatabaseManager starts in
`app.onStart`, and its actor ensure methods require that start; Bun does not
await asynchronous `onStart` callbacks as a general pre-publication barrier.
Choose an explicitly awaited managed-start path or post-start reconciliation
with feature capabilities held unready. Reuse existing capacity/admission
limits and classify quarantined actors separately from safely retryable
targets. Repeated ensure calls are not a recovery policy by themselves.

Optional supported profile fields should normally live in a stable typed
nullable schema, upgraded through append-only migrations when the framework
adds a field. Enabling/disabling a supported field changes policy/UI, not
arbitrary DDL generated from browser settings. Preserve data on disable. New
required fields for existing users need an explicit completion rollout; do not
backfill invented names, contacts or proof timestamps.

Respect explicit `migrate: false` and schema collisions; report an actionable
feature-unready state instead of silently altering app-owned tables. Do not
record a migration as applied while skipping its DDL because a feature is
disabled. Keep retained contributions and migration checksums stable when
configuration turns usage off. Initial ephemeral/runtime schemas must also
match the fixed durable migration definitions.

For local storage, provision a managed namespace using existing services. For
an external object store, distinguish an app-provided bucket from a provider
that permits Zero to create one. Validate credentials/capabilities and perform
any supported external provisioning idempotently through the provider adapter.
There is no atomic transaction spanning SQLite and an external bucket; use
durable receipts and compensating cleanup. Configuration alone must not imply
permission to destroy or overwrite an existing bucket.

The initial supported enablement path should be configuration deployment plus
controlled startup reconciliation, matching current app lifecycle. Runtime
settings toggles require an explicit server-owned reconciliation operation,
revision checks and service/realm admission. A client prop change does not hot
reload Elysia plugins or alter immutable actor registries. If runtime toggling
is implemented, document its supported scope and drain/restart requirements
instead of presenting all configuration as hot-swappable.

Qualify disabled-to-enabled upgrades against a populated prior-release
installation, repeated startup, interrupted provisioning, parallel processes,
closed actors, new organizations, lost provider readiness, partial rollout,
retry and disable/re-enable without data loss. Doctor must report desired
versus installed state and offer read-only diagnostics without pretending to
have migrated every organization.

## Storage ownership and revisions

Keep core names, username, login email and security state in the existing
SYSTEM user identity. Add small typed records rather than duplicating those
columns:

| Record | Ownership and purpose |
| --- | --- |
| Extended profile | SYSTEM, keyed by global identity; preferred name, biography, website/social links and opaque avatar reference |
| Regional preferences | SYSTEM, keyed by global identity; typed defaults and explicit user overrides |
| Contacts and proofs | Private SYSTEM records; canonical phone, pending contact changes, proof source/generation and ceremony state |
| Avatar staging receipt | Private SYSTEM record; exact identity, server-owned asset location, expiry, revision and consumed state |
| Member directory projection | Explicit minimal fields admitted to an organization; not a copy of all profile/contact data |

A person's canonical avatar and regional preferences must not depend on which
organization is active. Keep per-workspace interface preferences in existing
State Sync; its multi-tenant principal is organization plus user, not a
global-profile store.

All profile writes need expected revisions. Administrator changes to shared
core fields must advance the same relevant revision, so an old self-edit
cannot overwrite them. Responses return canonical accepted values and the
new revision. Do not use a client timestamp as a concurrency guarantee.

Separate profile, contact/security and presence-status revisions where their
independent writers would otherwise cause unnecessary conflicts. The public
settings adapter must explicitly coordinate any compound save; it must not
claim that unrelated service writes are one atomic transaction.

The self-service layer derives the target identity from live authority. It
rejects submitted roles, status, permissions, verified facts, arbitrary asset
paths and unknown fields. Revalidate after awaited I/O and at final SYSTEM
transaction admission. Cosmetic edits do not revoke every session; contact
and security changes perform the existing required security transition.

Default the member directory to display/preferred name and avatar only.
Login email, phone, region, proof detail and biography are not automatically
public to organization members. Bio/social visibility is an explicit app
policy. Membership removal/suspension and visibility changes retire old
projections through the same revision-aware path; no arbitrary global-user
lookup endpoint is implied.

## Avatar editing and finalization

Compose the editor from Zero's Avatar, Button, Dialog, Slider, Tooltip,
upload transport and shared error presentation. The edit action exposes
browse/upload, remove and a compact drag target around the avatar. Selecting
or dropping an image opens the crop dialog before any accepted upload.

The client owns a local draft, preview, crop/zoom state and cancellation. It
cleans up object URLs, rejects superseded selections, and cannot attach an
upload result after identity/scope retirement. Confirming the crop invokes
the SDK; cancelling leaves the current saved avatar untouched.

The interaction is click avatar, compact tokenized edit popover with
drag/browse/remove, crop dialog, confirm, then staged transfer/finalization.
Do not replace it with a permanent large storage-upload card. Dialog actions
remain reachable within a constrained scrolling body.

The server flow is:

1. Admit the live identity and reserve an opaque, expiring staging receipt at
   a server-chosen location in framework-owned profile media.
2. Transfer bounded bytes through the existing storage transport.
3. Decode the actual raster, bound dimensions/pixel count, validate crop data,
   and create normalized immutable derivatives through an image adapter.
4. Revalidate authority, policy and expected profile revision.
5. Consume the receipt and attach the canonical asset reference once.
6. Reclaim abandoned staging and superseded assets through recoverable,
   bounded cleanup after the successful commit.

Do not treat a storage grant's client-supplied flow/resource metadata as a
profile-ownership proof. Current grants are bearer capabilities. Do not accept
an arbitrary tenant drive path, remote URL or SVG as an avatar attachment.
Keep the old avatar until the replacement is accepted; cleanup must not
delete a still-referenced shared asset. Member/avatar delivery needs an
explicit public-versus-authorized policy and safe cache/version semantics.

Bind the attachment receipt to the exact immutable processed asset/checksum
and identity. Retrying the accepted command returns the same result;
conflicting reuse fails. Cleanup rechecks all live references before deleting
shared CAS bytes. Disabling avatars neither deletes the old image nor changes
it to public. Processing/delivery jobs drain before their providers dispose.

A crop engine can be wrapped without creating a second controls library.
[react-easy-crop](https://github.com/ValentinH/react-easy-crop) is a candidate,
not a selected dependency. Its modal sizing must be tested with Zero's motion
wrappers; opening-scale animation can invalidate crop geometry. The user may
provide another existing component. A server image adapter is also required;
MIME sniffing alone is not decode validation. An adapter such as
[sharp](https://sharp.pixelplumbing.com/install/) requires Bun/package/runtime
qualification before selection. Prefer Bun APIs wherever they provide the
needed operation; a supported native library is not permission to introduce
a separate Node runtime.

Add the requested REUI `c-avatar-29` group with icon count and optional add
button from the [avatar examples](https://reui.io/components/avatar). Inspect
that exact variant and compose the existing Avatar/AvatarGroup rather than
adding a competing avatar engine. The add action is app-supplied and
permission-aware. Every member can use the same presence ring/dot contract;
square mode follows the configured rounded-square silhouette. Overlap and
focus outlines must not clip the ring or obscure its accessible label.
Presence decoration is conditional on the app enabling presence. When it is
disabled, the group renders ordinary avatars without creating subscriptions
or interpreting the absence of a status as offline.

## Real contact verification

The current `emailVerifiedAt` cannot by itself produce a possession-verified
badge: registration can set it when verification is not required, and an
administrator can override the gate. Optional profile verification needs a
proof-aware ceremony in addition to the existing mandatory registration
gate. See [user store](../src/auth/user-store.ts),
[resend service](../src/auth/auth-verification-resend-service.ts), and
[identity proof store](../src/auth/user-identity-store.ts).

Keep absent, unverified, pending, delivery-unavailable, possession-verified
and administratively-attested states distinct. A verification badge is
server-derived and accessible without relying on color alone. Format
validation, an administrator bypass, and a submitted `verified` flag do not
prove ownership.

Bind every proof to the identity, exact canonical contact, generation,
purpose and admitted challenge. Bound expiry, attempts and resend rate;
store secrets hashed where appropriate; consume proofs once. Contact removal
or replacement retires previous proof/challenge state.

Low-entropy OTPs need a server-secret-backed digest and strict attempts, not
an unsalted hash vulnerable to offline enumeration. Bound requests by user,
contact and request source. Late provider completion cannot reinstate an
expired contact/policy/authority generation. Never backfill policy-exempt or
admin-attested timestamps as possession proof. Ordinary API keys cannot
manage account contacts merely because they have app permissions.

For email replacement, retain the old login email until the candidate is
proved. Final commit checks uniqueness and unchanged generation before
replacing it and applying the required security transition. Preserve current
login until a mistyped or unreachable candidate can be corrected.

PhoneInput's E.164/numbering-plan validation is not SMS verification. Provide
an optional application-supplied phone delivery/verifier adapter unless a
built-in provider is separately selected. Disabled or unready delivery cannot
claim phone verification support. Phone contact verification does not add SMS
as an MFA method.

Optional cosmetic/phone contact changes do not revoke all sessions by
default; invalidate their proof generation. Only contacts used for login or
an actual security factor require the matching security transition.

## Required completion before application access

Extend the existing hashed, short-lived continuation machinery with a distinct
profile-completion purpose. A frontend redirect alone is not an enforcement
boundary. The completion credential may read requirements and submit allowed
profile fields, but cannot query app data or operate ordinary services.

The intended order is identity proof, required email proof, MFA, required
profile completion, tenant selection/onboarding, then full session issuance.
Implementation must check the central completion seams so signup, invitation,
password setup, native/OIDC completion, tenant selection and refresh cannot
bypass the gate. Preserve achieved MFA assurance and existing invitation and
native continuation context.

Bind completion to identity/security generation and current completion-policy
revision. Re-read requirements at final admission; consume the continuation
atomically with the resulting session transition. Do not fabricate defaults
to mark a legacy account complete. Avoid blocking existing users unless the
app explicitly enables that rollout.

If a required proof provider becomes unavailable, keep completion UI reachable
with truthful diagnostics while denying new full-session admission. Existing
sessions follow the explicitly selected rollout policy. Operator recovery is
deliberate and auditable, not a client Skip button or fabricated verification.

## Shared draft and save behavior

Use one headless settings draft controller layered on existing form state.
It tracks accepted baseline, current draft, validation, pending operation,
revision, error/conflict and leave decision. Do not create another independent
form engine or put persistence in the base Input.

The existing `useForm.handleSubmit()` catches errors and returns `void`;
resolution alone is not success. Extend it through a backward-compatible
accepted-result/baseline seam. Reset and discard must use the latest accepted
baseline, not permanently retain the initial mount's values.

Support both requested modes:

- Inline fields show compact tokenized Save/check and Cancel/X actions when
  dirty. Existing text editing keeps its geometry; an opt-in explicit-commit
  mode must suppress blur-to-save so clicking Cancel cannot race a write.
  Preserve the old default for current consumers. Specify Enter/save,
  Escape/cancel, Tab/focus and IME behavior; other field types use the same
  field-save controller and current controls.
- Page forms expose a bottom-center save bar only when dirty or pending.
  Save, discard and feedback remain usable without obscuring content or
  mobile safe areas. Save adopts only the acknowledged submission; edits made
  during the request remain dirty instead of being overwritten.

Coordinate inline and page saves so accepting one field does not erase other
unsaved fields. Duplicate activation cannot create duplicate mutations.
Conflicts preserve the user's draft and offer review/reload rather than a
blind retry with a newly copied revision.

Extract the existing Data Studio three-way discard pattern into a shared
controller/composition. Add an explicit guarded navigation and close seam;
post-close notification is insufficient. Test push/replace/back, popstate,
external navigation and modal close behavior. Security-driven logout, session
retirement and organization changes must not be vetoed by "Stay" or retain
the retired draft. Native tab close/reload uses the browser's `beforeunload`
prompt; browsers cannot guarantee a custom async save dialog at that point.

## Reusable settings organisms

### Settings sections and matrix

Small section/row primitives provide consistent title, description, field,
help, optional action and pending/error locations. A matrix supports one to
three option columns, icons/labels, per-cell locked/read-only state and
reasons, counts and an optional footer. It composes existing Table and
Checkbox/Switch rather than duplicating them.

Rows identify a setting; columns identify choices such as Email/In-app/Push.
On narrow screens retain that relationship with labeled choices, not clipped
checkbox columns. Keyboard navigation, labels and screen-reader state must
remain explicit. Asynchronous saves use the same draft/action contract.

A notification settings binding needs a real preference/delivery adapter.
The existing notification inbox manages receipts, not channel preferences.
Persisting a checkbox with `usePreference` does not enforce delivery or a
required-channel rule. Do not expand this UI task into an unrequested new
notification transport.

### Integration settings list

Provide a single list or grouped sections with leading service identity,
name/description, compact connection status and an existing menu for Review,
Reconnect, Remove or app-defined actions. Support user, organization and
platform settings through supplied capability/action adapters.

The component renders authorized actions; it does not invent an OAuth registry
or accept a scope ID as authority. Await actions, prevent duplicate clicks,
confirm destructive removal and reconcile the accepted result. Never render
provider credentials or log tokens. Existing menu primitives supply icons,
semantic colors, separators and submenus.

### Shared keyboard key component

As the last implementation step after the profile/presence work, add or
replace the shared keyboard-key presentation using the full public
[REUI Kbd](https://reui.io/components/kbd) primitive and grouping behavior.
Preserve any actual public shortcut-helper contract and migrate existing
shortcut presentations to the shared primitive where appropriate.

Inspect the upstream component source before selecting exact defaults. Move
its presentation defaults into explicit component token aliases, preserve
its compact key/group/icon treatment, and bind semantic surfaces and text to
Zero's light/dark themes. Do not change the entire app theme to approximate
one keyboard hint. Keep semantic `kbd` markup, accessible shortcut labels,
SSR-safe platform hints and existing hotkey behavior; a key label must not
install a new keyboard listener by itself.

The reviewed REUI examples all use the common shadcn `Kbd`/`KbdGroup` primitive.
Its default key is 20px high/minimum width, 12px text with small padding/gap,
small radius and 12px icons, on muted semantic surfaces. No new runtime
dependency is needed beyond Zero's existing class-merging helper. Keep public
Command/Dropdown/ContextMenu shortcut wrappers and string props compatible;
their trailing counts/metadata are not automatically key hints. Migrate raw
key hints in the docs package too. Upstream's tooltip-content selector differs
from Zero's current popover-content inner wrapper: use the actual tooltip
context and token pairing rather than copying a nonmatching selector.

## Tokens and microinteractions

Use existing semantic colors, typography, radius, spacing, controls, icons
and motion facilities throughout. Where a new organism needs a domain token,
define an alias centrally instead of baking a hex color, density or motion
timing into the component. Current source is not uniformly tokenized for all
metrics; audit every newly touched presentation rather than assuming it is.

Use a common restrained transition for section state, dirty actions,
save-bar entry and menu feedback. Avoid scale motion where it changes crop
geometry. Respect reduced motion, focus visibility, touch targets and
contrast. Success/error colors must have labels; do not make their meaning
depend on green/red alone.

## Engineering and documentation

Maintain separate config/validators, stores, domain services, Elysia routes,
authenticated SDK adapters, hooks/controllers and rendering components.
Reuse the existing request-service and async/synchronous authority fences.
New events use `OBS_CODES`, `emitPlatformCode`/`emitFrontendCode` and standard
error presentation. Log operation, revision and outcome without contacts,
biography, OTPs, image contents, upload grants or tokens.

Use append-only SYSTEM migrations and existing schema admission. Check schema
parity, indexes, migration idempotence, startup readiness, Doctor diagnostics,
package public exports and SSR safety. No live Pantheon data, config or
credentials are part of feature testing.

Add supported guides only as each contract is implemented and qualified:
Guardian profiles, avatars, contact verification, completion, configuration,
frontend adaptive profile/settings, draft/save guard, matrix, integration list
and Kbd. Update both current guides and `docs-next` feature inventories,
indexes/backlinks and the agent start-here route. Include compatibility and
upgrade notes; never label proposed APIs or pending migrations supported.

## Delivery and acceptance

1. Settle strict config, proof meanings, revisions, capabilities and adapter
   interfaces, then feature enablement/reconciliation across existing and new
   installation targets. Keep disabled defaults compatible with current apps.
2. Implement typed profile/regional storage, self-service and explicit minimal
   directory projection; qualify public HTTP/SDK/package paths.
3. Add staged avatar processing and contact ceremonies using existing storage
   and token/delivery services; then required-completion continuation.
4. Add accepted-baseline and guarded-save seams to existing forms/router,
   followed by settings organisms and the adaptive profile composition.
5. Implement and qualify the separate
   [presence architecture](./guardian-presence.md), including current room
   lifecycle defects in the touched responsibility.
6. Complete Kbd, focused package/browser tests and all affected documentation.
   Merge/publish only the qualified intended changes; do not publish unrelated
   changes from another worktree.

Acceptance includes configuration/mode combinations; disabled/unknown/error
capabilities; own-profile versus admin authority; forged fields; revision and
scope retirement; avatar cancellation and late completion; invalid/oversized
images; mailbox proof provenance; phone adapter readiness; proof expiry and
duplicate use; signup/invite/native/MFA/tenant completion; accepted save
baseline and newer pending edits; three-way navigation; SSR; real light/dark
browser interactions; keyboard/touch/reduced-motion layout; and package-only
consumption. Presence has its own detailed gates. Focused suites accompany
each responsibility; a full massive suite is not required after every edit.

## Authorization ideas reserved for later

Current Guardian persists assignment/history and a canonical versioned
configuration manifest, but role definitions still come from immutable app
configuration. There is no optional organization-editable role catalog or
direct user/member permission grant API. Multiple advanced roles are
supported today; storage user ACLs and API-key ceilings are different things.

An optional later catalog can seed app templates into protected Guardian
tables, keyed by organization, and permit bounded customization from the
declared permission vocabulary. Keep configuration-only mode as default.
Do not move authority into ordinary user-editable tenant tables or permit a
customer organization to acquire application/platform permissions. Protected
owner semantics, assignment ceilings, version/revision admission and live
HTTP/resource/Sync/key invalidation remain mandatory.

Direct grants could later add narrowly scoped, auditable membership
permissions to role-derived authority. Start with positive grants rather than
inventing deny precedence. Removing one grant must not remove the same
permission still supplied by a role. Both ideas need a separate authorization
design and qualification, not only a new settings checkbox.

## Remaining dependency choices

The user can supply the intended existing cropper; otherwise select an
existing engine after comparing its license, accessibility, token integration
and Bun/package footprint. No bespoke crop algorithm is planned. Phone proof
uses an optional app delivery adapter unless a provider is separately agreed.
These choices do not block profile/settings contract design, but affect
end-to-end avatar and phone-verification qualification.
