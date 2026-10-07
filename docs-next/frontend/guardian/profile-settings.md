---
id: zero.frontend.guardian.profile-settings
type: reference
audience: [developer, agent]
owner: guardian
status: verified
visibility: internal
system: guardian
feature: adaptive-profile-settings
maturity: supported
applies_to: ["2.6.0"]
modes: [browser, SSR, full, compact, read-only, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "c5656b306051b04ec6adc641b7057a0672fd7a3e"
  snapshot: clean
  date: "2026-10-07"
  evidence_level: implementation-verified
---

# Adaptive User Profile Settings

[Guardian frontend index](./index.md) · [Own-profile backend](../../backend/guardian/user-profiles.md) · [Forms](../forms/index.md)

`UserProfileSettings` is the reusable own-account settings surface. Place it in
an existing AppProvider/ClientProvider; Guardian supplies the current identity,
server-enabled fields, real readiness and live session scope. An app does not
need to rebuild a password-card page or supply an arbitrary target user ID.

```tsx
import { UserProfileSettings } from '@zero/framework/react';

export function MyAccount() {
  return <UserProfileSettings mode="full" saveMode="page" />;
}
```

Use Zero's platform stylesheet. The focused
`@zero/framework/components/profile-settings` path also exports the organism
and its independent sections. Server configuration is described in
[Own profiles](../../backend/guardian/user-profiles.md),
[Contacts](../../backend/guardian/contacts.md),
[Avatars](../../backend/guardian/avatars.md) and
[Presence](../../backend/guardian/presence.md).

## Modes And Sections

`mode` is full (default), compact or read-only. `saveMode` is page (default) or
field. `saveBar` is floating/inline/false; absent uses floating for page mode
and inline for field mode. Optional `security`, `contacts`, `avatar`, `presence`
and `additionalProperties` props default true but can only narrow the server's
policy. `className` and `children` allow normal app composition.

The identity summary shows the actual name/email and read-only assigned roles.
Configured name, preferred name, biography, website and social links render in
the profile section; separate username appears only when allowed. Regional
fields use Zero selectors and inherit application defaults explicitly.
Unsupported/disabled optional features are omitted, not dead cards.

Password change opens a focused current-password ceremony. MFA is shown only
when the app enables it, with actual provider/method readiness. Contacts show
possession/attestation/pending badges and their separate security actions. Role
labels never turn into permission-changing editable inputs.

The independent exports are `UserProfileIdentitySummary`, `UserProfileFields`,
`UserRegionalSettings`, `UserProfileSecurity`, `UserContactSettings`,
`UserContactProofBadge`, `ContactEmailVerification` and `UserPresenceSettings`.
`useUserProfile`, `useUserContacts`, `useGuardianPresence` and
`useAvatarPresence` are public from the React facade.

## Edits, Acknowledgements And Leave Protection

Page mode collects edits and uses the shared compact Save/Discard bar. Field
mode adds explicit small check/cancel buttons to configured identity fields;
regional changes still use the shared Save/Discard bar. Blur does not silently
save, and IME composition is not treated as confirmation. Read-only controls preserve
legible values without pretending they are editable.

Only accepted values advance the baseline/revision. If the user types again
while an earlier save waits, that newer text remains dirty. Validation errors
retain the draft; revision conflicts require reviewing current data rather
than retrying an overwrite. A taken username is an availability error, not a
revision conflict: correct the username and save again without reloading or
discarding other dirty fields. See [Save and leave](../forms/save-and-leave.md).

The shared controller protects ordinary navigation with Save/Discard/Stay and
uses the browser's native unload warning. It does not veto logout, revocation
or a scope-retirement transition. Another account/organization boundary retires
pending callbacks and old private data. Optional avatar/contact readiness
changes do not discard an unrelated active core-profile draft.

`useUserProfile` also admits read/write snapshots only for the live authenticated
account. A malformed or wrong-account reply cannot replace displayed values or
advance the accepted baseline; the UI keeps safe error feedback instead of
rendering the reply. Retry refreshes policy before the guarded data request so a
temporary policy-loading state does not silently suppress that retry.

## Avatar Editing

When enabled/ready, the avatar summary offers browse/upload/remove and a compact
drop target. Selecting or dropping a JPEG, PNG or WebP opens the existing
react-easy-crop engine inside a tokenized, fade-only Zero Dialog. Zoom controls
and the crop preview stay within the available viewport; the image is not
attached until the real staged Storage/Guardian acknowledgement succeeds.

The optional `AvatarEditor` is also independently composable. Its transport
keeps the entire upload under one captured identity, validates private receipt
responses and revokes temporary object URLs when retired. Avatar changes adopt
the shared profile revision without discarding unsaved name/bio edits. The
server decoder remains authoritative even when the browser sends cropped WebP.

An independent `AvatarEditor` consumer's `onAccepted` notification does not
control image persistence. Synchronous throws or rejected returned promises are
observed with Zero's safe auth-action event while that account remains current;
they do not undo an accepted picture, retry its write or leak a retired account's
callback error into a replacement page.

Circle/rounded/square presentation, size and fallback follow server policy.
Fresh optional presence rings follow the configured shape. No image upload
means initials by default, with configured username/email fallback when names
are absent. A directory avatar is not a public download URL.

## Availability And Other Reusable Settings

`UserPresenceSettings` observes the existing SDK tracker and offers only its
currently selectable statuses. Manual status writes have independent expected
revisions and optional expiry. An error affects the availability section, not
the rest of the profile. Fresh observations can decorate an
[Avatar Group](../components/avatar-group.md) without adding heartbeats per item.

Use [Settings Matrix](../components/settings-matrix.md) for one-to-three-channel
notification preferences and [Integration Settings List](../components/integration-settings-list.md)
for grouped app/user/org connections. These organisms provide acknowledged
presentation contracts; the app still owns its real delivery rules/OAuth
connection service. They are not a built-in social login manager or an invented
notification preference endpoint.

## Limits And Troubleshooting

Blocked profile/media/contact storage shows an actionable migration/readiness
state. UI props cannot provision a service, invent possession proof or bypass
native writer scopes. If an explicit public-path list is used, include the
configured contact-verification page and enabled completion entrance.

Device/session management, self-deletion, passkeys and editable tenant role
definitions are not implied by this profile component. Existing administrative
account actions remain in the [people control plane](./people-control-plane.md).
Required first-use completion runs before a general app session, not by showing
an unprotected dashboard form after sign-in.

Use `ProfileCompletionForm` only with the current in-memory continuation, or
let `AuthFlowContinuation` select it automatically. Render a standalone enabled
entrance at `/complete-profile` only if the app wants one; never put its proof in
a URL or localStorage. Missing proof asks the user to restart sign-in. Completion
may continue to tenant selection/native consent rather than app success. See
[required completion](../../backend/guardian/profile-completion.md).

- [Account actions](./account-actions.md) documents independent password/property forms.
- [Authentication flows](./authentication-flows.md) owns restricted continuations.
- [MFA controls](./mfa-controls.md) documents method enrollment/challenge behavior.
