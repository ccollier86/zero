---
id: zero.frontend.components.controls.floating-button-group
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: floating-button-group
maturity: supported
applies_to: ["2.6.0 working source; additive FloatingButtonGroup unreleased"]
modes: [browser, SSR, application, public-pages, package-imports, source-copy]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-11"
  evidence_level: source-observed
---

# Floating Button Group

[Controls index](./index.md) · [Canonical UI reference](../../ui-reference.md) · [Button Group](../primitives/button-group.md)

FloatingButtonGroup presents independent commands in a stationary compact tray.
One magnetic highlight follows pointer or keyboard activity; pressing changes
that decorative layer without moving the native button, icon or hit target.
Use it for editor tools, chart controls or a selected-record action rail. It
does not own selection, persistence, shortcut bindings or floating placement.

This is an additive working-source component, not a published 2.6.0 upgrade.
[ButtonGroup](../primitives/button-group.md) retains joined/separated native
composition; ButtonGroupToggle retains single/multiple selection. Neither is
silently replaced by this action tray. Representative-app visual approval
remains separate from the supported source contract described here.

## Imports And Public Types

The working-source entry is `@zero/framework/components/floating-button-group`.
The same component and public types are re-exported from `@zero/framework/react`
and the framework root. Load the normal Zero stylesheet and theme setup;
the tray does not load fonts, install another theme or require an AppProvider.

The focused entry exports one value, `FloatingButtonGroup`, and seven types:

- `FloatingButtonGroupProps`: tray options and native div props/ref.
- `FloatingButtonGroupAction`: one named application command.
- `FloatingButtonGroupSeparator`: a noninteractive cluster boundary.
- `FloatingButtonGroupItem`: the action/separator union.
- `FloatingButtonGroupVariant`: `muted | floating`.
- `FloatingButtonGroupSize`: `sm | md`.
- `FloatingButtonGroupOrientation`: `horizontal | vertical`.

The canonical [family entry](../../../../src/components/controls/floating-button-group/index.ts)
owns the implementation. Geometry, highlight measurement and departing label
phases are private helpers, not supported assembly parts. Application imports
use the public entry above rather than deriving an import from a physical folder.

## Horizontal Commands

A complete compact composition with native tray/action ref access:

```tsx
import { useRef } from 'react';
import { FloatingButtonGroup, type FloatingButtonGroupItem }
  from '@zero/framework/components/floating-button-group';
import '@zero/framework/styles.css';

export function CanvasTools({ zoomOut, zoomIn, fit, canZoomOut }: {
  zoomOut: () => void;
  zoomIn: () => void;
  fit: () => void;
  canZoomOut: boolean;
}) {
  const trayRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<HTMLButtonElement>(null);
  const items: readonly FloatingButtonGroupItem[] = [
    { id: 'zoom-out', label: 'Zoom out', icon: <span aria-hidden="true">−</span>,
      disabled: !canZoomOut, shortcut: '−', onSelect: zoomOut },
    { id: 'zoom-in', label: 'Zoom in', icon: <span aria-hidden="true">+</span>,
      shortcut: '+', onSelect: zoomIn },
    { type: 'separator', id: 'zoom-end' },
    { id: 'fit', label: 'Fit to canvas', iconOnly: false, ref: fitRef, onSelect: fit },
  ];
  return <FloatingButtonGroup ref={trayRef} label="Canvas tools" size="sm"
    iconOnly items={items} />;
}
```

Icons are caller-supplied React nodes; no new icon registry is installed.
`iconOnly` can be set on the group and overridden per action. If an action has
no icon, its text remains visible even when icon-only density is requested.
Every action's current `label` supplies its accessible name.

## Tray Configuration

