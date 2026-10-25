---
id: zero.blog.configuration
type: reference
audience: [developer, agent, operator]
owner: blog
status: in-review
visibility: internal
system: blog
feature: configuration
maturity: preview
applies_to: ["2.6.0 feature/blog-foundation preview; not the selected main archive"]
modes: [managed-server, single-simple, single-advanced, multi-simple, multi-advanced]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "c7011c7dd9dc8561b767752be51029a31ac327cf"
  snapshot: clean
  date: "2026-10-25"
  evidence_level: package-qualified
  artifact:
    version: "2.6.0"
    commit: "c7011c7dd9dc8561b767752be51029a31ac327cf"
    sha256: "98d564817e4b659d7327d1e11f7206e88cf2c9eb4a25b60e251dde294e4e8b25"
---

# Enable Authors Or Just Expanded Profiles

[Blog index](./index.md) · [Existing-project upgrade](./upgrade.md)

## Enable Blogging's Author Foundation

Add this property to the project's existing `defineZeroConfig` declaration:

```ts
blog: true,
```

Keep the existing `db`, `systemDb`, tables, theme, auth and registration settings.
Do not replace the app configuration with a new minimal example. A fresh app
with omitted `auth` gets Guardian defaults when blog is enabled; explicit
`auth: false` is rejected. Enabling authors does not change an existing app's
registration/bootstrap ceremony or convert single tenancy to multi tenancy.

`blog` accepts omitted/false (off), true (defaults), or this object:

```ts
blog: {
  siteName: 'Journal',
  authors: { requireAvatar: true, requireBio: false },
  // Optional: a narrower existing Guardian requirement.
  manageAuthors: 'admin',
},
```

| Setting | Default | Behavior |
| --- | --- | --- |
| `siteName` | Blog | Nonempty, at most 160 characters. Names a newly created scoped directory; changing config does not rename existing records. |
| `authors.requireAvatar` | true | A real explicitly published normalized photo is required to publish a byline. Initials/private photos do not satisfy it. |
| `authors.requireBio` | false | When true, publication requires a nonempty public biography. |
| `manageAuthors` | Single: admin; multi: `tenant.members:manage` | Existing Guardian role/permission/trusted-property requirement; must contain an actual authority restriction. Plain true/user/public is rejected. |

A nonempty public display name is always required. These are **author
publication checks**, not new login requirements. They do not enroll existing
users into first-sign-in completion or block unrelated app access.

For advanced RBAC, declare the intended management permission/role in the normal
Guardian registry, assign it through its supported control plane, then reference
it here. Blog does not bump registry versions, grant roles or replace custom
templates. Multi-tenancy's default lets a permitted organization manager manage
that organization's authors; it does not grant cross-organization access.

## Additive Profile Defaults

With blog enabled, omitted `auth.userProfile.fields.preferredName`, `bio`,
`website` and `socialLinks` become enabled. Omitted avatars become enabled;
public-avatar support becomes enabled when required by the author photo policy.
Normal first/last-name defaults remain Guardian-owned.

An existing `{ enabled: false }`, field false, or read-only field policy is
preserved. Explicit `userProfile.enabled: false` rejects blog enablement.
Explicit avatar disabling/private-only policy combined with required public
photos also rejects. Either deliberately enable public-photo support or set
`blog.authors.requireAvatar: false`; Zero never overrides that privacy decision.

The adaptive `UserProfileSettings` exposes newly enabled **private** fields
through its existing capability-driven editor. An app that explicitly hides a
section with UI props must also remove that local restriction. This slice does
not insert an author-management screen or public-profile editor into arbitrary
app navigation. Use the [author facade](./authors.md) for those actions until
the author UI is added.

## Enable Only Profile Features

Blogging is not a prerequisite. Extend the existing `auth` object, retaining
its other policy fields:

```ts
userProfile: {
  fields: {
    preferredName: true,
    bio: true,
    website: true,
    socialLinks: true,
  },
  avatars: { enabled: true, publicAccess: true },
},
```

This is a fragment **under `auth`**, not a top-level setting. Enable only the
fields needed by the app; `publicAccess` is optional and defaults false.
The normal `client.userProfile` and `client.userAvatar` facades work without
`blog`. No blog service, enrollment or public author routes are mounted.

Profile fields already have fixed nullable SYSTEM storage. Enabling a field
does not generate an app SQL column or rewrite old values. Public-avatar
support adds migration 045, but existing images remain private. See the
[upgrade procedure](./upgrade.md) before changing a deployed app.

## Read Time And Feature-Off Behavior

These are server startup settings, not browser-supplied policy. Restart/recompose
after changes. The installed policy clock retires old writers; configuration
A→B→A does not reactivate the original A handle.

Turning blog off removes its managed API/facade but retains author records.
Turning public avatars off stops public delivery without deleting private
images. Turning profile fields off hides their editor without deleting values.
None of these is a data-erasure operation. Restoration of retained published
data is deliberate; [disable/rollback](./upgrade.md#disable-and-rollback) explains
the distinction from permanently withdrawing it.

## Related Guides And Next Steps

- [Guardian configuration](../guardian/configuration.md) owns profile field policies.
- [Public avatars](../guardian/avatars.md#optional-public-avatar-publication) owns consent and image URLs.
- [Author operations](./authors.md) documents actual SDK and route calls.
