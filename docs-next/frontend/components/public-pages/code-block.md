---
id: zero.frontend.components.public-pages.code-block
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: highlighted-code-block
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

# Escaped, Highlighted Code Examples

[Public-page index](./index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

Zero's complete code-example family adapts pheralb Code Blocks to existing
Zero controls, icons, tokens, and one shared Shiki renderer. Use the ready-made
component for ordinary code/files or its additive parts for custom headers,
compact copyable commands, package-manager selection, and compiled Markdown.
Source is presentation data: these components never execute examples, install
packages, open application files, or write database records.

```tsx
import { CodeBlock } from '@zero/framework/components/code-block';

export function SampleCode() {
  return <CodeBlock filename="example.ts" language="ts" code="const example = 1;" minLines={5} />;
}
```

The same family is exported from root and `@zero/framework/react`. No client,
Guardian, database, or provider is required to render an ordinary public example;
normal Zero styles are required. Public colors are visual roles, not route-access
permissions. Render only already-authorized text and never expose production
credentials, private code, or sensitive records through a public example.

## Feature Guides

- [Composition and controls](./code-block-composition.md): every part/prop,
  controlled file tabs, native refs, bounded viewport and awaited clipboard.
- [Rendering/highlights/SSR](./code-block-rendering.md): exact metadata/notations,
  token syntax, anchors/wrap, server preparation and trusted Markdown/pre adapters.
- [Compact examples and preferences](./code-block-examples.md): inline/morph,
  package-manager tabs/select, opt-in storage and standalone helper/hook.

## Upgrade And Scope

| Upstream family | Zero mapping into this same renderer |
| --- | --- |
| Shell/header/group/icon/content | CodeBlock convenience facade and composable parts |
| Copy icon / animated copy label | Awaited CodeBlockCopyButton / CodeBlockCopyText |
| Client highlighter | CodeBlockCode / CodeBlockClient and escaped fallback |
| Server highlighter/composition | prepareCodeBlock plus synchronous CodeBlock, fitting Bun SSR |
| MDX pre / inline / file tabs | Trusted CodeBlockPre, compiled-fence CodeBlockMarkdown, CodeBlockInline and existing files/context |
| Package tabs/select/persistence | CodeBlockPackageManager, standalone selector and opt-in preference hook |
| Metadata/numbers/wrap/anchors/highlights/diff/focus | One shared Shiki implementation and tokenized stylesheet |
| Alternate Prism/SugarHigh examples | Same capability through Shiki, avoiding duplicated engine/UI packages |

Existing `code`, `files`, default/controlled file ids, original file callbacks,
copy controls, named theme pairs, and content transition props remain supported.
No database migration or forced application rewrite is introduced. The default
syntax theme now uses `--zero-code-token-*`; an explicit named theme still opts
into its own palette. Clipboard operations now await success and guard pending
clicks. File tabs retain source selection while adding proper keyboard semantics.
The old public renderer and unused source-local Animate UI Code/CodeTabs/CodeBlock
chain are removed, including the obsolete private import alias. There is one
official code-rendering family; generic tabs/copy controls used elsewhere remain.

Escaped fallback remains readable during client highlighting or failure.
`prepareCodeBlock()` can produce colored code before synchronous Bun SSR;
readers without JavaScript retain the selected source and working line links.
File switching/copy require JavaScript. Server publishing chooses strict failure
or an explicit escaped fallback with its own warning callback. The renderer does
not sanitize arbitrary authored HTML or execute MDX.

Custom-transformer preparation has an additive `transformerIdentity` option for
portable serialized output. Ordinary calls remain unchanged; live hook bindings
reject stale custom results even when their descriptive names match. See the
[portable transformer contract](./code-block-rendering.md#portable-custom-transformer-results)
before sending prepared custom HTML to a browser without its executable hooks.

This page describes the authorized 2.5.0 working-source upgrade based on 2.4.0
main, not a previously shipped 2.1.1 feature set. Focused installed archive and
compiled-reader checks are recorded in the
[qualification ledger](../../../_work/audits/docs-plugin-qualification.md);
they do not imply registry publication or a clean release commit.
Source boundaries are the [public family](../../../../src/components/code-block/index.ts),
[shared highlight path](../../../../src/components/code-block/code-block-highlight.ts),
and [server preparation](../../../../src/components/code-block/code-block-server.ts).

## Related Guides And Next Steps

- [Public-page configuration](./configuration.md) distinguishes props from
  startup/environment/Doctor configuration.
- [Text](../text/index.md) provides streamed prose, not highlighted source.
- [Sensitive display](../sensitive-display.md) handles already-authorized keys;
  masking is not permission enforcement.
- [Design tokens](../../design-system/tokens.md) owns public code/surface roles
  and the centrally themed syntax/metrics/motion variables.