| Prop | Default and contract |
| --- | --- |
| `items` | Required readonly ordered action/separator array. Keep action IDs stable across label/state changes. |
| `label` | Required nonempty accessible toolbar name, such as “Canvas tools,” not an unnamed visual group. |
| `variant` | `muted`; quiet inline material. `floating` adds a raised surface, border and shadow without positioning or portaling it. |
| `size` | `md`; `sm` offers the compact recipe. Active density and coarse-pointer minimum targets remain authoritative. |
| `orientation` | `horizontal`; `vertical` arranges a column and changes arrow navigation/separator direction. |
| `iconOnly` | `false`; default action presentation, with an action-level override. Text stays visible when no icon exists. |
| `tooltipSide` | `top` for horizontal trays, `right` for vertical trays. Accepts `top | bottom | left | right`; actual collision resolution belongs to Zero Tooltip. |
| `onAction` | Optional `(id: string) => void`, invoked after the item's synchronous `onSelect` returns. Reports intent, not accepted persistence. |
| `dir` | Inherits the tray's computed direction when omitted; `ltr | rtl` deliberately overrides it. Horizontal arrows follow that direction. |
| `className`, `style`, `ref` | Native tray customization/ref. The ref reaches the actual `HTMLDivElement`. |
| Other native div props | Forwarded, including handlers and `inert`. The component owns children, toolbar role, accessible name/orientation and roving tab stops. |

Native `onKeyDown` runs before local navigation; `event.preventDefault()` opts out
of the corresponding internal key handling. Native focus/blur handlers remain
composed with local ownership cleanup. Do not add an unrelated second roving
controller or override the component's toolbar semantics through casts.

The reference size calibrations are 30px (`sm`) and 36px (`md`) at a 16px root.
Actual buttons use the larger of that recipe and the active minimum target:
compact is 32px, comfortable is 36px and touch is 44px. Coarse pointers retain a
44px minimum even in a compact scope. These are button targets, not the complete
outer tray height; tray padding and borders remain separate. Do not reduce the
touch target to force exact desktop reference measurements.

## Actions And Separators

| Action field | Contract |
| --- | --- |
| `type` | Optional `action`; omitting it is the ordinary action shape. |
| `id` | Required stable nonempty string. IDs identify commands for refs/navigation/callbacks, not permissions. |
| `label` | Required nonempty string; the exact current accessible name and visible label unless icon-only. |
| `icon` | Optional noninteractive React node. Supply decorative icons rather than nested controls. |
| `iconOnly` | Optional boolean override of the group's value; an absent icon still keeps text. |
| `disabled` | Defaults false. Uses `aria-disabled`, skips roving focus and cannot activate or acquire press/highlight paint. |
| `pressed` | Optional caller-owned boolean mode state, exposed as `aria-pressed`. Hover/focus never changes it. Omit it for ordinary commands. |
| `shortcut` | Optional string tooltip hint, split into keys by Zero Tooltip. No shortcut is registered or executed. |
| `reserveLabels` | Optional readonly string array of real alternate labels. Hidden alternatives reserve natural width and do not add accessible names. |
| `onSelect` | Optional `() => void`, run on an admitted enabled native activation before `onAction`. |
| `ref` | Optional native `HTMLButtonElement` ref; composed with internal measurement/focus, including React 19 callback-ref cleanup. |

A separator has `type: 'separator'` and an optional stable `id`. It is a
noninteractive separator perpendicular to the tray's axis, not an action,
highlight target or focus stop. Anonymous separators are allowed. Every
explicit ID, including separator IDs, must be unique within the tray. Missing
action IDs/names, blank explicit IDs and collisions throw `TypeError` during
render rather than silently sharing native refs and moving paint.

Native buttons always use `type="button"`; the tray does not submit a surrounding
form or create hidden inputs. Use ordinary Button/Form composition for submission
and ButtonGroupToggle for selection. Arbitrary action children, nested inputs,
per-action native handler overrides and automatic overflow menus are not part
of this facade.

## Changing Labels And Application State

Reserve real alternatives when a successful operation changes a label. This
example only reports “Copied” after the browser clipboard accepts the write;
pending/error state belongs to the caller:

```tsx
import { useState } from 'react';
import { FloatingButtonGroup } from '@zero/framework/react';

export function ShareTools({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function copy() {
    if (pending) return;
    setPending(true); setError(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setError('Could not copy. Select the text and copy it manually.');
    } finally {
      setPending(false);
    }
  }
  return <div className="flex flex-col items-start gap-2">
    <FloatingButtonGroup label="Share tools" variant="floating" orientation="vertical"
      tooltipSide="left" items={[
        { id: 'copy', label: copied ? 'Copied' : 'Copy text',
          icon: <span aria-hidden="true">{copied ? '✓' : '⧉'}</span>,
          reserveLabels: ['Copy text', 'Copied'], shortcut: '⌘ C',
          disabled: pending, onSelect: () => { void copy(); } },
      ]} />
    {error && <p role="status">{error}</p>}
  </div>;
}
```

