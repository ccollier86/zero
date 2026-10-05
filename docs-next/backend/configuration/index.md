---
id: zero.configuration.overview
type: index
audience: [developer, agent, operator]
owner: platform-configuration
status: draft
visibility: internal
system: platform-configuration
feature: overview
maturity: supported
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

# Configure One Integrated App

[Backend index](../index.md) · [Documentation index](../../index.md)

Zero configuration is trusted typed TypeScript, consumed by `createApp`.
Declare modes and services centrally, organize ordinary imported modules as
needed, and use each subsystem's exact resolver rules. There is no universal
“object means enabled,” “config always wins,” or “null means off” convention.

## Declare And Understand

- [Declaration](./declaration.md): literal inference, ordinary module organization and a minimal entry point.
- [Resolution](./resolution.md): read times, precedence and the distinction between normalized configuration and a ready service.
- [Configuration reference](./configuration.md): top-level options, defaults and owning detailed contracts.
- [Feature switches](./feature-switches.md): supported enable/disable forms and dependency gates.
- [App identity](./app-identity.md): name, public URL and support address without secrets or permission side effects.

## Data, Navigation And Operations

- [Data modes](./data-modes.md): application/system separation and optional Fabric topology.
- [Data access and loading](./data-access.md): Resource/Sync policy and full/lazy/auto settings.
- [Routing](./routing.md): protected pages, safe return targets and authenticated login redirection.
- [Directories](./directories.md): trusted module discovery, generated/build output and listener port.
- [Sitemap](./sitemap.md): public static route discovery and deliberate dynamic entries.
- [Diagnostics](./diagnostics.md): trusted config loading and indexed-field hints for Doctor.
- [Roadmap](./roadmap.md): proposed ergonomics, not an implemented settings control plane.

## Philosophy

The inspected design favors explicit declarations, typed subsystem boundaries
and one app-local composition owner. Module splitting is an ordinary TypeScript
organizational technique, not a second untyped configuration language.
Configuration chooses capabilities; live Guardian/service policies still decide
whether a caller may use them. These are inferred architectural principles,
not a claim that every arbitrary object can be safely serialized to the client.
