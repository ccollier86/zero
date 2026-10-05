---
id: zero.kv.roadmap
type: roadmap
audience: [developer, agent, operator]
owner: kv
status: draft
visibility: internal
system: kv
feature: future-direction
maturity: planned
applies_to: ["2.1.1 source; new documentation under review"]
modes: [managed-server, standalone-server]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# KV Roadmap

[KV index](./index.md) · [Documentation index](../../index.md)

No new distributed-cache or full Redis feature commitment was established.
Public kind names do not prove hash/set/list/lease APIs are implemented.

- [ ] Keep atomicity/durability regressions qualified against exact releases.
- [ ] Evaluate future data-type methods only with explicit value, mutation and recovery contracts.
- [ ] Consider operational diagnostics without exposing raw keys/values.

No schedule or current missing-feature workaround is implied.
[Operations](./operations.md), [concurrency](./concurrency.md) and
[configuration](./configuration.md) describe the implemented service.
