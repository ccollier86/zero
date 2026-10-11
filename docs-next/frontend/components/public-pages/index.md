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
applies_to: ["2.6.0 working source; public lane retained; individual family reviews remain distinct"]
modes: [browser, SSR, public pages]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-10"
  evidence_level: source-observed
---

# Public Pages And Content

[Component index](../index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

Zero's public lane provides reusable hero, navigation, feature/content and code
presentation components. It is expressive styling, not a public-access permission
setting. The [router](../../router/authentication.md) still owns route access.

Follow [Public UI development](../../../guides/public-ui-development.md) for the
agent-oriented assembly workflow and the [UI reference](../../ui-reference.md)
for canonical token, motion and component/API choices. Operational dashboards
use [Application UI development](../../../guides/application-ui-development.md).

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
