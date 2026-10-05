---
id: zero.frontend.components.public-pages.backgrounds
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: hero-backgrounds
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

# Hero Backgrounds And Canvas Waves

[Public-page index](./index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

HeroBackground, HeroImageBackground and WavyBackground share the public hero
component entrance. Their purpose is decorative framing, not content rendering,
image upload, AI image generation or access control.

HeroBackgroundOptions accepts preset,custom,className,overlay=true,
overlayClassName and interactive=false. Presets are aurora (default),gradient,
stars,bubbles,wavy,hexagon,none. A truthy custom node replaces the preset; none
without custom returns nothing. The outer layer is aria-hidden and absolutely
positioned, so keep important content outside it. interactive allows the relevant
preset's pointer effects, not semantic links inside a hidden decorative region.
The overlay helps text contrast but does not establish accessibility on every asset.

```tsx
import { Hero, HeroImageBackground } from '@zero/framework/components/hero';

export function ProductIntro() {
  return <Hero title="Example product"
    background={<HeroImageBackground src="/assets/public-product.jpg" alt="" />} />;
}
```

This fragment requires an app-owned public asset. HeroImageBackgroundProps requires
src; alt='' defaults decorative;priority=false sets fetchPriority only when true;
className,imageClassName,overlayClassName,children optional. It uses a normal img,
not a storage signer/optimizer. Inside Hero's decorative background the outer
aria-hidden applies regardless of image alt; place meaningful product imagery in
an accessible content slot instead. Standalone meaningful images need appropriate alt.

## WavyBackground

WavyBackgroundProps extends div props with colors,waveWidth=48,
backgroundFill,blur=8,speed slow|default|fast (default),waveOpacity=0.48.
Defaults use a multi-color decorative palette. Its canvas reads current options,
scales for device pixels up to 2x, follows window resize and retires its animation
frame/listener on unmount. Children render above the canvas in a foreground layer.
No supported remote image/model setting or persisted animation state is implied.

Some preset colors are intentionally decorative explicit colors, not every
individual color a semantic theme token. Review contrast, device performance and
motion preferences in the actual page; source cleanup alone does not certify all
reduced-motion or mobile conditions.

## Related Guides And Next Steps

- [Hero](./hero.md) owns surrounding title/actions/layout.
- [Design lanes](../../design-system/lanes.md) owns public visual tokens.
- [Storage](../../storage/index.md) owns private/public object delivery separately.
