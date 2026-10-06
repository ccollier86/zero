---
id: zero.frontend.components.public-pages.code-block-composition
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: code-example-composition
maturity: supported
applies_to: ["2.5.0 working source; focused installed/compiled qualification recorded"]
modes: [browser, SSR, public pages]
reviewed_against:
  package: "@zero/framework"
  version: "2.5.0"
  commit: "636b1c01b3484317df56ce624c7cd57976ee417c"
  snapshot: dirty
  date: "2026-10-06"
  evidence_level: source-observed
---

# CodeBlock Composition And Controls

[Public-page index](./index.md) · [CodeBlock overview](./code-block.md)
· [Frontend index](../../index.md) · [Documentation index](../../../index.md)

Use the ready-made `CodeBlock` for ordinary examples. Its `code`/file API keeps
the surrounding UI stable while the selected file or highlighted content changes.
For a custom layout, keep its context and replace its default children with
Zero's composable parts.

## Ready-Made And Custom Composition

This complete React component needs normal Zero styles but no client/provider,
server service, database, or Guardian session:

```tsx
import {
  CodeBlock, CodeBlockHeader, CodeBlockGroup, CodeBlockIcon,
  CodeBlockTitle, CodeBlockContent, CodeBlockCode, CodeBlockCopyButton,
} from '@zero/framework/components/code-block';

export function CodeExample() {
  return <CodeBlock code="const enabled = true;" language="ts" filename="config.ts">
    <CodeBlockHeader>
      <CodeBlockGroup><CodeBlockIcon /><CodeBlockTitle /></CodeBlockGroup>
      <CodeBlockCopyButton variant="morph" />
    </CodeBlockHeader>
    <CodeBlockContent minLines={8}><CodeBlockCode /></CodeBlockContent>
  </CodeBlock>;
}
```

Supplying children removes only the default ready-made header/content, not the
source/highlighting context. `CodeBlockCode`, `CodeBlockCopyButton`,
`CodeBlockTitle`, `CodeBlockIcon`, and `CodeBlockFiles` can inherit that context.
Use `CodeBlockFiles` in custom headers for file selection. The independent
`CodeBlockRoot` is just a tokenized native div shell; without a context parent,
give the code renderer its `code`/`language` and the copy button its `content`.
Set root and renderer line-number/wrap options consistently.

## Public Parts

All names below come from `@zero/framework/components/code-block`, root, or
`@zero/framework/react`. Native props/classes/refs are retained.

| Part | Element / extra contract |
| --- | --- |
| `CodeBlockRoot` | div; `showLineNumbers`, `wordWrap`; shell only |
| `CodeBlockHeader` | div; fixed surrounding toolbar outside the code scroll area |
| `CodeBlockGroup` | div; tokenized horizontal grouping |
| `CodeBlockTitle` | span; explicit children or inherited label/filename/language |
| `CodeBlockIcon` | span; `language` metadata, `iconName` from Zero registry, or custom `icon`; default terminal |
| `CodeBlockFiles` | file-label group or Radix tab list; requires CodeBlock context |
| `CodeBlockContent` | div; `minLines`, native `style`; bounded scroll viewport |
| `CodeBlockCode` / `CodeBlockClient` | div; [source and highlight options](./code-block-rendering.md) |
| `CodeBlockCopyButton` | Zero Button with [awaited clipboard lifecycle](#clipboard-lifecycle) |

Corresponding named Props types are exported for root/header/group/title/icon/
content/code/copy parts. `CodeBlockFiles` uses native div props.

## CodeBlock And File Options

| Option | Default / behavior |
| --- | --- |
| `code` | Empty string for a single file |
| `language` | `tsx`; language id for Shiki, not executable code |
| `filename` | Explicit value, then fence title/filename, then `example.ts` |
| `files` | Nonempty readonly array takes precedence over single code; empty array falls back |
| `defaultFileId` | Initial uncontrolled file id; otherwise first file |
| `activeFileId` | Optional controlled id; caller updates it through `onFileChange` |
| `onFileChange(file)` | Selection/fallback notification, not persistence |
| `showLineNumbers` | `true` in the convenience component |
| `copyButton` | `true`; copy control in default composition |
| `copyVariant` | `icon`, `text`, or `morph`; default `icon` |
| `onCopy(file)` | Called only after clipboard succeeds |
| `header` | `true`; `false` makes a compact headerless snippet |
| `actions` | Optional React tools next to copy in the default header |
| `minLines` | No reserved minimum unless provided; finite values floor/clamp to at least one |
| `headerClassName` / `viewportClassName` | Corresponding default-composition class slots |
| `contentKey` / `contentClassName` | Caller-owned inner code transitions/classes |
| `children` | Replace ready-made composition while retaining context |
| `className`, native div props | Shell attributes; native `onCopy` is replaced by file success callback |

Each `CodeBlockFile` needs a unique stable `id`, `code`, and `language`;
optional `label`, `filename`, `meta`, and trusted `highlighted` are supported.
An explicit label wins in the tab. Changing source never means executing it.

File tabs use Radix's roving focus, arrows/Home/End, and tab/panel relationships.
An invalid active id displays the first file and reports fallback once.
Controlled callers own their selected id. `minLines` uses code font/line/padding
tokens; it does not hard-code an unrelated pixel height. The toolbar stays
available while code scrolls vertically/horizontally inside its viewport.

## Clipboard Lifecycle

The copy button's `content` overrides inherited source. Its public controls are
`variant` (`icon`/`text`/`morph`), `size` (`xs`/`sm`), `iconSize`,
`resetAfterMs`, `copyLabel`, `copiedLabel`, `onCopy(content)`,
`onCopyError(error)`, children, and native button props. Default labels are
“Copy code” / “Code copied”; default reset reads `--zero-code-copy-reset-ms`
(1600ms central default). A consumer's prevented `onClick` suppresses copying.

The action awaits Zero's clipboard helper, blocks duplicate clicks while pending,
and reports success only after the write. Failure keeps retry possible and emits
`FRONTEND_COPY_FAILED`; no source/credential value is included in its metadata.
The copied badge is bound to the actual copied value, so another file does not
inherit success. Copy/morph/CSS transitions respect reduced motion. Parent
`CodeBlock.onCopy(file)` and the button's own success callback remain distinct.

Ordinary blocks copy complete raw input, including author annotation comments.
Use explicit clean `content` if displayed annotations should not be copied.
Compiled pre adapters instead copy the trusted tree's displayed text, excluding
decorative line links/hidden nodes. This component is not a secret-redaction
boundary: [authorized sensitive display](../sensitive-display.md) has a different
purpose, and backend authority must be enforced before data reaches any renderer.

## Related Guides And Next Steps

- [Rendering/highlights](./code-block-rendering.md) owns source escaping,
  annotations, server preparation, and Markdown adapters.
- [Examples/preferences](./code-block-examples.md) composes compact commands and
  package-manager controls from these same parts.
- [Design tokens](../../design-system/tokens.md) owns the public visual lane and
  centrally defined `--zero-code-*` roles.
