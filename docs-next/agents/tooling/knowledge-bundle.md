---
id: zero.agents.tooling.knowledge-bundle
type: reference
audience: [developer, agent, maintainer]
owner: agent-tooling
status: draft
visibility: internal
system: agent-tooling
feature: knowledge-bundle
maturity: supported
applies_to: ["2.1.1 source; publication qualification pending"]
modes: ["coding-agent application development", "installed-package discovery"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Use The Comprehensive Bundle Without Mistaking It For Authority

[Tooling index](./index.md) · [Documentation index](../../index.md)

llms.txt is the existing comprehensive agent-readable Zero bundle. It repeats
orientation, engineering rules, imports and examples across systems. It can help
discover vocabulary but is not a generated live export/capability catalog.

## Source And Version Discipline

Read package provenance first. A bundle from another branch/release can describe
different auth/DB/workflow contracts. Resolve disagreement using the installed
public export and owning canonical feature guide. Do not import framework
internals because an old bundle mentions a source filename.

Two audited drift examples explain the need:

- Application migration inspection requires an explicit --db alongside --schema;
  old bundle examples omitted it.
- Usage audit exists; historical “planned checks” language does not mean
  current Doctor has no source diagnostics.

The isolated rebuild does not overwrite the existing bundle or package entries.
Publication will need a deliberate versioned projection, not a wholesale copy
of docs-next and its internal audit material.

## Efficient Context Loading

Load the compact [task orientation](./onboarding.md), then only the owning
system/configuration guides and public signatures needed for the task. Keep
broader bundle loading optional. This is a reading recommendation, not an
installed automatic retrieval feature.

[Package discovery](./package-discovery.md) covers export checks;
[verification](./verification.md) covers tests; [roadmap](./roadmap.md) covers
future metadata-driven routing/bundling.
