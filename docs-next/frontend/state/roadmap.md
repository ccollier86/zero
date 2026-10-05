---
id: zero.frontend.state.roadmap
type: roadmap
audience: [developer, agent]
owner: sync
status: draft
visibility: internal
system: sync
feature: frontend-roadmap
maturity: supported
applies_to: ["2.1.1 source; package qualification pending"]
modes: [browser, SSR, Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# State Convenience Roadmap

[State index](./index.md) · [Documentation index](../../index.md)

Known future ideas include a reusable non-disruptive form/editor autosave layer,
better draft restoration UX and broader collaboration components.
These are ideas requiring explicit lifecycle/accepted write/conflict design.

Current durable user state, preferences, explicit form drafts and ephemeral
topics already exist. They are not a new universal autosave guarantee, arbitrary
public bus or durable Torrent memory service.

## Related Guides And Next Steps

- [Drafts](./form-drafts.md) documents current explicit helpers.
- [Ephemeral](./ephemeral.md) documents collaboration scope.
- [Forms](../forms/index.md) owns normal validation/submission.
