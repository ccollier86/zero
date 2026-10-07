---
id: zero.frontend.components.kbd
type: reference
audience: [developer, agent]
owner: frontend-components
status: verified
visibility: internal
system: frontend-components
feature: keyboard-hints
maturity: supported
applies_to: ["2.6.0"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "c5656b306051b04ec6adc641b7057a0672fd7a3e"
  snapshot: clean
  date: "2026-10-07"
  evidence_level: implementation-verified
---

# Keyboard Hints

[Component index](./index.md) · [Frontend index](../index.md) · [Documentation index](../../index.md)

`Kbd` presents a key or key combination. `KbdGroup` places related keys next
to one another. Both render native `<kbd>` elements, work during SSR, forward
native attributes and refs, and use Zero's semantic colors and typography.
Their compact defaults adapt REUI's public Kbd component and radix-vega style.
This source addition is not yet a published framework update.

These are presentation components. Writing `Ctrl+S` does not register a
shortcut, save a record, detect the user's operating system or authorize an
action. The consuming app owns any real keyboard handling and accessible
description of the control that performs it. No provider, Guardian session,
SDK request or browser subscription is needed to display a hint.

## Public Imports And Styling

Import `Kbd`, `KbdGroup`, `KbdProps` and `KbdGroupProps` from
`@zero/framework/components/kbd`, `@zero/framework/react` or `@zero/framework`.
Use Zero's platform stylesheet through the normal Zero/Tailwind pipeline;
generated apps already include its component styles. An independent host
must process `@zero/framework/styles.css`.

Both prop types describe the actual native `kbd` element, not a button or div.
`children`, `className`, `style`, `title`, `id`, `data-*`, `aria-*` and a ref to
the native `HTMLElement` are forwarded. There are no feature-specific React
props or backend configuration keys. `data-slot="kbd"` and
`data-slot="kbd-group"` identify the two compositions.

## Basic Keys And Groups

Use one `Kbd` for a complete string or a `KbdGroup` for separate keys. Literal
separators such as `+` are optional and are ordinary group content.

```tsx
import { Kbd, KbdGroup } from '@zero/framework/components/kbd';

export function KeyboardHints() {
  return <div>
    <p>Open commands <Kbd>⌘ K</Kbd></p>
    <p>Save <KbdGroup><Kbd>Ctrl</Kbd> + <Kbd>S</Kbd></KbdGroup></p>
    <p>Leave the dialog <Kbd>Esc</Kbd></p>
  </div>;
}
```

The key has no automatic tab stop, button role or event handler. Its default
pointer events and text selection are disabled, so a decorative hint inside
a Button does not compete with that Button's click target. Keep the actual
control focusable and labeled; do not turn a key hint into a pretend control.

## Icons, Input Addons And Tooltips

An SVG without a `size-*` class defaults to 12px. An explicit size utility
keeps its caller-supplied dimensions. Provide readable text for icon-only
hints; hide decorative icons from assistive technology.

This example composes existing Zero Input, Button and Tooltip controls. It
does not install a search or save shortcut. The input addon is decorative;
the Input remains the real form control.

```tsx
import { Button, Input, Kbd, KbdGroup } from '@zero/framework/react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@zero/framework/components/tooltip';

export function ContextualHints() {
  return <div className="grid gap-4">
    <Kbd>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 4v16m-6-10 6-6 6 6" stroke="currentColor" fill="none" />
      </svg>
      <span className="sr-only">Arrow up</span>
    </Kbd>
    <div className="relative">
      <Input aria-label="Search records" placeholder="Search records…" className="pe-16" />
      <Kbd aria-hidden="true" className="absolute end-3 top-1/2 -translate-y-1/2">⌘ K</Kbd>
    </div>
    <Tooltip>
      <TooltipTrigger asChild><Button type="button">Save</Button></TooltipTrigger>
      <TooltipContent aria-label="Save keyboard hint">
        Save <KbdGroup><Kbd>Ctrl</Kbd><Kbd>S</Kbd></KbdGroup>
      </TooltipContent>
    </Tooltip>
  </div>;
}
```

Within the public Zero Tooltip surface, keys inherit its foreground and use
a translucent foreground background: 20% in light mode and 10% in dark mode.
This is scoped to Zero's actual tooltip composition, not an upstream slot
name and not every ordinary Popover. The Tooltip continues to own opening,
focus, Escape dismissal and positioning. `Kbd` adds no animation or shortcut
listener of its own.

## Shortcut Reference Lists

The parent can render a help list from its real commands. Keep the command
name readable; the hint does not replace the action's accessible label.

```tsx
import { Kbd, KbdGroup } from '@zero/framework/react';

const hints = [
  { id: 'search', label: 'Search', keys: ['Ctrl', 'K'] },
  { id: 'save', label: 'Save', keys: ['Ctrl', 'S'] },
  { id: 'close', label: 'Close dialog', keys: ['Esc'] },
] as const;

export function ShortcutReference() {
  return <dl className="grid gap-2">
    {hints.map(hint => <div key={hint.id} className="flex items-center justify-between gap-3">
      <dt>{hint.label}</dt>
      <dd><KbdGroup>{hint.keys.map(key => <Kbd key={key}>{key}</Kbd>)}</KbdGroup></dd>
    </div>)}
  </dl>;
}
```

RecordNavigationBar's existing `shortcut?: string` now uses `Kbd` without
changing its action callbacks or registering that string. The documentation
reader uses shared keys for its search trigger and navigation footer while
retaining the reader's existing actual keyboard behavior.

## Tokens And Overrides

The compact default is a 20px high key, a 20px minimum width, 4px internal
gap and horizontal padding, sans-serif 12px medium text, and a 12px icon.
The radius follows Zero's `rounded-sm` radius calculation. Group gap is 4px.
Colors follow `--muted` and `--muted-foreground`; the family follows
`--font-platform-sans`. Changing the platform theme changes the hints without
changing the global theme just to adopt this component.

Public component variables may be set on the key, group or a parent scope:

| Variable | Default |
| --- | --- |
| `--zero-kbd-height`, `--zero-kbd-min-width` | `1.25rem` |
| `--zero-kbd-gap`, `--zero-kbd-padding-inline`, `--zero-kbd-group-gap` | `0.25rem` |
| `--zero-kbd-padding` | optional full padding shorthand; overrides the zero-block/horizontal-padding default |
| `--zero-kbd-radius` | `calc(var(--radius) - 2px)` |
| `--zero-kbd-font-family` | `--font-platform-sans`, then system sans-serif |
| `--zero-kbd-font-size`, `--zero-kbd-icon-size` | `0.75rem` |
| `--zero-kbd-font-weight` | `500` |
| `--zero-kbd-line-height` | `1rem` |
| `--zero-kbd-background`, `--zero-kbd-foreground` | `--muted`, `--muted-foreground` |
| `--zero-kbd-tooltip-background`, `--zero-kbd-tooltip-foreground` | translucent inherited foreground, inherited foreground |
| `--zero-kbd-tooltip-opacity` | percentage: `20%` light, `10%` dark |

Component rules are in the component CSS layer so caller utilities can also
override them. The docs reader forwards its existing `--zero-docs-key-size`
and `--zero-docs-key-padding` to the shared font-size and padding variables.
It no longer paints a second bespoke
bordered keyboard component.

## Related Guides And Next Steps

- [Tooltip](./overlays/tooltip.md) owns the description's interaction and accessible composition.
- [Command palettes](./primitives/command.md) distinguishes command selection from shortcut presentation.
- [Master/detail controls](../data-controls/master-detail.md) owns RecordNavigationBar actions and record navigation.
- [Design tokens](../design-system/tokens.md) owns the theme shared by these compact hints.
- [Documentation reader](../../plugins/docs/reader.md) owns the actual reader keyboard controls.
