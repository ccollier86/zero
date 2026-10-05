---
id: zero.doctor.roadmap
type: roadmap
audience: [developer, agent, operator]
owner: doctor
status: draft
visibility: internal
system: doctor
feature: roadmap
maturity: supported
applies_to: ["2.1.1 source; publication qualification pending"]
modes: ["configuration values", "trusted CLI modules", "explicit infrastructure snapshots"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Doctor Roadmap

[Doctor index](./index.md) · [Documentation index](../../index.md)

Current Doctor already includes domain configuration checks, source usage rules,
system/app-plane inspection and explicit automation health/fingerprint checks.
It is not only a future foundation.

Future ideas, not current APIs:

- [ ] Source-verified capability discovery and compact coding-agent routing.
- [ ] More representative installed-package/mode verification recipes.
- [ ] Clearer machine-consumable documentation destinations for stable findings.
- [ ] Evaluate additional focused configuration organization checks as those features exist.

Automatic repair, security certification, MCP discovery and agent lifecycle
hooks are not shipped by this checker. Confirmed defects are corrected with
focused tests rather than becoming roadmap caveats. See
[current source rules](./source-audit.md),
[agent plans](../../agents/tooling/roadmap.md) and
[tooling roadmap](../tooling/roadmap.md).
