---
id: zero.cli.tooling.roadmap
type: roadmap
audience: [developer, agent, operator]
owner: cli-tooling
status: draft
visibility: internal
system: cli-tooling
feature: roadmap
maturity: supported
applies_to: ["2.1.1 source; publication qualification pending"]
modes: ["Bun package-mode applications", "trusted local development"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Tooling Roadmap

[Tooling index](./index.md) · [Documentation index](../../index.md)

These are future-facing ideas, not shipped commands or promised dates.

- [ ] User-requested cleaner declarative configuration organization and startup/server-only choices.
- [ ] Capability/documentation discovery for coding agents, validated against exact installed exports.
- [ ] More explicit CI/deployment lifecycle tooling and app-release workflows.
- [ ] Improved developer/agent onboarding and version-aware documentation.
- [ ] Evaluate focused config scaffolding helpers; no current init-config/config-dir command exists.

Saved committed archives, safe package updating, source copying and Doctor are
already implemented; future work extends those contracts rather than describing
them as absent foundations. Platform deployment management would be a distinct
product/authorized scope.

See [agent tooling plans](../../agents/tooling/roadmap.md),
[current command configuration](./configuration.md) and
[release operations](./releases.md).
