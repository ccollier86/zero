---
id: zero.frontend.overlays.tooltip
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: tooltip
maturity: supported
applies_to: ["2.6.0 source; Tooltip Motion Kit upgrade unreleased"]
modes: ["React browser UI", "SSR composition", "standalone or grouped hints"]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "59cb76dc12d18a9428a616b08509cae1eecdf74d"
  snapshot: dirty
  date: "2026-10-08"
  evidence_level: source-observed
---

# Tooltips And Shared Tooltip Groups

[Overlays index](./index.md) · [Documentation index](../../../index.md)

Use a tooltip for a short, noninteractive description of an existing control.
The trigger already needs a useful accessible name: a tooltip supplements that
name rather than being the only way to discover the action. Use
[Popover](./popover.md) for inputs, links, menus or other interactive content.

The public import is @zero/framework/components/tooltip, not root/react.
It provides TooltipProvider, TooltipGroup, Tooltip, TooltipTrigger,
TooltipContent and their matching Props types. This guide describes the
unreleased working-source upgrade; an older installed package may expose only
Tooltip/Trigger/Content with the earlier zero-delay appearance.

## Minimal Composition

A standalone Tooltip works without an explicit provider. Wrap related controls
in TooltipProvider to share timing and presentation defaults.

~~~tsx
import { Button } from "@zero/framework/react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@zero/framework/components/tooltip";
import "@zero/framework/styles.css";

export function HelpControl() {
  return <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label="Help with exports" variant="outline">?</Button>
      </TooltipTrigger>
      <TooltipContent>Exports include the current filtered records.</TooltipContent>
    </Tooltip>
  </TooltipProvider>;
}
~~~

TooltipTrigger's asChild uses the actual button/link as the trigger; it does not
add another interactive element around it. Preserve the child's ref and normal
event handling. Disabled controls need an intentionally accessible, focusable
description target when users must discover why they are disabled.

## Interaction And Dismissal

The normal first pointer hover waits **450ms**. After a recent tooltip interaction,
the same provider's **450ms warm window** permits nearby hints to open without
repeating that delay. Pointer departure uses a **70ms close grace** before the
exit starts. These are interaction delays, not animation durations.

Keyboard focus-visible opens the description immediately. Mouse activation
dismisses it; the focus caused by clicking must not reopen a hint that stays
pinned until the next click. Leaving and hovering the trigger again can open
it normally. Escape closes the active hint, and blur/owner retirement removes
its description ownership. A tooltip does not trap focus or move it away from
the underlying control.

open/defaultOpen/onOpenChange remain available for app-owned state. A controlled
owner must apply close requests in onOpenChange; deliberately keeping open=true
is not the ordinary hover lifecycle.

Collapsed desktop [Sidebar menu buttons](./sidebar-menu.md) keep their narrower
policy: hover-only hints, no opening from keyboard focus alone, and click
suppression until pointer departure. Expanded/mobile sidebars suppress those
hints. That sidebar policy does not remove normal keyboard descriptions from
ordinary public tooltips.

## Rich Descriptions And Keyboard Hints

TooltipContent accepts optional title, description and shortcut slots. A shortcut
string splits on whitespace; an array explicitly supplies individual keys. An app
may also supply a noninteractive React node. The styled slot uses the existing
[Kbd component](../kbd.md), inheriting tooltip colors and tokens.

~~~tsx
import { Button } from "@zero/framework/react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@zero/framework/components/tooltip";

export function CommandHint() {
  return <Tooltip arrow={false} variant="accent">
    <TooltipTrigger asChild><Button aria-label="Open command menu">Commands</Button></TooltipTrigger>
    <TooltipContent title="Command menu" description="Find actions without leaving the keyboard." shortcut={["⌘", "K"]} />
  </Tooltip>;
}
~~~

Plain children remain supported. When content is omitted, the tooltip can reveal
the trigger's full text, which is useful with overflowOnly. Rich text is still
descriptive content, not a miniature modal or an interactive settings panel.
Critical validation, required instructions and security decisions must remain
visible outside a tooltip.

## Shared Groups And Morphing

TooltipProvider shares defaults and warm-up behavior, but independent tooltips
keep independent bubbles. TooltipGroup additionally owns **one physical floating
bubble** for its participating Tooltip compounds. Moving between triggers morphs
that bubble's position, size and arrow while replacing descriptive content.
The group uses the existing Floating UI engine; application code does not create
a second manager or import its internal provider.

~~~tsx
import { Button } from "@zero/framework/react";
import { Tooltip, TooltipContent, TooltipGroup, TooltipTrigger } from "@zero/framework/components/tooltip";