The outgoing/current label phases are aria-hidden; the native button exposes
only the current `label`. An icon-only action still changes its accessible name.
Reserved alternatives keep the natural label slot stable while the decorative
text exchanges. The icon stays mounted outside those label phases, keeping its
native pose across a changing label. Reduced motion replaces text without travel
or blur.

`onSelect` then `onAction` is synchronous and ordered. A synchronous exception
from `onSelect` prevents the later group callback; errors are not swallowed or
converted into a successful action. Returned promises are not awaited,
deduplicated, cancelled or interpreted as acceptance. An async action needs its
own pending guard, safe error handling and accepted-result state, as above.
Handle rejected promises in that application owner rather than relying on the
tray to observe them.

Reset/key state and retire async callbacks when their record, tenant or source
changes. For a persistent operation, use the existing SDK writer and backend
authority; an aria-pressed value, tooltip, shortcut or success label cannot
grant access. Important deletion composes the supported
[confirmation and hold path](../../modals/confirm.md), not a shorter decorative
press effect.

## Keyboard Pointer And Tooltip Behavior

Tab enters the enabled action sequence through one roving tab stop. Horizontal
Left/Right wraps through enabled actions and reverses for RTL; vertical Up/Down
wraps independently of direction. Home/End use first/last action order. Enter
and Space retain native button activation. Separators and disabled actions are
skipped; arrows do not activate commands or change `pressed`.

Keyboard focus-visible takes highlight ownership immediately. Pointer travel
can move material to another enabled action; crossing a separator preserves
continuity without activating it. If a focused action is removed or disabled,
focus moves to the next eligible slot, then the previous eligible slot. Empty
and all-disabled trays retain a focusable toolbar root while active, so removal
of the last command does not strand focus. A caller-supplied `inert` prop or an
inactive enclosing overlay scope retires interaction and that fallback tab stop.

Disabled actions use `aria-disabled`, not native `disabled`, so their existing
tooltip can remain discoverable on pointer hover. They are excluded from the
keyboard sequence and cannot run either callback. Keep a required explanation
visible outside a tooltip if skipping a disabled command would hide essential
information; this facade does not add a separate disabled-description focus stop.

Icon-only actions and actions with a `shortcut` get Zero Tooltip on the actual
native button. A plain visible-text action without a shortcut has no redundant
tooltip. The internal TooltipGroup shares one bubble between eligible triggers,
using the existing Grow/400ms and arrow-on defaults on all four sides. The
450ms first-hover intent, 450ms warm window and 70ms close grace remain Tooltip's
interaction policy, not tray animation timings. Local theme/provider settings
follow the existing [Tooltip contract](../overlays/tooltip.md); no private Arc
side-tooltip provider, z-index or exit recipe is added.

Touch/pen/mouse release, cancellation, lost capture, document departure and
unmount retire press feedback. Touch release does not leave synthetic hover
paint. Native buttons, mounted icons and their hit targets do not translate or
scale; only the independent highlight and descriptive label phases animate.
Native keyboard focus remains visible under forced colors, reduced motion or
unavailable measurement.

## Anchored Composition And Overlay Ownership

`variant="floating"` only supplies raised material. Compose an existing Popover
when the tray needs anchored placement, collision handling and dismissal:

```tsx
import { useState } from 'react';
import { Button, FloatingButtonGroup, Popover, PopoverContent, PopoverTrigger }
  from '@zero/framework';

export function SelectionTools({ duplicate, exportSelection }: {
  duplicate: () => void;
  exportSelection: () => void;
}) {
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button type="button" variant="outline">Selection tools</Button></PopoverTrigger>
    <PopoverContent align="start" className="w-auto p-2">
      <FloatingButtonGroup label="Selection tools" size="sm" onAction={() => setOpen(false)}
        items={[
          { id: 'duplicate', label: 'Duplicate', onSelect: duplicate },
          { type: 'separator', id: 'export-start' },
          { id: 'export', label: 'Export', onSelect: exportSelection },
        ]} />
    </PopoverContent>
  </Popover>;
}
```

