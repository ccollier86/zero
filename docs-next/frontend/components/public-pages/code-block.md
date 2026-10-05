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

# Escaped, Highlighted Code Examples

[Public-page index](./index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

Import CodeBlock,CodeBlockProps,CodeBlockFile and CodeBlockTheme from
`@zero/framework/components/code-block`, root or React. The component presents
source; it never evaluates examples or writes application files.

```tsx
import { CodeBlock } from '@zero/framework/components/code-block';

export function SampleCode() {
  return <CodeBlock filename="example.ts" language="ts" code="const example = 1;" minLines={5} />;
}
```

CodeBlockProps extends div attributes except native onCopy. Single-file code,
language='tsx' and filename are optional. A nonempty files array takes precedence;
each CodeBlockFile has id,language,code and optional filename/label. Empty files
falls back to single-file composition. Use unique stable file IDs.

Other options: defaultFileId (initial uncontrolled selection),activeFileId
(controlled selection),showLineNumbers=true,copyButton=true,minLines,
theme={light:'github-light',dark:'github-dark-default'},onFileChange(file),
onCopy(file),onHighlightError(error,file),headerClassName,viewportClassName,
contentKey,contentClassName,className. Unknown active IDs display the first file;
callbacks may report that fallback. Controlled parents own the selected ID.
minLines normalizes finite values to at least one reserved row for stable tabs.

SSR/hydration initially uses escaped plain code with line spans. The client lazily
runs Shiki; source text is not injected as raw HTML. Unsupported language/theme
or highlighting failure retains escaped fallback and emits the standard code
highlight event. onHighlightError receives the caller-owned file and cause;
keep callback diagnostics safe. The public component does not expose private
highlighter helper imports as an app contract.

The copy action copies the active file's complete code, reports success through
onCopy, and uses 1600ms copy feedback. Browser clipboard permission is required.
Never place production credentials/PHI/private source into public examples; a
code renderer is not a redactor, secret guard or permission check. Syntax language
and filename are presentation metadata, not executable instructions.

## Related Guides And Next Steps

- [Text](../text/index.md) supplies plain streamed copy, not highlighted source.
- [Sensitive display](../sensitive-display.md) handles authorized key presentation.
- [Design tokens](../../design-system/tokens.md) supplies public code/surface styling.
