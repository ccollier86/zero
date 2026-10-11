---
id: zero.design-system.typography
type: reference
audience: [developer, agent, maintainer]
owner: design-system
status: draft
visibility: internal
system: design-system
feature: typography
maturity: experimental
applies_to: ["2.6.0 working source; next application foundation and explicit text roles"]
modes: [browser, SSR, light, dark, application, public-pages, documentation]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-10"
  evidence_level: source-observed
---

# Typography

[Design-system index](./index.md) · [Documentation index](../../index.md)

Zero's CSS-first typography recipes give shared controls and new content a
consistent hierarchy. The optional `Text` and `Heading` components are convenient
native consumers, not prerequisites for styling inputs, menus, SVG text or
Markdown. They add no provider, font loader, data subscription or animation.

The application stylesheet includes [the next supplement](./foundation-next.md#activate-an-explicit-boundary)
after original styles, and AppShell activates its body recipe by default. A custom
next boundary also applies the body recipe; marked
text uses its recipe even outside that boundary. Unmarked legacy siblings retain
their existing presentation. Applications still own font assets and custom-frame activation.

## Shared Scale And Roles

`TYPOGRAPHY_SCALE` exports the standard rem steps 12/14/16/18/22/28/36/52/72px
at a 16px root. `TYPOGRAPHY_RECIPES` and `getTypographyRecipe(role)` expose
immutable CSS-expression tuples for family purpose, size, leading, weight,
tracking and numeric style. They are pure exports from
`@zero/framework/design-system`; they do not resolve browser preferences or
install a font.

| Purpose | Role and default next presentation |
| --- | --- |
| Ordinary content | `body`: 14px/1.5, regular body family. `support`: 13px/1.45; `caption`: 12px/1.4. |
| Compact controls | `control`: 13px/1.4, medium. `label`: 14px/1.4, medium. `navigation`: 14px/1.4. |
| Native input value | `input`: 16px/1.5 below `md`; `input-small`: 14px/1.5 at `md` and above in the existing Input/Textarea. |
| Product hierarchy | `section`: 16px/1.4; `heading`: 22px/1.25; `page`: 28px/1.2. Semibold body family. |
| Metrics | `metric`: 22px/1.2, semibold, tabular numerals. StatCard keeps its old 24px/bold fallback outside next. |
| Public display | `display`/`hero`/`display-large`: 36/52/72px, 1.1 leading, semibold display family and −.03em tracking. |
| Reading and technical text | `reading`: 16px/1.8 with inherited reading family; `reading-title`/`reading-heading`/`reading-subheading`: 32/24/18px. `technical`: 13px/1.75, mono. |
| Specialized presentation | `modal-*`, `tooltip*`, `analytical-*`, `inspector*` and `list-*` preserve the existing measured task hierarchy. |

Inter is the next body stack; Geist is the display stack; technical text uses the
overridable mono stack. HTML tags do not select a family automatically:
`Text as="code"` needs `variant="technical"` for that visual role, and
`Text as="strong"` keeps semantic importance without choosing an emphasis recipe.
Use the visual variant deliberately. Heading level follows the document outline,
not the desired font size.

## Optional Native Components

Import `Text` and `Heading` from `@zero/framework/components/typography`, or the
public React barrel. `Text` defaults to a `span` with `variant="body"`;
`Heading` defaults to an `h2` with `variant="section"`.

`Text` supports `span`, `p`, `div`, `small`, `strong`, `em`, `code`, `kbd` and
`label`. `Heading` supports `h1` through `h6`. Native attributes and refs follow
the selected `as`; native `role` remains an ARIA attribute, not a styling switch.
Both accept `className`, `style` and `asChild`. Slot composition requires one
non-Fragment React element; the caller owns that child's actual semantics.

Complete application-owned example:

```tsx
import type { CSSProperties } from 'react';
import { createThemeAttributes } from '@zero/framework/design-system';
import { Text, Heading } from '@zero/framework/components/typography';
import { Button } from '@zero/framework/components/ui/button';

const attributes = createThemeAttributes({ mode: 'light', density: 'compact' });
const localType = { '--zero-type-control-size': '.875rem' } as CSSProperties;

export function RequestsHeading() {
  return (
    <section {...attributes} aria-labelledby="requests-title">
      <Heading as="h1" variant="page" id="requests-title">Requests</Heading>
      <Text as="p" variant="support">Review the current queue.</Text>
      <div style={localType}>
        <Button type="button">Create request</Button>
      </div>
      <Text as="code" variant="technical">request_id</Text>
    </section>
  );
}
```

Native consumers can instead use `data-zero-typography="section"`,
`data-zero-typography="analytical-label"`, or another `TypographyRole` without
adding a wrapper. For example, SVG `text` can carry an analytical role. This is
optional composition, not a requirement to wrap existing controls in Text.

## Existing Consumers And Override Order

Button, Input, Textarea, Label, CardTitle, CardDescription, StatCard, Select,
Command and form descriptions/messages now consume role variables through
statically discoverable utilities. Their native behavior, refs, motion, padding,
heights and application overrides remain separate. Outside next, existing
Tailwind size/leading/weight overrides still supply the fallbacks.

Select menus project live trigger tokens into their actual body or owned portal,
including closer overrides inside a modal. Theme updates preserve the open menu,
selection, native form value, caller refs and keyboard focus/typeahead. The
modal owner still controls its layer, inert state and inactive pointer blocking;
this is not another positioning or dismissal manager.

At the paint site, direct role overrides beat defaults; caller utility classes
and inline styles remain authoritative. Fonts are consumed directly from the
family token, so a closer family override is not frozen into a root font alias.
Recipes are emitted in the CSS base layer, allowing ordinary app utilities to
override explicit Text/Heading presentation too.

Role defaults reference foundation primitives and resolve at their declaring
boundary. For a closer local adjustment, prefer `--zero-type-control-size`,
`--zero-type-section-leading`, or another role property. Changing only a primitive
on an arbitrary descendant may leave an inherited role alias at its ancestor's
resolved value. A new next boundary resolves its defaults afresh.

Existing modal, tooltip, chart, DenseList and code aliases bridge into their
corresponding roles while retaining their current sizes. Customize these aliases
locally when tuning one specialized consumer; change canonical roles at their
theme boundary for a family-wide adjustment. Inspector tuning accepts both the
previous foundation names and the new inspector role names. Some specialized
skins still use local literal weights/leading where no alias existed; this pass
does not replace every property of every profile.

Standalone and grouped tooltips now give closer source tokens precedence over a
broader modal-owner theme. Explicit visual content styles stay last. This changes
theme wiring, not their Grow animation, arrow or portal/interaction ownership.

## Source Ownership And Qualification

`zero add components/typography --target ./src --dry-run` previews the optional
components, their pure recipe/type closure and supplemental stylesheet. Copying
skips existing files unless explicitly forced; it does not activate a boundary,
edit app configuration or load fonts. Keep the copied CSS after legacy styles.

Focused checks cover actual controls with compiled legacy/supplemental CSS,
root-font and viewport changes, local/portal overrides, legacy Tailwind
customizations, native refs/Slot behavior, SSR, strict native types and copied
consumer builds. These are synthetic compositions, not deployed application or
real delayed-font/accessibility certification. The
[typography roadmap](../../_work/typography-system-plan.md) retains font-loading,
full-screen adoption, reading/locale/accessibility and promotion gates. Sidebar
geometry, magnetic movement and approved modal presentation remain protected.
