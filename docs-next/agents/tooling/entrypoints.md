---
id: zero.agents.tooling.entrypoints
type: reference
audience: [developer, agent, maintainer]
owner: agent-tooling
status: draft
visibility: internal
system: agent-tooling
feature: entrypoints
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

# Existing Agent Entry Files

[Tooling index](./index.md) · [Documentation index](../../index.md)

The compatibility entry file llm.txt points readers at the comprehensive llms.txt
bundle. These are shipped knowledge files, not commands, runtime agents or
policy-enforcement mechanisms. They do not automatically execute a browser,
Doctor, migration, deployment or code generator.

Use a file as orientation, then verify the exact installed public contract in
the owning feature manual/source. The long bundle contains repeated summaries
and historical plans; it must not override current APIs or user instructions.

This source baseline has no committed project AGENTS.md or CLAUDE.md and no
Codex/Claude/Cursor hook/skill installation. An ancestor/global instruction file
may govern an individual workspace, but is not a Zero package capability.

## Task Routing

- App composition → [runtime](../../backend/runtime/index.md).
- Shared declarations → [Schema](../../backend/schema/index.md).
- Auth/tenancy/permissions → [Guardian](../../backend/guardian/index.md).
- Physical database placement → [Fabric](../../backend/fabric/index.md).
- UI/client interaction → [frontend](../../frontend/index.md).
- Workflow execution → [Torrent](../../backend/torrent/index.md).
- Provider/model/tools → [AI](../../backend/ai/index.md).

[Onboarding](./onboarding.md) supplies a compact sequence.
[Knowledge bundle](./knowledge-bundle.md) explains version/drift handling.
Future active instruction-file work is [planned](./roadmap.md), not performed
by reading this page.
