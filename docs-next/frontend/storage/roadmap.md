---
id: zero.frontend.storage.roadmap
type: roadmap
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: roadmap
maturity: planned
applies_to: ["2.1.1 development source; not package-qualified"]
modes: [single-tenant, multi-tenant, guardian-enabled, storage-enabled]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Storage UI Roadmap

[Storage UI index](./index.md) · [Documentation index](../../index.md)

This roadmap records prospective improvements and explicit user ideas. It is not a statement that the controls/API already exist.

## Known Direction

- [ ] Keep a unified compact toolbar/list/inspector/action-bar experience across Storage, Data Studio and Guardian.
- [ ] Improve reusable drive/file management with modern preview/details/access panels and inline edits.
- [ ] Explore stronger provider-level physical isolation and additional adapters while keeping logical UI capabilities honest.
- [ ] Consider richer Finder-style browsing as a plugin rather than treating the current component as a full desktop file manager.

The current native Studio, ACL editors, uploads, logical drive lifecycle and previews are implemented contracts documented in the [family index](./index.md). Future work should extend these public surfaces without making every app rebuild transport/authorization.

## Ideas Requiring Design And Verification

- [ ] Continuous scoped lifecycle progress/invalidation UI; current job reads are bounded snapshots, not a push subscription.
- [ ] Explicit multi-producer upload orchestration and resumable provider uploads, separate from the local sequential queue.
- [ ] More file preview/editor integrations without executing untrusted stored markup or leaking signed URLs.
- [ ] More metadata editing affordances where appropriate; current native inspector edits existing keys.

These are ideas, not promised release scope. Confirm desired UX/security/provider constraints before implementation. A production app must not assume stronger byte isolation, durable upload resume or grant semantics based only on these plans.

## Documentation And Release Gates

- [ ] Independently review the full UI/hook family against actual public barrels and current source.
- [ ] Compile illustrative examples against the approved exact package/artifact.
- [ ] Validate real UI interaction/accessibility/responsive behavior across the selected browser matrix.
- [ ] Run scoped integration tasks for single/multi organization modes without private service shortcuts.

Confirmed defects belong in the internal findings/fix process, not as permanent roadmap limitations. These drafts retain source-observed evidence until release qualification is complete.

[Family index](./index.md) · [Configuration](./configuration.md) · [Backend Storage roadmap](../../backend/storage/roadmap.md)
