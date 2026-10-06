---
id: zero.frontend.components.public-pages.code-block-rendering
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: code-highlighting-and-server-rendering
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

# Code Highlighting, Server Preparation And Markdown

[Public-page index](./index.md) · [CodeBlock overview](./code-block.md)
· [Frontend index](../../index.md) · [Documentation index](../../../index.md)

The same escaped source/transform implementation runs in browser examples,
Bun SSR, and compiled Markdown fences. Source strings are presentation data,
not HTML, JavaScript to evaluate, database instructions, or file paths to open.

## Minimal Browser Example

```tsx
import { CodeBlock } from '@zero/framework/components/code-block';

export function ChangeExample() {
  const code = [
    'const before = 1; // [!code --]',
    'const after = 2; // [!code ++]',
    'console.log(after); // [!code focus]',
  ].join('\n');
  return <CodeBlock code={code} language="ts" filename="change.ts"
    meta="/after/" lineAnchors="change-example" startLine={10} wordWrap />;
}
```

Escaped fallback renders immediately. Client Shiki is loaded only when needed;
an obsolete request cannot replace a newer source. Unsupported languages or
theme errors retain fallback and emit `FRONTEND_CODE_HIGHLIGHT_FAILED`.
The callback receives the error/file; use safe diagnostics without dumping
source or user payloads. The pure helpers throw so their caller can choose a
publication policy explicitly.

## Options And Notations

`CodeBlockHighlightOptions` is shared by the convenience component,
`CodeBlockCode`, and pure highlighter. Explicit presentation controls win over
fence metadata. `highlightWords` adds literal terms to the fence's word list;
duplicates are removed.

| Option | Type / default / behavior |
| --- | --- |
| `theme` | Optional `{light:string,dark:string}`; absent uses Zero CSS syntax variables |
| `meta` | Optional raw fence metadata string; no source evaluation |
| `highlightLines` | Optional readonly positive source-relative one-based line numbers |
| `highlightWords` | Optional readonly literal strings; not regular expressions |
| `annotations` | `true`; language/comment-aware Shiki notations |
| `lineAnchors` | Optional document-unique prefix for real line fragment links |
| `showLineNumbers` | Pure helper metadata default false; convenience CodeBlock default true |
| `startLine` | Positive safe integer, default 1; display/anchor numbers only |
| `wordWrap` | Default false; wrap in viewport instead of widening the page |
| `transformers` | Optional readonly **trusted code-owned** Shiki transforms |
| `transformerIdentity` | Optional nonblank string, at most 256 characters; versioned identity for the entire portable custom configuration |

Additional rendering props: `highlighted` accepts a trusted
`CodeBlockHighlightResult`; `highlightOnClient=false` disables browser
highlight work. `CodeBlockCode.onHighlightError(error)` is its standalone
notification; `CodeBlock.onHighlightError(error,file)` also receives the file.

Fence forms are `filename="server.ts"` / `title="server.ts"`,
`lineNumbers` / `showLineNumbers`, `startLine=10`, `wrap`,
`prefix="example"`, `{1,3-5}`, and literal `/word/`. Highlight ranges are
bounded to 100,000; unsafe/reversed/invalid numbers are ignored. Compilers should
pass the actual source line count to `readCodeBlockMetadata(options,maxLine)`
to avoid retaining large arrays for tiny fences. The renderer does this itself.
Literal word options are deduplicated and bounded to 2048 distinct words and
20,000 decorations per render. Oversized expansion raises a safe highlighter
error, using the same browser or explicit publishing fallback policy.

Shiki comment markers support `[!code highlight]` / `[!code hl]`,
`[!code ++]` / `[!code --]`, `[!code focus]`, and `[!code word:term]`.
Recognized annotations disappear from displayed code; a marker inside a string
is ordinary source. `annotations=false` leaves markers visible. Focused
examples restore other lines' opacity/clarity on hover or keyboard focus.

Line links use prefix plus displayed number, for example `#example-l10`.
Keep prefixes unique across every block/file in an article. Whitespace becomes
`-`; ids are escaped and fragment urls encoded. Zero's real anchor elements
are inserted after annotation parsing, preserving Shiki token assumptions.

## Colored SSR Before JavaScript

This complete async server helper returns ordinary props, not an async React
component. It does not start an app, access a database, or call a provider:

```tsx
import { prepareCodeBlock } from '@zero/framework/components/code-block/server';
import { CodeBlock } from '@zero/framework/components/code-block';

export async function preparedExample() {
  const props = await prepareCodeBlock({
    code: 'const enabled = true;',
    language: 'ts',
    filename: 'server.ts',
    lineAnchors: 'server-example',
  });
  return <CodeBlock {...props} highlightOnClient={false} />;
}
```

`prepareCodeBlock(props, preparation?)` pre-highlights all files and preserves
the original component props. `preparation.fallbackOnError` defaults false;
the helper is strict unless a publisher deliberately opts into escaped fallback.
`onHighlightError(error,file)` is an optional app-owned async/sync server/build
logging boundary. For user-authored docs, use fallback plus that warning callback
so an unsupported fence stays readable without hiding diagnostics.

