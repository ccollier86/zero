---
id: zero.audit.blog-author-foundation
type: operations
audience: [agent, maintainer]
owner: blog
status: in-review
visibility: internal
---

# Blog Author Foundation Qualification

[Audit index](./index.md) · [Author backend](../../backend/blog/index.md) · [UI qualification](./blog-ui-qualification.md)

## Scope And Release Boundary

Work is isolated on `feature/blog-foundation`, following clean UI/documentation
source `72bb87d55055b5b07776a1ad450040464729688d`. This record is being completed
with the frozen backend source/archive and final focused results. It is not a
main merge, selected stable package, registry publication or live-app upgrade.

The implementation adds managed user-backed author enrollment, separate public
drafts, scoped publication/withdrawal, optional public Guardian avatars, browser/
request facades, live authorized projections and same-transaction Guardian
audit. It deliberately does not add post storage, a block editor, auto article
routes, scheduling or automatic blog SEO. Existing recovered UI and original
theme/source are retained.

## Review Findings Corrected

- Public avatars were private-only previously; new opt-in is explicit and never
  changes Storage drive visibility or publishes existing images.
- Managers can withdraw/suspend a retained author without first reactivating a
  suspended account. Self edits remain restricted to active eligible authors.
- Profile/author input is closed, bounded and CAS-checked; sparse/accessor social
  arrays are rejected without executing callbacks.
- Final authority failure rolls back the author and its Guardian audit event.
- SDK retirement cancels even a custom SSE reader whose transport ignores abort;
  late account/org results cannot be delivered to a replacement view.
- Doctor distinguishes missing publication/author schema and pending policy
  without mutating a database, provisioning media or enrolling users.
- An outdated property guide claiming Guardian had no avatar feature was
  corrected to link the current dedicated owners.
- Enabling the optional account-author facade no longer intercepts unrelated
  admitted API-key routes during service projection.
- The actual managed pipeline with dedicated Logging workers exposed a Bun
  native-reader lock-release failure after valid photo bytes were exhausted.
  Storage now treats only that final cleanup as best effort, preserving both
  accepted bytes and original read failures; provider/content checks are unchanged.

## Evidence Discipline

Tests use synthetic identities, isolated in-memory/file-backed databases and
local Storage/loopback services only. No real application files, public theme,
live credentials, databases or providers are changed. The managed upgrade
regression checks real credential rows, not a sanitized user projection that
does not contain a password hash. New migration snapshots are additive and do
not modify prior definitions/checksums.

Detailed final source/package results will be recorded here after the frozen
candidate has been checked. The retained earlier UI archive keeps its original
hash and does not qualify these new backend APIs.
