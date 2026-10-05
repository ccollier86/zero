---
id: zero.agents.tooling
type: index
audience: [developer, agent, maintainer]
owner: agent-tooling
status: draft
visibility: internal
system: agent-tooling
feature: tooling
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

# Coding-Agent Orientation And Tooling

[Agent index](../index.md) · [Documentation index](../../index.md)

This family routes a coding agent to the real package contracts and existing
tools. It is not a runtime AI agent service or a tool installation manifest.

## Read In Task Order

1. [Onboarding](./onboarding.md): identify the installed version/modes and plan integrated app work.
2. [Package discovery](./package-discovery.md): public exports, local docs and version evidence.
3. [Building conventions](./building-conventions.md): use-first services/components/authority.
4. [CLI workflows](./cli-workflows.md): create versus copy versus update.
5. [Verification](./verification.md): scoped checks and execution trust boundaries.

Reference pages: [entrypoints](./entrypoints.md),
[knowledge bundle](./knowledge-bundle.md),
[configuration](./configuration.md), and
[release hooks](./release-hooks.md).
[Roadmap](./roadmap.md) distinguishes compact routing, catalogs, hooks and MCP
proposals from current tools.

## Existing Versus Planned

Committed source includes llm.txt, llms.txt, engineering/bootstrap docs and
package CLI/Doctor integrations. This baseline does not contain a project
AGENTS.md/CLAUDE.md, committed Codex/Claude/Cursor instruction configuration,
SKILL.md package or coding-agent MCP/hook server. External/global tools are
outside that repository statement.

The inferred product principle is agent-first and human-clear: declarations
make capabilities discoverable, while explicit public imports, authority,
lifecycle and accepted mutation receipts keep the result understandable.
Correct documentation is a product interface, not a substitute for tests.
