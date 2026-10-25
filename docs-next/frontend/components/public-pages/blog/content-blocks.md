---
id: zero.frontend.components.blog.content-blocks
type: reference
audience: [developer, agent]
owner: frontend-components
status: in-review
visibility: internal
---

# Blog Content Block Presentation

[Blog UI index](./index.md) · [Documentation index](../../../../index.md)

BlockRenderer accepts `blocks: readonly BlogContentBlock[]`. This is a typed
presentation union, not a Gutenberg editor, Markdown parser, storage schema,
permission check or untrusted JSON validator. Validate external documents at
their application boundary before handing them to components.

Every block may have a stable id. Supported shapes:

| type | Fields |
| --- | --- |
| paragraph | text |
| heading | level 2–6, text, optional anchor |
| quote | text, optional author/source |
| callout | info/warning/error/success/tip variant, text, optional title |
| list | bullet/numbered style, items |
| code | code, optional language/filename/showLineNumbers/highlightLines |
| image | src, alt, optional caption/width/height |
| image-gallery | images, optional grid/carousel/stack layout and 2/3/4 columns |
| video | src, optional title/poster |
| audio | src, optional title/artist/coverArt/peaks |
| divider | no additional fields |
| embed | url, optional title/description/image; a provided link preview, not an iframe |
| citation | text, source, optional url |

Text remains escaped React text, including paragraph/list content. There is no
raw html block and no implicit execution of inline HTML, MDX or embedded scripts.
The archive's raw-HTML shortcut is deliberately not a publishing boundary.
For app-authored custom presentation, use BlogPostPage's React content slot.

Heading anchors feed `blogBlockToc(blocks)` and the article's automatic TOC.
Explicit anchor values must be unique within the document. When omitted, the
heading text and position produce a deterministic anchor. The page title owns
h1; block headings start at h2.

## Related Guides And Next Steps

- [Layouts](./layouts.md) selects content versus blocks and TOC precedence.
- [Parts](./parts.md) owns the actual rendered media and controls.
- [Roadmap](./roadmap.md) separates the requested future editor from this UI union.
