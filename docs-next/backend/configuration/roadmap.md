---
id: zero.configuration.roadmap
type: roadmap
audience: [developer, agent, operator]
owner: platform-configuration
status: draft
visibility: internal
system: platform-configuration
feature: roadmap
maturity: planned
applies_to: ["2.1.1 source; new documentation under review"]
modes: [managed-server]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Configuration Roadmap

[Configuration index](./index.md) · [Documentation index](../../index.md)

These are known user proposals and design directions, not current
settings or an implementation commitment. Existing contracts remain in the
[configuration reference](./configuration.md).

## Known Directions

- [ ] Organize app declarations into focused configuration modules with a compact central entrance.
- [ ] Improve effective-setting discovery for agents, including value origin, safe defaults and feature links.
- [ ] Offer deliberate server-only bootstrap/scaffolding without pretending every app needs a React shell.
- [ ] Explore environment and database-backed AI/provider settings as independently reviewed modes.
- [ ] Improve mode-aware upgrade diagnostics and clearer migration planning.

Ordinary TypeScript module organization already works; a future helper should
improve it without introducing an opaque merge order or exposing secrets to the
client. Database-backed settings and central model/pricing catalogs are ideas,
not shipped tables or APIs.

## Design Constraints

Preserve exact versioned public contracts and subsystem-specific precedence.
Keep secret origins separate from public effective configuration. Diagnostics
must not require exporting provider keys, tenant identifiers or private records.
Avoid a second source of truth that disagrees with app startup/Doctor.

Any new configuration loader should clearly distinguish parsing from executing
trusted modules. Any live setting should define validation, authority, reload
behavior and operational failure before a UI suggests changes apply instantly.

## Related Guides And Next Steps

- [Declaration](./declaration.md) is the supported module composition pattern.
- [Resolution](./resolution.md) owns existing read-time and precedence behavior.
- [Diagnostics](./diagnostics.md) distinguishes safe checks from executable app imports.
