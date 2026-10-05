---
id: zero.design-system.component-conventions
type: architecture
audience: [developer, agent, operator]
owner: design-system
status: draft
visibility: internal
system: design-system
feature: component-conventions
maturity: supported
applies_to: ["2.1.1 source; publication qualification pending"]
modes: ["React browser UI", "SSR markup", "managed frontend styling"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Compose Reusable Tokenized Controls

[Design-system index](./index.md) · [Documentation index](../../index.md)

Use the platform component's public props/slots before replacing its UI.
Controls already share semantic tokens, sizing, focus states and relevant
interaction behavior. Source-local Animate UI exports do not automatically
become public component paths.

## Buttons And Actions

Button/ButtonProps/buttonVariants are public root/react APIs. Variant choices
are default/destructive/outline/secondary/ghost/link; size choices are default/
xs/sm/lg/icon/icon-xs/icon-sm/icon-lg. Defaults default/default, asChild=false,
animateIcon=true. Button normally wraps hover/tap icon context; animateIcon=false
disables that wrapper. asChild delegates element semantics, so the child must
retain correct focus/type/disabled behavior.

Use destructive styling for genuinely destructive actions, explanatory labels
for icon-only controls, and pending/duplicate-click handling through the owning
mutation/action contract. Button appearance does not await a server write by
itself.

## Dense Control Planes

[Data controls](../data-controls/index.md) supply shared query/search/filter/
pagination/action composition, including extension slots.
[Forms](../forms/index.md) supply accepted validation/submission behavior.
[Modals](../modals/index.md) own overlays/confirmation lifecycle.
[Guardian UI](../guardian/index.md) adapts roles/modes/permission presentation.

Keep information/options in coherent detail panels and common actions in the
action bar/slots rather than disconnected giant cards. Each specific component
manual owns exact layout/options; this page does not invent universal slot names.

Token families support both [application/public lanes](./lanes.md).
Do not reach inside rendered controls with brittle CSS selectors when a declared
sizing/wrapping/slot API exists. If source customization is genuinely needed,
[zero add](../../cli/tooling/add.md) makes ownership explicit.

## Errors And Related Guides

Server/domain services still enforce Guardian authority. Use established safe
observability/error presentation; showing a toast is not a receipt. See
[external feedback surfaces](./external-surfaces.md),
[tokens](./tokens.md) and [runtime providers](../runtime/index.md).
