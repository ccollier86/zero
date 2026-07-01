# Resizable Navbar

`ResizableNavbar` is Zero's public-page navigation bar. It stays attached to
the top of the viewport at page load, then detaches, shrinks, blurs, and floats
after scroll. Desktop links use a magnetic hover highlight that springs from
one item to the next. Mobile renders the same data as a compact menu.

Use it for public sites, docs, marketing pages, and landing pages. Use
`AppShell` for authenticated dashboards and operational apps.

## Import

```tsx
import { ResizableNavbar } from '@zero/framework/react';
```

Narrow package-mode import:

```tsx
import { ResizableNavbar } from '@zero/framework/components/navbar';
```

## Basic Usage

```tsx
import { ResizableNavbar } from '@zero/framework/react';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-zero-page="public" className="zero-public-page">
      <ResizableNavbar
        brand={{
          label: 'Zero',
          href: '/',
        }}
        items={[
          { label: 'Docs', href: '/docs' },
          { label: 'Components', href: '/components' },
          { label: 'Pricing', href: '/pricing' },
        ]}
        actions={[
          { label: 'Start Building', href: '/docs/start' },
        ]}
      />
      <main className="pt-24">{children}</main>
    </div>
  );
}
```

The component is fixed-position. Add top padding to the page or first section
so hero content does not sit under the navbar.

## Brand

Use `label` for text brands, `logoSrc` for image brands, or `children` for a
fully custom brand block:

```tsx
<ResizableNavbar
  brand={{
    label: 'Shadowboy',
    logoSrc: '/logo.svg',
    logoAlt: 'Shadowboy',
  }}
  items={items}
/>
```

```tsx
<ResizableNavbar
  brand={{
    href: '/',
    children: (
      <span className="inline-flex items-center gap-2">
        <span className="size-7 rounded-full bg-public-accent" />
        Zero
      </span>
    ),
  }}
  items={items}
/>
```

## Active Links

Set `active` on the current item. Zero renders `aria-current="page"` and uses
the active item as the idle magnetic highlight.

```tsx
<ResizableNavbar
  items={[
    { label: 'Docs', href: '/docs', active: true },
    { label: 'Components', href: '/components' },
  ]}
/>
```

## Actions

Actions render as Zero `Button` primitives so icons animate through the same
button/icon path as the rest of the platform.

```tsx
<ResizableNavbar
  items={items}
  actions={[
    { label: 'Sign in', href: '/login', variant: 'ghost' },
    { label: 'Create app', href: '/docs/create-zero' },
  ]}
/>
```

Use `external: true` on action links that should open in a new tab.

## Motion Options

```tsx
<ResizableNavbar
  items={items}
  scrollThreshold={120}
  expandedWidth="min(100%, 88rem)"
  compactWidth="min(calc(100% - 2rem), 56rem)"
  detachedOffset={18}
/>
```

| Prop | Default | Purpose |
| --- | --- | --- |
| `scrollThreshold` | `96` | Scroll offset before the navbar detaches. |
| `expandedWidth` | `min(100%, 80rem)` | Desktop width before scroll. |
| `compactWidth` | `min(calc(100% - 2rem), 54rem)` | Desktop width after scroll. |
| `detachedOffset` | `16` | Vertical offset applied after scroll. |

## Styling

The navbar uses Zero's public/frontend token lane. It reads
`public-foreground`, `public-muted-foreground`, `public-accent`,
`public-accent-soft`, `public-glass`, `public-border`, and `public-ring`.
Floating surfaces use `--public-shadow-floating`.

Public route trees should usually wrap content in `zero-public-page` or
`data-zero-page="public"` so the page background, foreground, and selection
colors match the navbar:

```tsx
<div data-zero-page="public" className="zero-public-page">
  <ResizableNavbar items={items} />
  <main className="pt-24">{children}</main>
</div>
```

Override with `className`, `desktopClassName`, `mobileClassName`,
`itemClassName`, `activeItemClassName`, and `menuClassName` when needed.

Do not fork this component for public pages. Prefer prop data or public token
overrides.

If an app needs to customize the source, copy the component and its app-owned
dependencies with:

```sh
zero add components/navbar
```
