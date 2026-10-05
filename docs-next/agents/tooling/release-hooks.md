---
id: zero.agents.tooling.release-hooks
type: operations
audience: [developer, agent, maintainer]
owner: agent-tooling
status: draft
visibility: internal
system: agent-tooling
feature: release-hooks
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

# Existing Git Hooks Are Package Refresh Hooks

[Tooling index](./index.md) · [Documentation index](../../index.md)

Local launcher installation may create repository post-commit/post-merge hooks.
They refresh the saved committed **main** archive and report failures while
retaining the prior selection. They do not run Doctor after every agent action,
intercept a coding-agent request, enforce review rules, or act as an MCP server.

Existing unrelated hooks and custom core.hooksPath are preserved. Integration
with custom hook routing requires deliberate owner changes; the installer only
prints guidance. The hooks reside in repository/workstation state, not ordinary
application runtime config.

Explicit zero-release [branch] selects another exact local branch.
Feature checkouts do not automatically replace stable; a later main hook may
select main again. Before automated zero-new/zero-update, read the active
provenance to avoid consuming an unintended release.

Failure does not prove a commit/deployment was rolled back; saved selection
retention is a separate boundary. Follow [release operations](../../cli/tooling/releases.md)
and [installation paths](../../cli/tooling/local-install.md).
Future agent lifecycle hooks are [roadmap](./roadmap.md) work.
