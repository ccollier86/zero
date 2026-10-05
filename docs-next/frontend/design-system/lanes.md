---
id: zero.design-system.lanes
type: architecture
audience: [developer, agent, operator]
owner: design-system
status: draft
visibility: internal
system: design-system
feature: lanes
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

# Application And Public Presentation Lanes

[Design-system index](./index.md) · [Documentation index](../../index.md)

The application lane uses quiet semantic surfaces for dense tables, forms,
settings and side panels. The public lane provides separate surfaces, glass,
accent-soft and floating-shadow colors for landing/content sections.
Both change with the same dark class; one is not “authenticated” and the other
“anonymous” automatically.

Public surface selectors are .zero-public or data-zero-surface="public".
They set the public foreground. Public page selectors are .zero-public-page
or data-zero-page="public"; they additionally set min-height and a public
background/radial-accent wash. Selection color uses public tokens inside these
scopes. No component is hidden or authorized by those selectors.

Complete presentational example:

```tsx
export function PublicIntro() {
  return <main data-zero-page="public">
    <section className="mx-auto max-w-3xl rounded-xl border border-public-border bg-public-surface p-8 text-public-surface-foreground">
      <h1 className="text-3xl font-semibold">Build together</h1>
      <p className="text-public-muted-foreground">A public content surface.</p>
    </section>
  </main>;
}
```

Choose paired tokens consistently within a lane. A component imported into a
public page still follows its own token classes; the selector is not a universal
rewrite of every application token. Override/customize through the component
contract when needed, not ad hoc selectors reaching deep into controls.

[Token reference](./tokens.md) provides exact values.
[Themes](./themes.md) supplies selected/resolved mode.
[Component conventions](./component-conventions.md) connects surfaces to reusable
controls. Authorization belongs to [Guardian](../../backend/guardian/index.md).