Initially selected source, colors, and line links work without JavaScript.
File switching and clipboard actions require client JavaScript. Server/browser
rendering uses one shared Shiki Oniguruma engine; default syntax and ANSI normal,
bright, and dim colors come from tokens, not a fixed vendor palette.

Pure imports avoid React rendering:

- `@zero/framework/components/code-block/server`: `prepareCodeBlock`,
  `PrepareCodeBlockOptions`, file/props/highlight option/result types.
- `@zero/framework/components/code-block/highlight`:
  `highlightCodeBlock(code,language?,options?)`,
  `highlightCodeBlockHtml(code,language,theme?,options?)`,
  `buildFallbackCodeBlockHtml(code,options?)`, `normalizeCodeBlockLineHtml`, highlight/theme types.
- `@zero/framework/components/code-block/metadata`:
  `readCodeBlockMetadata`, `parseCodeBlockLineRanges`,
  `codeBlockHighlightKey`, `normalizeStartLine`, and `CodeBlockMetadata`.

A result has `{code,language,html,key,transformerIdentity?}`. Its key is a non-security option/source
fingerprint. A matching source/options result avoids duplicate client work;
stale results fall back. Only pass HTML/results produced by the trusted build/
rendering path: this is **not** an authored-HTML sanitizer, and trusted custom
transformers can deliberately create markup. Never accept result objects or
transform functions straight from an untrusted request.

## Portable Custom Transformer Results

Custom transformer names are descriptive, not cache identities. Add
`transformerIdentity` when preparing custom output for serialization or a
different runtime. It identifies the **entire** trusted custom configuration;
change its version when behavior changes. The result echoes that identity.

```tsx
// Server/build fragment: trustedTransforms is application-owned code.
const prepared = await prepareCodeBlock({
  code: source,
  language: 'ts',
  transformers: trustedTransforms,
  transformerIdentity: 'article-transformers:v2',
});

// Browser fragment: custom executable hooks can remain server-only.
<CodeBlock code={prepared.code} language={prepared.language}
  highlighted={prepared.highlighted} transformerIdentity="article-transformers:v2"
  highlightOnClient={false} />;
```

Match source, language and the remaining presentation options as well as the
identity. A browser that consumes prepared output needs only the identity, not
the executable hooks. If it must re-highlight different source, it needs the
corresponding trusted hooks or a newly prepared result.

Live results retain a private hook-function binding separately from the portable
key. Different functions sharing a name cannot reuse old output; replacing a
hook invalidates its live result even if the array and portable identity stay
unchanged. Options and each file's source are captured before asynchronous
preparation, and obsolete client completions cannot replace the current render.
When closed-over behavior changes without replacing a hook, update the explicit
identity to start a new configuration generation.

Ordinary blocks and existing custom-transformer calls need no migration.
Without an identity, custom output is supported locally but is not a portable
serialized result. Neither an explicit identity nor a matching key sanitizes
HTML or turns untrusted transforms into safe code.

## Markdown And Trusted Pre Adapters

`CodeBlockMarkdown` receives a parsed fence as code/language/raw meta plus normal
CodeBlock options. Missing language means plain text; fence line numbers are
opt-in rather than the convenience component's default. This adapter does not
parse arbitrary Markdown, execute MDX, or fetch content.

`CodeBlockPre` adapts an already-compiled **trusted** React/rehype pre tree.
Its native pre classes/events/style/attributes remain on the actual pre;
`wrapperClassName` targets the outer shell. `copyButton` defaults true.
`showLineNumbers`, `startLine`, and `wordWrap` control presentation; upstream
`shiki-line-numbers` / `shiki-word-wrap` classes are recognized if explicit
options are omitted. Existing line-number metadata is preserved, or assigned
to ordinary `.line` nodes. Decorative anchors do not enter copied source;
adjacent lines produce exactly one newline. Do not inject raw authored HTML or
executable MDX into the trusted-tree surface.

## Compatibility, Styling And Verification

Existing named light/dark theme overrides remain supported. They deliberately
opt out of token syntax colors; prefer `--zero-code-token-*` overrides for
theme-wide consistency. See [design lanes](../../design-system/lanes.md).
Browser/source preparation does not mutate schema, require migrations, or
relax a route's authority. Public examples must not contain production secrets,
sensitive records, or code not already authorized for the viewer.

Focused synthetic source checks cover escapes, bounded metadata, annotation/
anchor ordering, concurrent rendering, stale SSR results, same-name/live-hook
replacement, portable identities, captured preparation options, explicit theme pairs,
ANSI roles, clipboard/file behavior, real light/dark/mobile paint, and no-JS SSR.
Those checks are recorded as working-source evidence, not a released archive or
every browser/Guardian/Fabric combination.

## Related Guides And Next Steps

- [Composition](./code-block-composition.md) owns native props, context, file tabs,
  and clipboard lifecycle.
- [Examples/preferences](./code-block-examples.md) owns reusable install snippets.
- [Observability](../../../backend/observability/index.md) explains app-owned
  logging/sinks; renderers do not replace server authorization or redaction.
