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
applies_to: ["2.6.0 working source; publication qualification pending"]
modes: ["React browser UI", "SSR markup", "managed frontend styling"]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-10"
  evidence_level: source-observed
---

# Compose Reusable Tokenized Controls

[Design-system index](./index.md) · [Documentation index](../../index.md)

Use the platform component's public props/slots before replacing its UI.
Controls already share semantic tokens, sizing, focus states and relevant
interaction behavior. Source-local Animate UI exports do not automatically
become public component paths.

## Family Ownership And Public Facades

Keep a component's composition, specific types/model, motion/presentation,
styles and tests under an identifiable family owner. Share mechanism only where
multiple families actually consume it; rendering must not absorb SDK transport,
query authority or persistence. A family can expose small composable parts and
a standardized assembled component through the same curated facade.

The [source organization guide](../components/source-organization.md) locates
the implemented Card/Select, date/time, Popover and shared mechanism owners;
the [roadmap](../../_work/frontend-component-organization-plan.md) stages larger
engines and client families. This is not a new supported import scheme. Physical
moves must preserve public exports, context/provider identity, source-copy IDs
and destinations, CSS/helper closure and consumer prop/ref semantics. Existing
forwarding modules are compatibility boundaries, not duplicate implementations
to remove by filename.

Use supported package facades in application code; `#zero` imports remain
private. Do not expose internal helpers/tests merely by adding a wildcard.
Theme tokens remain with the design-system owner. Follow the
[theme retirement checklist](./foundation-next.md#retire-the-original-theme-safely)
before removing original files; folder organization does not retire their values
or shared stylesheet infrastructure.

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
