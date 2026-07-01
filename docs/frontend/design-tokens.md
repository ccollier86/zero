# Frontend Design Tokens

Zero has two frontend token lanes:

| Lane | Use for | Primary tokens |
| --- | --- | --- |
| Core app lane | Dashboards, admin tools, app shells, forms, tables, storage, auth, and dense operational UI. | `background`, `card`, `popover`, `muted`, `accent`, `primary`, `border`, `ring`, semantic state tokens |
| Public/frontend lane | Marketing pages, docs, blogs, public intake flows, landing pages, heroes, pricing, footers, and public navigation. | `public-background`, `public-surface`, `public-glass`, `public-accent`, `public-border`, `public-ring` |

The lanes share radius, font, semantic status colors, and light/dark/system
theme switching. They intentionally differ in visual feel: the core app lane is
quiet and work-focused, while the public lane is richer, glassier, and better
suited for first-impression pages.

## Public Lane Tokens

Use Tailwind classes generated from these variables:

| Token class | Purpose |
| --- | --- |
| `bg-public-background` | Page background for public route trees. |
| `text-public-foreground` | Primary public-page text. |
| `bg-public-surface` | Solid public sections and panels. |
| `text-public-surface-foreground` | Text on public surfaces. |
| `bg-public-surface-raised` | Slightly raised public panels. |
| `bg-public-glass` | Floating glass surfaces such as navbars and menus. |
| `text-public-glass-foreground` | Text on glass surfaces. |
| `bg-public-muted` | Quiet public-page blocks. |
| `text-public-muted-foreground` | Secondary public-page copy and inactive nav items. |
| `bg-public-accent` | Primary public-page action/accent color. |
| `text-public-accent` | Public accent text and links. |
| `text-public-accent-foreground` | Text on public accent backgrounds. |
| `bg-public-accent-soft` | Hover pills, subtle active states, and low-pressure highlights. |
| `border-public-border` | Public glass/surface borders. |
| `ring-public-ring` | Public focus rings. |

Floating public surfaces can use:

```tsx
className="border border-public-border bg-public-glass text-public-glass-foreground shadow-[var(--public-shadow-floating)] backdrop-blur-xl"
```

## Route Usage

Wrap public route trees in the public page lane:

```tsx
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-zero-page="public" className="zero-public-page">
      {children}
    </div>
  );
}
```

`zero-public-page` applies the public background, foreground, and selection
color. Public components can also mark local surfaces with
`data-zero-surface="public"` when they should inherit public foreground color
without forcing a page background.

## Component Rules

1. Dashboard and operational components should keep using the core app lane.
2. Public-page components should use the public lane by default.
3. Do not copy one-off classes like `bg-neutral-950/80` into promoted platform
   components. Add or reuse a public token instead.
4. Keep public components compatible with light and dark mode.
5. If a component must work in both lanes, expose a small `tone` or `surface`
   prop rather than branching on route paths or auth state.
