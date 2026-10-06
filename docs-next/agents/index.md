---
id: zero.agents
type: index
audience: [developer, agent, maintainer]
owner: agent-tooling
status: draft
visibility: internal
system: agent-tooling
feature: agents
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

# Build With Zero As A Coding Agent

[Documentation index](../index.md)

Zero is a declarative full-stack platform for fast app development. The useful
agent behavior is to discover and compose its existing contracts, not rebuild
authentication, realtime transport, controls or provider integration beside
them.

[Tooling and onboarding](./tooling/index.md) explains the existing files,
package-local references, command boundaries and focused verification.
This section is developer-agent guidance; application AI agents belong to
[Zero AI](../backend/ai/agents.md) and durable execution belongs to
[Torrent](../backend/torrent/index.md).

This is the primary coding-agent guidance entrance. It does not install AGENTS.md, Codex/
Claude hooks, skills or an MCP server into applications. Preserve the user's
actual repository instructions and app-owned work.
