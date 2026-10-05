---
id: zero.frontend.components.public-pages.navigation
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: resizable-navbar
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR, public pages]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Floating Public Navigation

[Public-page index](./index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

Import ResizableNavbar and its types from `@zero/framework/components/navbar`,
root or React. The component follows window scroll and switches from attached
navigation to a compact blurred floating surface. It is not the dashboard sidebar,
a permission resolver or the router Link component.

ResizableNavbarProps requires readonly items. Optional brand/actions; className,
desktopClassName,mobileClassName,itemClassName,activeItemClassName,menuClassName;
ariaLabel='Primary navigation';scrollThreshold=96;expandedWidth='min(100%, 80rem)';
compactWidth='min(calc(100% - 2rem), 54rem)';detachedOffset=16.
At larger lg layouts it renders the desktop navigation; smaller layouts use the
local menu toggle. Fixed positioning requires appropriate page content spacing.

```tsx
import { ResizableNavbar } from '@zero/framework/components/navbar';

export function SiteNav() {
  return <ResizableNavbar brand={{ label: 'Example', href: '/' }} items={[
    { label: 'Features', href: '/features', active: false },
    { label: 'Documentation', href: '/docs' },
  ]} actions={[{ label: 'Sign in', href: '/login', variant: 'outline' }]} />;
}
```

ResizableNavbarItem requires label/href; active/external/icon optional. Active
appearance is supplied by the caller, not inferred from the current path.
Desktop hover highlight and the committed active link are separate presentation.
ResizableNavbarAction requires label, optionally href/onClick/external/variant,
icon/className. With href it is an anchor; otherwise a button. external opens a
new tab with noreferrer. Mobile selection closes the menu. Callbacks do not await
server acceptance, confirm destructive actions or register shortcuts.

ResizableNavbarBrand accepts label,href,logoSrc,logoAlt,mark or children.
children overrides generated brand content; otherwise image precedes mark.
Brand href defaults '/'. Supply meaningful image alt/link content and safe URLs.
The mobile control has accessible open/close labels and aria-expanded; device,
keyboard and reduced-motion qualification still needs the app's actual layout.

## Related Guides And Next Steps

- [Hero](./hero.md) supplies content spacing/presentation beneath navigation.
- [AppShell navigation](../../app-shell/navigation.md) is the dashboard alternative.
- [Router navigation](../../router/navigation.md) owns enhanced Link semantics.