export function ToolbarHints() {
  return <TooltipGroup motion="grow" arrow durationMultiplier={1}>
    <div className="flex gap-2">
      <Tooltip>
        <TooltipTrigger asChild><Button aria-label="Create record">New</Button></TooltipTrigger>
        <TooltipContent title="Create record" shortcut="N" />
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild><Button aria-label="Search records">Search</Button></TooltipTrigger>
        <TooltipContent title="Search records" description="Search names and descriptions." shortcut={["⌘", "F"]} />
      </Tooltip>
    </div>
  </TooltipGroup>;
}
~~~

A group's trigger change uses a **420ms** bubble/arrow morph. Old text exits over
**160ms** with an 8px directional shift and 2px blur; incoming text uses **300ms**,
an **80ms** delay and a 10px directional shift. Rapid changes continue from the
current visual pose rather than finishing an obsolete target first. The group
does not create duplicate interactive tooltip hosts or transfer focus between
its triggers.

## Provider, Root And Content Options

Presentation settings resolve from inherited theme tokens/provider defaults,
then the individual Tooltip, then TooltipContent overrides. Explicit local
settings override inherited defaults. There are no tooltip environment variables,
backend permission tables or feature migrations.

| Option | Default / contract |
| --- | --- |
| motion | grow; grow/spring/blur/swing |
| durationMultiplier | 1; finite .5–2.5 duration multiplier, not a velocity multiplier |
| arrow | true; false removes the decorative arrow and uses the smaller gap |
| variant | neutral; neutral/accent/light use active theme aliases |
| delayDuration | 450ms pointer opening delay; provider/root timing option |
| skipDelayDuration | 450ms warm window; provider/group option |
| closeDelay | 70ms pointer-departure grace; provider/group option |
| disableHoverableContent | true on the standalone provider; false explicitly allows Radix's hoverable-content behavior |
| open/defaultOpen/onOpenChange | Controlled/local root visibility |
| followCursor | false; true/x/y opts into standalone cursor-follow translation; grouped cursor personality uses Swing |
| overflowOnly | false; open only when the actual trigger's content overflows |
| title/description/shortcut | Optional noninteractive content slots |
| container | Optional app-owned HTMLElement portal target on TooltipContent |

The content keeps preferred side top/right/bottom/left, align start/center/end,
side/align offsets and collision options. Placement is a preference: the
positioning engine can flip/shift after measuring the boundary. Keep collision
handling enabled unless the application deliberately owns that responsibility.
The ordinary viewport inset is 8px. The arrow is 9px, with a 9px gap when present
and a 6px gap when omitted.

Normal text uses a 260px maximum width constrained to the viewport and wraps
long words. The mono presentation token supports a wider 420px cap. The body is
also capped to the available height and a 20rem theme limit, without clipping
the arrow. Choose Popover when content needs deliberate scrolling, extended
reading or interaction; disableHoverableContent=false is an explicit hoverable
description option, not a substitute for an interactive panel. Width,
font, radius, padding, shadow, semantic colors, arrow geometry, effect amounts
and timing are --zero-tooltip-* design tokens, not copied reference colors.
Use the shared theme and supported props before application-specific selectors.

## Motion Presets And Pace

~~~tsx
import { Button } from "@zero/framework/react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@zero/framework/components/tooltip";

export function SofterHints() {
  return <TooltipProvider motion="spring" durationMultiplier={1.5} arrow variant="neutral">
    <Tooltip>
      <TooltipTrigger asChild><Button aria-label="Preview record">Preview</Button></TooltipTrigger>
      <TooltipContent>Preview before applying the change.</TooltipContent>
    </Tooltip>
    <Tooltip motion="grow" durationMultiplier={1}>
      <TooltipTrigger asChild><Button aria-label="Apply change">Apply</Button></TooltipTrigger>
      <TooltipContent>Local settings override the provider pace.</TooltipContent>
    </Tooltip>
  </TooltipProvider>;
}
~~~

The exact unscaled Motion Kit durations are:

| Motion | Entrance | Independent fade | Exit | Behavior |
| --- | --- | --- | --- | --- |
| Grow | 400ms | 200ms | 200ms | Scale 0→1 from the resolved arrow-tip origin; exit opacity holds through 55% before fading |
| Spring | 750ms | 220ms | 200ms | Scale .7→1 using the supplied sampled spring; exit scale .92 |
| Blur | 500ms | Included in 500ms | 220ms | 8px side-aware nudge, scale .96 and blur8→0; exit blur6 |
| Swing | 620ms | 200ms | 220ms | Side-aware 14px shift and scale .6 with sampled bounce; optional cursor sway |

