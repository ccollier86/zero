---
id: zero.frontend.components.command-palette
type: reference
audience: [developer, agent]
owner: frontend-components
status: in-review
visibility: internal
system: frontend-components
feature: command-palette
maturity: preview
applies_to: ["2.6.0 UI source on feature/blog-foundation; not the selected main archive"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "68ed0ba811437375dac340474e972952d7c88ab7"
  snapshot: clean
  date: "2026-10-25"
  evidence_level: package-qualified
  artifact:
    version: "2.6.0"
    commit: "68ed0ba811437375dac340474e972952d7c88ab7"
    sha256: "0457000e8d564f7fa838a5be9963827b1f6c0c0eda93845899cb5be598d415b9"
---

# Rich Command Palette

[Controls index](./index.md) · [Documentation index](../../../index.md)

CommandPalette presents rich search results or application commands with optional
group filters. It composes Zero's existing modal manager, cmdk controls, magnetic
highlight, keyboard hints and decorated scroll viewports. It owns presentation
and local filtering, not an application search index, router, permission policy
or persistent command history.

Import CommandPalette, CommandPaletteTrigger, filterCommandPaletteItems and their
types from `@zero/framework/components/command-palette`. The main React facade
exposes the same names. A normal app's existing ModalManager is reused; the
controlled modal supplies a host when there is no inherited one. Do not add a
parallel portal, document scroll lock or second command selection controller.

## Basic Composition

```tsx
import { CommandPalette } from '@zero/framework/components/command-palette';

// Fragment inside an existing app component. navigate is the app's router action.
<CommandPalette
  title="Navigate"
  shortcut
  groups={[{ id: 'pages', label: 'Pages', prefix: '/' }]}
  items={[
    { id: 'overview', label: 'Overview', group: 'pages', data: '/overview' },
    { id: 'settings', label: 'Settings', group: 'pages', data: '/settings' },
  ]}
  onSelect={item => { navigate(item.data!); }}
/>;
```

Stable item IDs identify the cmdk choices. The caller supplies already permitted
actions and must still enforce authorization at the action's server boundary.
Hiding an item does not authorize or revoke its operation.

## Items Groups And Filtering

`CommandPaletteItem<T>` requires id/label. Optional description, keywords, group,
icon, image, trailing, disabled and data customize presentation and selection.
image is a caller-supplied React node, not a fetched URL. Default rows show the
image or icon, label, description and trailing content; renderItem replaces the
row contents, not its selectable semantics. Keep nested interactive controls
out of a command row.

Groups require id/label and accept icon/prefix. Supplied groups become filters;
there is also an All filter. A prefix at the beginning of the query selects its
group and is removed before matching. Other group selections remain local to
the opening. Missing optional groups do not create empty placeholder filters.

`filterCommandPaletteItems(items, query, group?, limit?)` uses normalized,
case-insensitive AND terms across label, description and keywords. It preserves
caller order and does not mutate items. Query matching uses at most 256
characters. maxResults defaults to 20 and is clamped to 1–100. This bounds the
rendered result set, not the size of a caller-owned search corpus.

With filterMode='manual', pass the authoritative results through items and use
query/onQueryChange for the caller's search controller. Group filtering and the
result limit still apply. The palette never starts a network request, creates
a subscription, persists history or fabricates recent results.

## Options And Defaults

| Props | Behavior |
| --- | --- |
| items / groups | Required result array; optional group array. |
| title / description / placeholder | Title defaults to Search; description is optional; input placeholder defaults to Search…. |
| open / defaultOpen / onOpenChange | Supplied open is controlled; otherwise defaultOpen initializes local state, false by default. Reflect controlled close notifications normally. |
| trigger / origin | Omitted trigger shows the shared search button. A React node replaces its contents, not the outer button. false omits it; use controlled open and optionally provide the real origin Element. |
| shortcut | false by default. true registers Cmd/Ctrl+K and displays its hint on the default trigger. Editable fields, already handled keys and repeats are excluded. Opt in on one intended palette, not every mounted palette. |
| query / onQueryChange | Supplied query is controlled. Otherwise each opening starts with an empty local query. Input changes report at most 256 characters. |
| filterMode / maxResults | client and 20 by default. manual bypasses client text matching. |
| loading / empty | Loading displays Searching… rather than selectable results. empty replaces the normal no-results message. |
| sidebarExtra / footer | Optional sidebar content and footer. Omitted footer supplies Navigate/Select/Close hints; false removes the footer. |
| renderItem | Optional result-content renderer retaining cmdk's row controller. |
| className / style | className decorates the managed frame. style applies to the trigger and body wrapper; an explicit --zero-command-palette-width value also sets the managed frame width. Other native width/height styles do not resize the frame. |
| onSelect / onSelectionError | Awaited selection and optional diagnostic observer; see the lifecycle below. |

CommandPaletteTrigger also accepts normal Zero Button props, children and an
optional shortcut display flag. Outside a provider it is only a trigger button.
Inside CommandPaletteProvider it opens that scoped palette automatically when
no explicit onClick is supplied. An explicit onClick owns the action, so nested
palette triggers do not accidentally open two dialogs. It never registers its
own keyboard handler.

## Scoped Provider And Controller

CommandPaletteProvider accepts the normal palette props except trigger/origin,
plus children and clearOnClose (true). It renders one palette with no built-in
trigger. Put CommandPaletteTrigger instances in its children or call
useCommandPalette() there. The hook exposes isOpen/query, open(origin?), close,
toggle(origin?) and setQuery. Supplying the actual originating element preserves
manager origin motion; an absent origin uses the manager fallback.

The provider supports the same controlled open/query callbacks. A completed
open-to-closed transition clears query by default, including externally controlled
closure; clearOnClose=false preserves it. State belongs to this React instance,
not a process-wide store. Custom result renderers retain this provider context
even though the manager owns their portal. Existing standalone CommandPalette
usage is unchanged.

## Selection And Modal Lifecycle

`onSelect(item, {signal})` may return void, a boolean or a promise of either.
The palette prevents duplicate selection while the callback is pending, marks
the managed modal busy and disables the input/choices. A successful return
closes the opening; false keeps it open. Rejection clears busy state, preserves
the opening for retry and displays a safe generic error. onSelectionError may
record the cause; raw exception text is never displayed.

The signal belongs to that managed opening. Pass it into supported cancellable
work and stop applying UI effects after retirement. Cancellation is not proof
that a server mutation did not commit. Use the service's accepted-write or
idempotency contract for writes; the palette does not add transaction semantics.

The manager owns focus, Escape/backdrop admission, nested overlay scope,
origin-based entrance/exit and focus restoration. Normal parent close/retirement
rules remain in force. Theme aliases on an ancestor follow the existing overlay
scope behavior; do not install another theme switcher for the palette.

## Design Tokens

The `--zero-command-palette-*` roles cover width, height, sidebar width, mobile
filter height, border width, gap, padding, icon size, caption/body sizes, weight, radius,
border, muted/surface/foreground/soft colors and danger color. Paint/type/spacing
alias Zero's current semantic roles. The frame width defaults to 48rem, result
panel height to min(26.25rem,55dvh), and sidebar width to 12rem. Use scoped styles
or explicit custom properties in style. The shared modal projects the trigger's
theme into the portal; the width-token override is honored even without a trigger.

Results reuse CommandList's overflow decoration and magnetic active-row fill;
group filters use the same highlight helper. The palette adds no independent
motion durations. Reduced-motion, dimming and morph behavior remain owned by
the shared modal/control families.

## Related Guides And Next Steps

- [Command primitives](../primitives/command.md) support smaller inline command compositions.
- [Modal manager](../../modals/index.md) owns the opening and guarded lifecycle.
- [Blog search](../public-pages/blog/parts.md#search-and-pagination) adapts posts,
  authors, tags and categories into this same palette.
- [ScrollArea](../primitives/scroll-area.md) explains conditional fades and rails.
