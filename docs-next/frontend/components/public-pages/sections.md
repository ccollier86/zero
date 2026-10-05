---
id: zero.frontend.components.public-pages.sections
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: public-sections
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

# Feature, CTA And Footer Sections

[Public-page index](./index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

Use `@zero/framework/components/features`, `/cta` and `/footer` (or root/React)
for FeaturesSection, CtaSection and FooterSection and their public types. They
compose public-lane copy/assets/actions supplied by the app, without persistence.

## FeaturesSection

FeaturesSectionProps extends section props except native title. Required title;
optional eyebrow,description,features=[],visual,visualPosition='right',
titleAs='h2' (h2|h3),framed=true,className,innerClassName,contentClassName,
featureListClassName,visualClassName. FeatureSectionItem requires id/title;
description,icon/iconName optional. Custom icon precedes registry icon; omitted
icons use check. Visual can be a CodeBlock/product illustration; without one,
layout becomes a single column. visualPosition supports left/right at wider layouts.

```tsx
import { FeaturesSection } from '@zero/framework/components/features';
import { CtaSection } from '@zero/framework/components/cta';
import { FooterSection } from '@zero/framework/components/footer';

export function PublicSections() {
  return <>
    <FeaturesSection title="A useful foundation" features={[
      { id: 'live', title: 'Realtime data', description: 'Use the existing projection layer.' },
    ]} />
    <CtaSection title="Try an example" actions={[{ label: 'Explore', href: '/examples' }]} />
    <FooterSection brand={{ label: 'Example', href: '/' }} copyright="Example project" />
  </>;
}
```

## CtaSection

CtaSectionProps extends section props except title. Required title; optional
eyebrow,description,actions,align center|left (center),framed=true,
innerClassName,contentClassName,actionsClassName and native className.
It uses h2 and [HeroActions](./hero.md); it does not start billing/onboarding just
because the action label says 'Get started'.

## FooterSection

FooterSectionProps extends footer props and requires brand:FooterSectionBrand
(label required,href/mark/description optional). Optional linksTitle,links=[],
actionTitle,actionDescription,actions,socialTitle,socialLinks=[],copyright,
tone accent|surface (accent),innerClassName,brandClassName,linksClassName,
actionClassName,bottomClassName. Links use FooterSectionLink with required
label/href and optional icon/external/ariaLabel; icon-only links need an accessible
name. Empty groups omit their layout regions. Actions reuse HeroAction;
external links use noreferrer/new-tab behavior. The app owns URL safety and tracking.

## Related Guides And Next Steps

- [Hero actions](./hero.md) defines the reused action descriptor.
- [CodeBlock](./code-block.md) supplies a realistic feature visual.
- [Configuration](./configuration.md) lists imports and caller ownership.