Grow/morph use cubic-bezier(.2,0,0,1); Grow/Swing exits use
cubic-bezier(.4,0,1,1); Blur uses cubic-bezier(.16,1,.3,1).
Spring/Swing preserve the supplied sampled linear() curves, with the defined
cubic-bezier capability fallbacks only when sampled curves are unsupported.

durationMultiplier scales presentation duration: 1.5 makes a 400ms Grow entrance
600ms. It does not change pointer activation/warm/grace delays. Reduced motion
settles presentation effects to about 1ms, suppressing travel, blur/overshoot and
cursor sway while keeping the same state and interaction policy. Changes to
the live reduced-motion preference must not strand exit paint or old timers.

## Overflow And Cursor Tracking

~~~tsx
import { Button } from "@zero/framework/react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@zero/framework/components/tooltip";

export function TruncatedRecord() {
  return <Tooltip overflowOnly>
    <TooltipTrigger asChild>
      <Button className="max-w-40 truncate" aria-label="Synthetic long record name">
        Synthetic long record name
      </Button>
    </TooltipTrigger>
    <TooltipContent />
  </Tooltip>;
}
~~~

overflowOnly measures the real trigger instead of assuming every shortened label
is truncated. A fitting value should not open an unnecessary hint. An omitted
content value uses the trigger's full descriptive text; it does not fetch a
record or expand application permissions.

Standalone followCursor is opt-in. Grouped hints keep one morphing anchor surface
rather than applying that legacy translation; TooltipGroup rejects followCursor.
Choose an ordinary Tooltip for translation or motion="swing" for grouped cursor
personality. Swing's cursor physics use the tuned stiffness100,
damping7 and bounded ±18° rotation/±16px drift; timers/frames stop on dismissal
or owner retirement. Prefer stationary descriptions for normal keyboard and
accessibility use. Cursor tracking is not a reason to bypass collision handling.

## Modal Ownership, Portals And Theme

Inside a managed [modal](../../modals/index.md), tooltips retain the owner's
portal container, layer and theme context. Their layer sits above the owning
dialog; an inactive/retired owner cannot leave an active hint behind. Escape
first dismisses the owned hint, not the containing modal as well.

Scoped platform/public and light/dark tokens follow the initiating surface
through portals, including a public-lane change without a simultaneous dark-mode
class change. Avoid local z-index guesses or a second document-level Escape
listener. An app-owned portal container must remain outside transformed or
clipping surfaces and respect the owning overlay boundary. Containers must use
the trigger's document: iframe/cross-document targets are rejected, and the
HTMLElement option does not provide ShadowRoot rendering or styling support.

SSR composition does not open a floating description or measure layout. Browser
qualification remains separate from import/SSR/type checks: verify keyboard
focus, mouse click dismissal, Escape ownership, collision boundaries, live theme,
reduced preference and unmount cleanup in your actual composition. A static
Doctor scan is not a screen-reader or visual certification.

## Upgrade Compatibility

Existing Tooltip/Trigger/Content composition remains the ordinary entry point;
no source-local Animate/Floating UI import is required. The public provider and
group are additions. The upgrade deliberately changes defaults from the earlier
immediate accent/spring hint to the approved delayed neutral Grow appearance.
Use explicit delayDuration=0, variant="accent" or a chosen motion when that
application contract must differ; do not reinstate click-pinned descriptions.

The old transition prop remains accepted for source compatibility, but does not
replace the tuned Motion Kit. Select motion/durationMultiplier or change the
documented theme tokens rather than substituting an unrelated library spring.

## Verification And Related Guides

The [implementation and qualification plan](../../../_work/tooltip-system-plan.md)
records bounded working-source evidence and release boundaries. Examples are
compiled through actual public exports; styled browser and installed/source-copy
checks are separate gates.

The 2026-10-08 dirty working-source checks passed **13 Chromium browser tests /
141 assertions**, the compiler check for **five complete public examples**
(1 test / 2 assertions), and a fresh installed-archive/public CLI source-copy
check (1 test / 9 assertions). The latter verifies public exports, SSR,
browser builds, strict consumer types, packaged styles/docs and copied source
without executing application configuration. The working plan records the
archive identity and neighboring sidebar/Kbd/modal regression gates.

These results are bounded implementation evidence, not a published-package or
release claim. Chromium fixture tests do not establish full screen-reader,
cross-browser or every application composition's qualification.

[Overlay configuration](./configuration.md) lists public paths and neighboring
controls. [Kbd](../kbd.md) owns keyboard badges; [Sidebar menu](./sidebar-menu.md)
owns hover-only navigation hints; [Popover](./popover.md) owns interactive panels;
[modal ownership](../../modals/modal-manager.md) explains managed overlay layers.
