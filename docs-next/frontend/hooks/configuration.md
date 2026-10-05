---
id: zero.frontend.hooks.configuration
type: reference
audience: [developer, agent]
owner: frontend-hooks
status: draft
visibility: internal
system: frontend-components
feature: generic-configuration
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Generic Hook Configuration

[Hooks index](./index.md) · [Documentation index](../../index.md)

Generic hook options are React/runtime arguments, not createApp/environment/Doctor
settings. They do not require an integrated client for local state/DOM/timers.
The separate confirmation hook requires ConfirmProvider; SDK/forms/domain hooks
retain their own context requirements.

Read exact defaults at [state/actions](./state-and-actions.md),
[timing](./timing.md) and [browser interactions](./browser-interactions.md).
A controlled value/open remains parent-owned. Default values initialize local
state; they are not automatic resets on each render.

SSR-safe means no browser subscription during server rendering and an appropriate
fallback—not that calling event-side-effect functions on the server is sensible.
Explicit immediate browser initialization can cause hydration divergence; opt in
deliberately. Refs must attach to the intended element. Timers/observers follow
component lifetime, not service shutdown or durable workflow state.

Use stable IDs/names and scoped SDK actions when delayed work has authority.
Generic stable-latest callbacks do not preserve an old scope's authorization.
Do not use UI throttle/idle as backend limits/logout policy.

## Related Guides And Next Steps

- [State/actions](./state-and-actions.md) owns local facets/results.
- [Timing](./timing.md) owns timer options.
- [Browser interactions](./browser-interactions.md) owns DOM/SSR choices.
- [Confirmation](./confirmation.md) owns its provider/options.
