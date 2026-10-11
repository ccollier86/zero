---
id: zero.frontend.components.primitives.command
type: reference
audience: [developer, agent]
owner: frontend-components
status: verified
visibility: internal
system: frontend-components
feature: command-palette
maturity: supported
applies_to: ["2.6.0"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-10"
  evidence_level: source-observed
---

# Command Palettes

[Primitive index](./index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

The `@zero/framework/components/ui/command` module exports Command,
CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
CommandSeparator and CommandShortcut. Their headless search/selection props follow
cmdk; Zero adds surface/input/list styling.

Command is the cmdk root. CommandInput supports controlled value/onValueChange;
CommandItem supports value, keywords, disabled and onSelect. CommandList bounds
scrolling; groups supply headings; CommandEmpty displays the empty result;
CommandShortcut is a display-only span. The app registers any opening shortcut
explicitly, not by writing 'Cmd+K' inside that span.
Use the [shared keyboard hints](../kbd.md) for compact individual keys or
combinations; `CommandShortcut` remains a compatible trailing alignment span.

In the working source, CommandList now owns one paint-only magnetic highlight
that follows cmdk's selected item. Native filtering, disabled-item traversal,
typeahead, `onSelect` and `aria-activedescendant` remain cmdk-owned. The shared
highlight never commits a value or moves labels/hit targets.
`fadeEdges=true` and `scrollbars="hover" | "scroll" | "always" | "hidden"` decorate the
existing list viewport with [shared overflow treatment](./scroll-area.md).
Input and footer siblings remain outside the mask; do not nest another scroller
around the list. This integration also applies to Combobox and Cascader.

```tsx
import { Command, CommandInput, CommandList, CommandItem, CommandEmpty }
  from '@zero/framework/components/ui/command';

export function LocalCommands() {
  return <Command><CommandInput placeholder="Choose an action…" />
    <CommandList><CommandEmpty>No actions</CommandEmpty>
      <CommandItem value="overview">Overview</CommandItem>
    </CommandList></Command>;
}
```

CommandDialog wraps the animated Dialog and a Command root. Its props follow
Dialog open/defaultOpen/onOpenChange with children. It does not create the global
modal manager, install a hotkey, await a server command or apply authorization.
Supply appropriate dialog accessible title/description through the composition;
a search placeholder is not a complete dialog name. Use the app's capabilities
to filter actions, and still enforce each operation at the server.

## Dialog Composition

`CommandDialogProps` exposes the following composition options through the same
component and React facade. The documentation reader reuses this component;
it does not install a second command-palette implementation.

| Option | Contract |
| --- | --- |
| `title` / `description` | Accessible dialog text, defaulting to `Commands` / `Search and choose a command.`; rendered as hidden semantic title/description. |
| `shouldFilter` | Defaults to `true`; use `false` when server-ranked results are authoritative, avoiding a second conflicting client filter. |
| `contentClassName` / `contentStyle` | Presentation on the actual portalled dialog surface, including scoped token aliases. |
| `onCloseAutoFocus` | Native close-focus lifecycle; a custom trigger can prevent default and restore focus deliberately. |
| `contentTransition` / `overlayTransition` | Motion transitions for both animated surfaces. A reduced-motion composition must control both; CSS duration overrides alone do not stop JavaScript-driven motion. |

Opening shortcuts, fetching, cancellation and selecting destinations remain the
consumer's responsibility. The [optional docs reader](../../../plugins/docs/reader.md)
is a complete server-search example; its
[qualification ledger](../../../_work/audits/docs-plugin-qualification.md)
distinguishes source browser and installed compiled checks from this older baseline.

In the unreleased [structured-modal upgrade](../../modals/migration.md#deliberate-command-palette-compatibility),
this remains a deliberately separate command-palette composition, audited on its
own layout/focus contracts. Do not mechanically replace it with a copied ordinary
form modal. Source-only Doctor can flag direct dialog usage for manual review;
it cannot prove this palette's responsive presentation or interaction correctness.

Within a managed modal's React ownership context, CommandDialog now registers
an owned floating branch and inherits the portal container, live token lane and
active-owner state. Its overlay/content occupy the owning layer's supported
slots above the parent; Escape closes the palette without also dismissing the
parent. Its specialized cmdk anatomy and legacy content/overlay transition
options remain unchanged. Outside that context, it remains the standalone
controlled palette described above.

## Related Guides And Next Steps

- [Generic hotkeys](../../hooks/browser-interactions.md) installs explicit shortcuts.
- [Modals](../../modals/index.md) owns the separate imperative modal stack.
- [Choice controls](./choices.md) reuses cmdk inside Combobox.
