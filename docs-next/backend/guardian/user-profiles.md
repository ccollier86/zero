---
id: zero.guardian.user-profiles
type: reference
audience: [developer, agent, operator]
owner: guardian
status: in-review
visibility: internal
system: guardian
feature: own-profile
maturity: preview
applies_to: ["Adaptive profile working source; release qualification pending"]
modes: [single-simple, single-advanced, multi-simple, multi-advanced, native]
reviewed_against:
  package: "@zero/framework"
  version: "2.5.0"
  commit: "ae85a4b6efe11eeb74ab89b15ed02a23e982c59f"
  snapshot: dirty
  date: "2026-10-06"
  evidence_level: source-observed
---

# Own Profiles And Regional Preferences

[Guardian index](./index.md) · [Configuration](./configuration.md) · [Profile UI](../../frontend/guardian/profile-settings.md)

Guardian provides an ordinary signed-in user with a whitelisted profile editor.
It is not the administrative account writer: a member can edit the configured
personal fields without receiving user-management or platform permissions.
The canonical profile lives in SYSTEM, so switching an organization does not
create another identity, biography or set of regional preferences.

## Configure The Fields

```ts
import { defineAuthConfig } from '@zero/framework/auth';

export const auth = defineAuthConfig({
  userProfile: {
    usernameMode: 'email',
    fields: {
      firstName: { enabled: true, editable: true, required: true },
      lastName: true,
      preferredName: true,
      bio: true,
      website: true,
      socialLinks: true,
    },
    regional: {
      enabled: true,
      fields: ['locale', 'timeZone', 'timeFormat', 'weekStartsOn'],
      defaults: { locale: 'en-US', timeZone: 'UTC', timeFormat: '12h', weekStartsOn: 1 },
    },
  },
});
```

`enabled` defaults to true. First name and last name are enabled and
editable by default; separate username, preferred name, biography, website, social links and
regional preferences are opt-in. A field accepts a boolean or an
`{ enabled, editable, required }` policy. Required fields must also be enabled
and editable. Unknown fields/configuration keys are rejected.

`usernameMode: 'email'` rejects enabling separate username editing. It does not change
the existing login identifier contract or automatically rewrite older usernames.
An email change is a separate [verified contact ceremony](./contacts.md), not a
cosmetic profile field update.

Regional values are `locale`, `timeZone`, `timeFormat` (`12h`/`24h`) and
`weekStartsOn` (0–6, Sunday–Saturday). A null value means inherit the application
default; it is not silently inferred from a browser or overwritten when that
default changes. Locale/time zone values are validated against the platform's
internationalization support. `socialLinks` is a bounded list of labeled HTTP(S)
links, not arbitrary executable markup.

## SDK And HTTP Contract

`client.userProfile` and `client.auth.profile` expose `get(signal?)` and
`update({ expectedRevision, changes }, signal?)`. `useUserProfile()` composes
these calls with the current authorization boundary.

`GET /auth/profile` returns a `UserProfileSnapshot`: `userId`, `revision`,
`email`, typed `values` and actual `capabilities`. `PATCH /auth/profile` accepts
only the enabled/editable fields in `changes`. Roles, status, trusted properties,
avatar references and email proof cannot be smuggled into this patch.

The writer validates the full required-field result, performs a compare-and-swap
against the supplied revision and rechecks live session authority at the final
transaction boundary. A concurrent profile or avatar change returns
`AUTH_PROFILE_REVISION_CONFLICT`; reload/review rather than overwriting it.
An acknowledgement is the accepted stored snapshot, not the submitted draft.

Web sessions may use own-profile operations. Native sessions require `profile`
to read and explicit `profile:write` to write; a native caller without `email`
receives a null email. API keys are not account-profile sessions. These scopes
do not grant another user's private profile.

## Additional Settings, Contacts And Media

Configured [user properties](./user-properties.md) retain their own writer and
trust rules. They are not arbitrary additions to the typed profile patch.
[Contacts](./contacts.md) have a separate revision and possession ceremony.
[Avatars](./avatars.md) share the profile revision but use private staged storage,
not an editable URL column. Read-only role labels remain a live authorization
projection, not a user-editable profile field.

The packaged [profile component](../../frontend/guardian/profile-settings.md)
adapts to actual server policy. UI props can omit or narrow a section; they cannot
enable a blocked backend or expand native scopes.

## Provisioning And Safe Rollout

Migration 039 installs the fixed SYSTEM profile table and shared user revision.
Enabling extra fields after initial provisioning uses that fixed representation;
it does not create application-config-driven SQL columns in every tenant.
The canonical profile is global identity data, not a customer Fabric table.

Managed startup can reconcile the known additive schema only when SYSTEM
installation/migration is allowed. With migration disabled or an incompatible
table, capabilities are `blocked` and the own-profile route returns
`AUTH_PROFILE_NOT_READY` (503), without pretending the feature is ready or
repairing a conflicting schema. Ordinary authentication remains available.
Disabling the feature hides the self editor; it does not delete retained data.

Migration 039 also installs a private policy-generation clock. Guardian bootstrap
alone adopts the resolved profile/region/contact/avatar/completion configuration
and the non-secret phone-adapter identity. Feature services capture that generation
and recheck it at admission, after asynchronous work and at their final writer
fences. An older runtime returns `AUTH_PROFILE_POLICY_CHANGED` (409), and its
capabilities become `blocked`; restart/recompose under the current policy rather
than retrying against a retired service. Restoring the old configuration advances
the clock again and does not reactivate the old runtime. This optional-feature
guard does not replace ordinary account/session/tenant authorization.

Schema installation does not invent a policy owner, and constructing a profile
reader does not adopt configuration. [Doctor](../../cli/doctor/infrastructure-inspection.md)
can report a missing, malformed or unreconciled policy without updating it.

Guardian shutdown retires own-profile reads and writes before waiting for other
workers to drain. A retained service handle reports `AUTH_PROFILE_NOT_READY`
instead of committing during teardown or accessing a cleared runtime graph.
Its capability projection becomes blocked and noneditable.

Required first-sign-in completion has an explicit enrollment/rollout policy;
making a field required does not authorize a partial session to use app APIs.
See [required profile completion](./profile-completion.md) and
[authentication flows](../../frontend/guardian/authentication-flows.md).

## Errors, Evidence And Related Contracts

Updates emit the secret-free `AUTH_USER_PROFILE_UPDATED` code after acceptance.
Schema readiness emits `AUTH_USER_PROFILE_SCHEMA_UNREADY`. Field values, contact
proofs and credentials do not belong in observability metadata.

Regression coverage includes exact schema admission, migration-disabled behavior,
field rejection, native scope ceilings, shared revisions, actual HTTP stale-runtime
retirement across configuration changes and final live-authority rollback.
Release/package qualification is tracked separately; this page describes
the working source, not an already-published upgrade.

- [Account lifecycle](./accounts.md) is the separate privileged writer.
- [Presence](./presence.md) is activity/availability, never authentication proof.
- [Accepted form drafts](../../frontend/forms/save-and-leave.md) preserve newer typing.
- [Data planes](../../concepts/data-planes.md) explains SYSTEM versus app/tenant data.
