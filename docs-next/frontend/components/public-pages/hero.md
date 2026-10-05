---
id: zero.frontend.components.public-pages.hero
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: hero-actions
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

# Hero Content And Actions

[Public-page index](./index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

Import Hero, HeroActions and Hero-related types from
`@zero/framework/components/hero`, root or React. Hero requires title:ReactNode.
It composes semantic heading, caller-owned copy/actions and a decorative background.

```tsx
import { Hero } from '@zero/framework/components/hero';

export function Introduction() {
  return <Hero eyebrow="Example" title="Build something useful"
    description="Compose the platform capabilities you already have."
    actions={[{ label: 'Get started', href: '/start' }]}
    background={{ preset: 'gradient' }} />;
}
```

HeroProps optionally accepts eyebrow,description,actions,children,background;
align center|left (center);size default|compact|full (default);
as section|header (section);titleAs h1|h2 (h1);className,innerClassName,
contentClassName,eyebrowClassName,titleClassName,descriptionClassName,actionsClassName.
Unlike arbitrary native section props, Hero's public interface is this explicit
set. Compose anchors/IDs in an outer region when the interface does not accept them.
Default/compact/full change vertical framing, not the content's access level.
Use one intentional page h1 and a coherent heading hierarchy.

## Action Contract

HeroAction requires label:string, optionally href,onClick,external,variant,icon,
className. HeroActions accepts an optional readonly action list and className;
empty input renders nothing. Actions reuse Button with public-lane styling,
large size and native links/buttons. external links use a new tab/noreferrer.
onClick is an app-owned UI callback; no asynchronous command runner or analytics
is implied. If you perform a write, own pending/accepted/error state explicitly.

background defaults to aurora options, accepts HeroBackgroundOptions or ReactNode.
Falsy background removes the layer. React elements/custom nodes use the visual
slot; option objects, including empty/class-only options, retain their descriptor
meaning. [Background options](./backgrounds.md) owns exact preset/overlay behavior.

## Related Guides And Next Steps

- [Backgrounds](./backgrounds.md) configures decorative layers and image assets.
- [Text effects](../text/effects.md) can be placed inside a caller-owned title.
- [Sections](./sections.md) reuses HeroAction in CTA/footer compositions.
