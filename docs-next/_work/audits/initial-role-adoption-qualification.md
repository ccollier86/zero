---
id: zero.audit.initial-role-adoption-qualification
type: operations
audience: [agent, maintainer, operator]
owner: guardian
status: in-review
visibility: internal
---

# Initial Single/Simple Role Binding Qualification

[Audit working evidence](./index.md)

[RBAC upgrade procedure](../../backend/guardian/rbac.md#first-permission-bindings-on-an-existing-single-simple-installation)
· [Configuration](../../backend/guardian/configuration.md)
· [Saved releases](../../cli/tooling/releases.md)

## Boundary And Ownership

The reported populated upgrade starts at Zero 2.10.2, commit
`8f7750ee1a97c35ffd2030713ff00052b2d57d32`, archive SHA-256
`b0e33d08c8a8f71733ae2d1b57c904af586171f0cc9be8612fa474729bca14d5`.
Its original single/simple registry is empty at version 1. Adding a first
explicit `admin` permission template at version 2 was rejected as a retained-role
reactivation even though the application deliberately declared the new binding.
The guard is necessary; the missing initial-adoption contract was framework-owned.

Zero 2.10.3 adds that narrow public startup acknowledgement. The application owns
choosing the exact bounded role bindings, enabling the selector in its candidate
configuration and repeating its populated upgrade/browser acceptance. No
application source, private staging evidence, real account, live database,
provider or deployment is modified by this framework qualification.

No schema migration or account/session rewrite is introduced. The pure
authorization evaluator and canonical permission fingerprint remain unchanged;
startup forwards the explicit selector separately. Only an untouched empty v1
single/simple manifest proves eligibility. Ordinary retired-role, version,
profile, permission and revocation boundaries remain enforced.

## Reproducible Checks

- `src/auth/auth-initial-role-adoption.test.ts`: populated failure without the
  selector; admin allow/member deny; unchanged users; one durable audit per
  binding; idempotence/removal; unaffected retained roles; genuinely retired
  roles; nonempty/unmarked sources; version drift/rollback; atomic rollback;
  fresh initialization and configuration rejection.
- `src/frontend/server/initial-role-adoption.integration.test.ts`: real managed
  HTTP and separate file-backed application/SYSTEM databases. Public
  registration, native PKCE/consent, blocked unacknowledged startup, successful
  adoption, permission-gated operations, member denial, web/native refresh,
  exact restart, original password and audit-once checks. The native default
  rotation cooldown is tested, not disabled. The fixture waits out its default
  cadence before the second permitted rotation.
- Existing manifest, configuration, kernel, authorization, profile-transition
  and native managed-form tests exercise neighboring security boundaries.

Use the canonical runner with those eight paths and `--timeout 120000`, then
`bun --no-env-file run typecheck`. The source run passed all 77 tests / 591
assertions across eight files; TypeScript also passed. Source evidence is bounded under
`artifacts/zero-platform/diagnostics/authorization-registry-upgrade` on the
managed external volume. An earlier fixture attempt used the wrong public login
field (`email` instead of `username`); a separate attempt violated the default
native rotation interval. Those failed fixture runs are not represented as
passing framework evidence.

The new managed fixture marks synthetic ownership, records its root inode,
stops all owned managed apps and removes its exact synthetic root in `finally`
on success or failure. A shutdown/ownership failure preserves only that exact
root with an explicit error. No broad cleanup or production state access occurs.

## Package And Adoption Gate

Qualification must use a committed archive, not a dirty checkout. The final
receipt alongside the external diagnostics records the exact commit, archive
path, SHA-256, installed-package checks and saved updater selection. The package
includes this source and guide. `zero-release --status` verifies the selected
saved archive; application version numbers alone are not release identity.

Stupify should pull through its normal `zero-update`, add the documented
`initialRoleAdoption` selector to its version-2 single/simple candidate, then
repeat the owned populated rehearsal and its real browser walkthrough before
deployment. Do not change the existing user roles, edit the manifest, erase
refresh families or disable the guard. This patch does not claim to qualify the
application's unrelated communications/browser features.

All generated qualification output remains external under the user's explicit
exception for the internal free-space warning. Docker was stopped; no Linux
container execution or production acceptance is claimed by host-only checks.
