---
id: zero.frontend.components.public-pages.configuration
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: public-page-configuration
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

# Public-Page Configuration

[Public-page index](./index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

All options are React props/render-time descriptors, not env/Doctor/server config.
The app owns text/assets, URL safety, route access and async actions. Loading the
public visual lane does not make an authenticated page public automatically.

| Component family | Exact package subpath |
| --- | --- |
| ResizableNavbar | /components/navbar |
| Hero/HeroActions/HeroBackground/HeroImageBackground/WavyBackground | /components/hero |
| FeaturesSection | /components/features |
| CtaSection | /components/cta |
| FooterSection | /components/footer |
| Faq | /components/faq |
| CodeBlock | /components/code-block |
| BentoGrid/BentoGridItem/BentoGridSkeleton | /components/bento-grid |
| AnimatedList/AnimatedListItem/AnimatedListCard | /components/animated-list |
| ExpandableCards | /components/expandable-card |

Prefix with `@zero/framework`; root/React also export these named organisms.
The documentation folder name public-pages is not a package export. Public
Props/item/type declarations live alongside their corresponding family. Follow
feature guides for every option/default rather than assuming native attributes
on a component with a narrower explicit interface (notably Hero and navbar).

Class slots merge with token-based defaults; they are not configuration precedence
for server permissions. Component-local expansion/tab/timer state is ephemeral.
A controlled ID and its change callback lets the app coordinate another panel;
it does not persist a setting or run a source query by itself.

## Related Guides And Next Steps

- [Hero](./hero.md) owns action/background descriptor choices.
- [CodeBlock](./code-block.md) owns async highlight/copy behavior.
- [Design lanes](../../design-system/lanes.md) owns intended visual semantics.
