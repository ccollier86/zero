---
id: zero.agents.tooling.configuration
type: reference
audience: [developer, agent, maintainer]
owner: agent-tooling
status: draft
visibility: internal
system: agent-tooling
feature: configuration
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

# Agent Tooling Has No Hidden Runtime Configuration

[Tooling index](./index.md) · [Documentation index](../../index.md)

Zero currently exposes no coding-agent configDir/init-config command, instruction
autodiscovery API, live capability-query service, MCP setup or agent settings DB.
Writing these guides does not install executable instructions.

Existing configurable development surfaces are:

- [CLI invocation options](../../cli/tooling/configuration.md): project/source/template/update selection.
- [Doctor policy](../../cli/doctor/configuration.md): strict/env/source roots/rule severities/allow entries.
- [Local launcher installation](../../cli/tooling/configuration.md#saved-launcher-installation): bin/library/archive/scratch paths.
- App-owned scripts, repository instructions and external agent-client settings: their own trust/authorization, not Zero runtime options.

This differs from [application AI configuration](../../backend/ai/configuration.md)
and [Guardian](../../backend/guardian/configuration.md), which control runtime
services and authority. Never use a coding-agent convention to bypass those
backend controls.

For an app task, record exact package version/provenance, relevant mode choices
and scoped verification plan in ordinary project work. Do not introduce a new
agent config file/API as if Zero already consumes it. Future configuration
organization is [roadmap](./roadmap.md) work.
