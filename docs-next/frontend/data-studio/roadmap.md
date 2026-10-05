---
id: zero.frontend.data-studio.roadmap
type: roadmap
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: roadmap
maturity: supported
applies_to: ["2.1.1 source; package qualification pending"]
modes: [browser, SSR, Guardian multi, Fabric tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Data Studio UI Roadmap

[Data Studio index](./index.md) · [Documentation index](../../index.md)

These are future-facing ideas, not enabled capabilities or release commitments.

- [x] Source implementation of the requested schema-first grid, contextual
  column edits, progressive bounded loading, optional inspector, anchored action
  bar and Visual/JSON schema dialog. Focused browser regressions use compiled
  Zero styles; installed-package qualification/publication remains a separate gate.
- [ ] Add a general-purpose code editor later. The current JSON mode deliberately
  uses the selected `json-edit-react` component, not a partial homemade IDE.
- [ ] Broader reusable data-admin tooling and app-level Studio compositions.
- [ ] More polished saved views and schema authoring ergonomics if justified by
  production use; current controller query state is not a persisted view service.
- [ ] Better task onboarding for developers/agents using organization logical
  tables with functions/workflows.

Current table creation, revisions, scalar filters, inline editing and inspection
are implemented contracts documented in this family, not roadmap substitutes.
Any additional server capabilities need their own authority/admission tests.

## Related Guides And Next Steps

- [Workspace](./workspace.md) describes current composition.
- [Configuration](./configuration.md) distinguishes UI and service settings.
- [Data controls roadmap](../data-controls/roadmap.md) holds adjacent UI ideas.