This example closes on synchronous intent, not after an accepted backend save.
If acceptance must precede closing, keep controlled `open` with the operation
owner and close after its accepted result. Popover remains the sole position,
portal, collision, focus and dismissal owner; the action tray creates none of
those global responsibilities.

Inside a managed modal/overlay, the existing overlay scope guards the tray's
interaction when that owner is inactive. Tooltip keeps its own admitted branch
and theme projection. The tray starts no Reactive DB query, Fabric function,
heartbeat, presence subscription, clipboard service or analytics transport.
An app or chart controller may supply the current actions/state through props.

Keep the natural tray nonwrapping. Choose icon-only, compact or vertical density
deliberately before composing an overflow menu; do not clip commands to imitate
a reference screenshot. If an action rail intentionally scrolls, decorate the
actual bounded viewport with [ScrollArea](../primitives/scroll-area.md), preserving
one scroll owner and every command.

## Tokens Motion And Measurement

The [next foundation](../../design-system/foundation-next.md) owns the shared
palette, type, density and canonical `--zero-theme-floating-button-group-*`
roles. Scoped `--zero-floating-button-group-*` aliases tune this recipe without
shipping another root palette or changing Sidebar/Navbar motion.

| Recipe area | Scoped roles and defaults |
| --- | --- |
| Material | `background`, `tray-edge`, `foreground`, `secondary`, `muted`, `rule`; floating-specific background/border/shadow preserve inherited light/dark surface roles. |
| Shape and density | `sm-*` / `md-*` height, padding, gap, inline-padding, tray/item-radius and font-size; `hit-target-min` stays aligned with density. Icons use `icon-size=1rem`, `icon-gap=.375rem`. |
| Mode and transient state | `mode-tint` is caller-owned pressed material; `highlight` and `highlight-press` are independent pointer/focus/press feedback. |
| Geometry travel | `move-duration=420ms`, `move-bounce=.16`; an interruptible spring retargets the current pose, not a fixed delayed command deadline. |
| Press and entry | `press-duration=260ms`, `press-bounce=.12`, `first-entry-scale=.94`, `press-scale=.965`; paint changes over 120ms. The native button remains stationary. |
| Visibility | `show-duration=160ms`, `hide-duration=240ms`; `highlight-opacity-threshold=.15` distinguishes a new entry from a visible handoff. |
| Label handoff | Enter 240ms/4px, exit 160ms/−3px, blur 4px. These are decorative transitions, not operation timing. |
| Type and focus | Font family/size/weight, tracking, line-height and focus width/offset/color inherit the canonical control/focus roles. |

Measurement uses the actual owner document, tray borders and scroll offsets,
independent positive axis scale and DPR snapping. Rotate/skew/reflection or
perspective transforms are outside the decorative geometry contract; paint
retires safely while native actions and focus remain usable. Guards inspect the
target and composed ancestors, including individual rotate/scale properties and
shadow-host/assigned-slot ancestry. Tray/item reflow,
font loading, theme changes and replaced same-ID nodes remeasure locally;
there is no perpetual layout polling loop or ambient SSR layout read.

Reduced motion settles highlight geometry/press/visibility immediately and
removes label travel/blur without changing callbacks, disabled semantics or
hold confirmation. In forced colors, native focus and pressed feedback retain
actual outlines rather than relying only on a faint neutral wash.

## Qualification And Related Guides

Before adopting a consumer, check action changes during focus, keyboard/RTL,
touch release, labels/font reflow, target density, nested themes and mixed
overlays. Verify the installed package and source-copy CSS/Tooltip closure
against the exact version being used; working-source exports do not upgrade
older installed packages or overwrite customized copies.

- [Button Group](../primitives/button-group.md) covers joined controls and Toggle selection.
- [Tooltip](../overlays/tooltip.md) owns descriptions, warm groups and collision behavior.
- [Popover](../overlays/popover.md) owns deliberate anchored placement and dismissal.
- [Charts](../../charts/index.md) and [table controls](../../data-controls/data-table/controls.md)
  retain their command/data owners when a tray is composed into them.
- [Adoption plan](../../../_work/floating-button-group-plan.md) retains reference
  coverage, implementation gates and separate representative-app approval.
- [Source organization](../source-organization.md) explains family/public/copy boundaries.
