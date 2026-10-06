---
id: zero.frontend.components.public-pages.index
type: index
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: public-page-components
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

# Public Pages And Content

[Component index](../index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

Zero's public lane provides reusable hero, navigation, feature/content and code
presentation components. It is expressive styling, not a public-access permission
setting. The [router](../../router/authentication.md) still owns route access.

- [Navigation](./navigation.md) composes the floating ResizableNavbar.
- [Hero](./hero.md) declares titles/actions and background slots.
- [Backgrounds](./backgrounds.md) configures decorative presets/images/canvas waves.
- [Sections](./sections.md) covers FeaturesSection, CtaSection and FooterSection.
- [FAQ](./faq.md) groups question/answer disclosure with optional animated text.
- [CodeBlock](./code-block.md) introduces the complete shared code-example family.
- [CodeBlock composition](./code-block-composition.md) covers parts, props, file tabs and awaited copy.
- [CodeBlock rendering](./code-block-rendering.md) covers highlights/metadata, safe SSR and Markdown adapters.
- [CodeBlock examples](./code-block-examples.md) covers compact snippets and optional package-manager preferences.
- [Collections](./collections.md) covers BentoGrid, AnimatedList and ExpandableCards.
- [Configuration](./configuration.md) lists import/type/prop ownership.
- [Roadmap](./roadmap.md) distinguishes known richer public/editor/plugin ideas.

Keep public copy/assets genuinely public. A component does not hide private data
from a visitor or turn raw application input into a safe URL/image automatically.

The CodeBlock guides describe the shared replacement family in the 2.5.0
source/local release. Their own metadata and the
[qualification ledger](../../../_work/audits/docs-plugin-qualification.md)
record focused archive/compiled checks without asserting publication; the
original 2.1.1 review is not retroactively treated as evidence of the new parts.
The optional [Markdown docs reader](../../../plugins/docs/index.md) uses this
same family for fences alongside its [search experience](../../../plugins/docs/search.md).

## Related Guides And Next Steps

- [Design lanes](../../design-system/lanes.md) explains public versus application styling.
- [Text](../text/index.md) supplies the separate inline animation/streaming controls.
- [AppShell](../../app-shell/index.md) frames authenticated working interfaces.
