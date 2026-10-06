# CodeBlock

Zero's shared CodeBlock family provides the complete composable code-example
experience: a shell, header, title/icon groups, bounded code viewport, clipboard
tools, file tabs, compact snippets, package-manager examples, and shared Shiki
highlighting. It adapts the [pheralb Code Blocks](https://code-blocks.pheralb.dev/)
interaction model to Zero's existing controls, icons, observability, and public
design-token lane. It does not install a second UI or highlighting engine.

[Frontend index](./README.md) · [Public components](./public-components.md#code-block)
· [Design tokens](./design-tokens.md) · [Component inventory](./component-inventory.md)

## Choose a composition

| Need | Public surface |
| --- | --- |
| Ready-made code example | `CodeBlock` with `code`, `language`, and optional `filename` |
| Multiple files | `CodeBlock` with `files`; keyboard-accessible tabs are built in |
| Custom header/actions | `CodeBlock` children plus the composable parts |
| Entirely custom shell | `CodeBlockRoot`, `CodeBlockHeader`, `CodeBlockContent`, `CodeBlockCode` |
| Compact copyable command | `CodeBlockInline` |
| Copy icon, label, or animated label | `CodeBlockCopyButton`, `CodeBlockCopyText` |
| Install/execute examples | `CodeBlockPackageManager` in `tabs` or `select` mode |
| Standalone manager selector | `CodeBlockPackageManagerSelector` |
| Colored source before JavaScript | `prepareCodeBlock` followed by ordinary synchronous React SSR |
| Compiled Markdown fence | `CodeBlockMarkdown` |
| Already-highlighted trusted React/rehype pre tree | `CodeBlockPre` |
| Standalone client highlighting | `CodeBlockCode` / `CodeBlockClient` |

Use the ready-made component first. Reach for parts when the page needs a
different header, additional actions, or a specialized content composition.

The upstream system is mapped onto this same Zero implementation, not retained
beside a second legacy renderer:

| Upstream feature family | Zero mapping |
| --- | --- |
| CodeBlock shell/header/group/icon/content | Existing `CodeBlock` convenience facade and its composable parts |
| CopyButton / CopyTextMorph | `CodeBlockCopyButton` / `CodeBlockCopyText`, with awaited Zero clipboard lifecycle |
| Client Shiki renderer | `CodeBlockCode` / `CodeBlockClient`, shared transforms and escaped fallback |
| Server highlighting composition | `prepareCodeBlock()` plus synchronous `CodeBlock`, compatible with Zero's Bun SSR |
| MDX pre composition | `CodeBlockPre` for trusted compiled trees; `CodeBlockMarkdown` for parsed fences, without executing MDX |
| InlineCode / multi-tabs | `CodeBlockInline` / existing `CodeBlock files` and `CodeBlockFiles` |
| Package-manager tabs/select/persistence | `CodeBlockPackageManager`, selector and optional shared preference hook |
| Metadata, line numbers/wrap/anchors, line/word highlights, diff/focus | One shared Shiki highlighter and tokenized stylesheet |
| Alternate Prism/SugarHigh examples | The same capabilities through Shiki; no duplicated engine/UI dependency |

## Imports

```tsx
import {
  CodeBlock, CodeBlockRoot, CodeBlockHeader, CodeBlockGroup, CodeBlockTitle,
  CodeBlockIcon, CodeBlockFiles, CodeBlockContent, CodeBlockCode,
  CodeBlockCopyButton, CodeBlockCopyText, CodeBlockInline,
  CodeBlockPackageManager, CodeBlockPackageManagerSelector,
  CodeBlockMarkdown, CodeBlockPre,
} from '@zero/framework/components/code-block';
```

The family is also available from `@zero/framework/react`. Server/build tools
can avoid importing React components:

```ts
import { prepareCodeBlock } from '@zero/framework/components/code-block/server';
import { highlightCodeBlock } from '@zero/framework/components/code-block/highlight';
import { readCodeBlockMetadata } from '@zero/framework/components/code-block/metadata';
```

Source-owned apps can use `zero add components/code-block`. Install the same
Shiki and transformer versions used by the framework if maintaining copied
source; these are framework dependencies in normal package mode.

## Ordinary examples and files

```tsx
<CodeBlock
  filename="server.ts"
  language="ts"
  code={`import { createApp } from '@zero/framework/server';
const app = await createApp(config);`}
  showLineNumbers
/>
```

```tsx
<CodeBlock
  files={[
    { id: 'server', filename: 'server.ts', language: 'ts', code: serverSource },
    { id: 'client', filename: 'page.tsx', language: 'tsx', code: clientSource },
  ]}
  defaultFileId="server"
  minLines={12}
  onCopy={file => recordCopy(file.id)}
/>
```

Give every file a unique, stable `id`. A file's `label` can replace the displayed
tab label. `filename` falls back to fence `title`/`filename` metadata. Tab arrows,
Home/End, focus, and selected-panel semantics use the installed Radix behavior.
For controlled state, pass `activeFileId` and update it from `onFileChange`.
An invalid active id displays the first file and reports that fallback once.

`minLines` reserves viewport height using the code typography/padding tokens.
`contentKey` and `contentClassName` remain available for caller-owned transitions;
they affect the inner code wrapper rather than remounting the whole shell.

## Custom composition

When `CodeBlock` receives children, it supplies source/file/highlight context but
does not render its default header or viewport. Parts can inherit that context:

```tsx
<CodeBlock code={source} language="ts" filename="config.ts">
  <CodeBlockHeader>
    <CodeBlockGroup>
      <CodeBlockIcon />
      <CodeBlockTitle />
    </CodeBlockGroup>
    <CodeBlockGroup>
      <YourExampleAction />
      <CodeBlockCopyButton variant="morph" />
    </CodeBlockGroup>
  </CodeBlockHeader>
  <CodeBlockContent minLines={10}>
    <CodeBlockCode />
  </CodeBlockContent>
</CodeBlock>
```

Use `CodeBlockFiles` in a custom header to retain built-in file controls. Each
part forwards its native element props. `CodeBlockIcon` uses Zero's terminal
icon by default; provide `iconName` from Zero's icon registry or an `icon` React
node for a more specific symbol. No additional file-icon package is required.

An independent composition can use `CodeBlockRoot`. Supply source explicitly
to `CodeBlockCode` and `content` to its `CodeBlockCopyButton` when no parent
`CodeBlock` context exists. Apply line-number/wrap options consistently to the
root and code renderer when composing them independently.

## Highlights, focus, diffs, and fence metadata

```tsx
<CodeBlock
  code={`const previous = 1; // [!code --]
const current = 2; // [!code ++]
console.log(current); // [!code focus]
const important = true; // [!code highlight]`}
  language="ts"
  meta='filename="change.ts" /current/'
  lineAnchors="change-example"
  startLine={10}
  wordWrap
/>
```

| Control | Behavior |
| --- | --- |
| `highlightLines={[1, 3]}` or fence `{1,3-5}` | Highlights source-relative, one-based lines |
| `highlightWords={['createApp']}` or fence `/createApp/` | Highlights literal matches, not executable regular expressions |
| `[!code highlight]` / `[!code hl]` | Marks a line; recognized comment annotations are removed from displayed code |
| `[!code ++]` / `[!code --]` | Added/removed backgrounds and markers |
| `[!code focus]` | Dims/blurs other lines; hovering or focusing the code restores readability |
| `[!code word:term]` | Shiki's comment-notation word highlighting |
| `annotations={false}` | Shows annotation comments as ordinary source instead of interpreting them |
| `showLineNumbers` or fence `lineNumbers` / `showLineNumbers` | Line-number display; explicit props win |
| `startLine={10}` or fence `startLine=10` | Display/anchor numbering begins at that positive integer |
| `wordWrap` or fence `wrap` | Wraps long lines inside the viewport instead of widening the page |
| `lineAnchors="example"` or fence `prefix="example"` | Real, focusable `#example-l10` line links |
| Fence `title="server.ts"` / `filename="server.ts"` | Caption metadata; an explicit `filename` wins |

Use a document-unique anchor prefix for every block and file. Whitespace in
prefixes becomes `-`; ids are HTML-escaped and fragment URLs are encoded.
Highlight line ranges are bounded to 100,000, and invalid/reversed/unsafe
ranges are ignored. Compilers should call `readCodeBlockMetadata(options,
actualLineCount)` so tiny fences do not retain huge highlight arrays.
Literal word options are deduplicated and bounded to 2048 distinct words and
20,000 decorations per render. Exceeding these expansion budgets raises a safe
highlighter error; the normal browser/publishing fallback policy still applies.

Notation matching is language/comment-aware, not a global text replacement.
A marker inside a string is ordinary source. Raw source is still what ordinary
`CodeBlock` copy actions copy, including author-written annotation comments.
Pass clean `content` to a custom copy button if an example needs different
copy text. A trusted pre adapter copies its displayed text, excluding line-link
and explicitly decorative nodes.

## Copy lifecycle and compact blocks

```tsx
<CodeBlockInline code="bun add @zero/framework" language="bash" />
<CodeBlockCopyButton content={source} variant="icon" />
<CodeBlockCopyButton content={source} variant="text" />
<CodeBlockCopyText content={source} size="xs" />
```

Copy actions await Zero's clipboard helper, disable duplicate clicks while the
operation is pending, and show success only after the write completes. A
failed write retains an available retry action and emits
`FRONTEND_COPY_FAILED`; `onCopyError` receives the clipboard error. A consumer
`onClick` that prevents default also prevents the copy. Native props and refs
remain available.

`copyLabel`, `copiedLabel`, `resetAfterMs`, `size`, and `iconSize` customize the
control. The default timeout, typography, icon dimensions, and morph transition
come from CodeBlock tokens. Morph and CSS transitions respect reduced motion,
including a preference change after mount. A changed source does not retain
the previous source's copied badge. Original `CodeBlock.onCopy(file)` remains
the convenience component's success callback.

## Package-manager blocks and optional preference

```tsx
<CodeBlockPackageManager command="@zero/framework" type="install" />
<CodeBlockPackageManager command="some-tool init" type="dlx" mode="select" />
<CodeBlockPackageManager
  command="@zero/framework"
  mode="tabs"
  managers={['bun', 'npm', 'pnpm', 'yarn']}
  persist="my-docs:package-manager"
/>
```

Both modes use the same source/copy/highlight path. Bun is the default, and
`defaultValue` selects another initial manager. `value`/`onValueChange` provide
controlled state. `type` supports `install`, `dlx`, and `run`; `command` is the
remaining argument text, not a shell command to execute. Commands are displayed
and copied only. Use explicit file examples for commands needing custom
manager-specific arguments.

`persist` is off by default. `true` opts into the shared
`zero:code-block:package-manager` local-storage key; a string selects an
application-owned key. Opted-in examples share updates in the same tab and
receive other-tab storage events. SSR starts with the configured default;
the saved preference is read after hydration. An explicit controlled value
remains authoritative. Blocked storage falls back to in-memory use and emits
`FRONTEND_CODE_PREFERENCE_FAILED`, without logging code or credentials.

Use `useCodeBlockPackageManager` and `CodeBlockPackageManagerSelector` when a
page needs a selector outside a ready-made block. `getCodeBlockPackageCommand`
and `CODE_BLOCK_PACKAGE_MANAGERS` are available for custom compositions.

## Server rendering and compiled Markdown

```tsx
import { prepareCodeBlock } from '@zero/framework/components/code-block/server';
import { CodeBlock } from '@zero/framework/components/code-block';

const props = await prepareCodeBlock({
  code: source,
  language: 'ts',
  filename: 'server.ts',
  lineAnchors: 'server-example',
});

// Ordinary synchronous React SSR, not an async React component.
const example = <CodeBlock {...props} highlightOnClient={false} />;
```

Server-prepared source is colored before JavaScript runs. File tabs/copy still
require JavaScript for interaction; the initially selected file, source text,
and real line links remain usable without it. Server and browser paths use
the same Shiki transforms, token theme, metadata validation, and escaped source.
Zero uses Shiki's Oniguruma engine consistently; browser support does not depend
on Node APIs or a second highlighter.

`prepareCodeBlock` is strict by default. Publishing tools can explicitly keep
unsupported fences readable and report diagnostics through their own logger:

```ts
const props = await prepareCodeBlock(fenceProps, {
  fallbackOnError: true,
  onHighlightError: (error, file) => reportFenceWarning(error, file.language),
});
```

`highlightCodeBlock(code, language, options)` is the lower-level async helper
returning `{ code, language, html, key, transformerIdentity? }`; `highlightCodeBlockHtml` preserves
the older string-returning helper and named theme arguments. Results are
trusted renderer outputs, not a sanitization API for authored HTML. Only pass
`highlighted` results generated by your trusted Zero rendering/build path.
Unknown languages/themes throw from pure helpers; browser components use
escaped fallback and `FRONTEND_CODE_HIGHLIGHT_FAILED` instead. Stale
pre-highlighted source/options are rejected and older async replies cannot
replace the current example.

```tsx
<CodeBlockMarkdown
  code={fence.value}
  language={fence.language}
  meta={fence.meta}
/>
```

`CodeBlockMarkdown` consumes an already-parsed fence. It does not parse arbitrary
Markdown or execute MDX. `CodeBlockPre` adapts a trusted React/rehype pre tree;
native `pre` props/classes stay on the actual `pre`, while `wrapperClassName`
targets the shell. It preserves existing numbered-line metadata or inserts it
for ordinary `.line` nodes. `showLineNumbers`, `startLine`, and `wordWrap` are
available; the corresponding upstream Shiki classes are recognized when no
explicit option is supplied. Never inject user-authored HTML or executable MDX
into these adapter surfaces.

## Tokens and extension boundaries

The default syntax palette uses `--zero-code-token-*`, not fixed GitHub colors.
Public foreground/background/border/ring roles drive surrounding controls;
the shared platform mono font drives code. `--zero-code-*` tokens cover font
metrics, row padding, header/action sizes, gutters, radius, focus/diff/highlight
colors, wrapping, viewport height, copy reset, and motion. They live in Zero's
central stylesheet and follow existing light/dark semantic tokens.

Existing `theme={{ light: 'github-light', dark: 'github-dark-default' }}` overrides
remain supported. A named external theme deliberately opts out of the default
token syntax palette. Override CodeBlock variables instead when theme-wide
consistency is required. ANSI base/dim colors are tokenized as well.

`transformers` accepts additional **trusted code-owned** Shiki transformers.
They can change generated HTML and are not an untrusted extension mechanism.
Keep them deterministic across server/client and coordinate transformer order
when manipulating token/line trees.

### Prepared custom-transformer output

Use `transformerIdentity` when custom-transformer output crosses runtimes or is
serialized. It is an optional nonblank string of at most 256 characters that
identifies the **entire** trusted custom configuration, not just a transformer
name. Change it when that configuration's behavior changes:

```tsx
// Server/build fragment: trustedTransforms is owned by your application.
const props = await prepareCodeBlock({
  code: source,
  language: 'ts',
  transformers: trustedTransforms,
  transformerIdentity: 'example-transformers:v2',
});

// Browser fragment: executable custom transforms need not be shipped here.
<CodeBlock code={props.code} language={props.language}
  highlighted={props.highlighted} transformerIdentity="example-transformers:v2"
  highlightOnClient={false} />;
```

Keep the ordinary source, language and presentation options consistent too.
Prepared results echo the identity; source/options/identity mismatches reject
the result. Within a runtime, results also retain a private binding to the
actual hook functions: different hooks with the same name, or a replaced hook
under an unchanged identity, cannot reuse the previous live result. Highlighting
captures options before yielding, and obsolete client completions are ignored.

Existing uses need no new prop or migration. Custom transformers without an
identity still work locally; do not serialize their prepared results for a
different runtime. If a function's closed-over behavior changes without replacing
the function, update the identity. The identity and result key are stale-content
checks, not proof that arbitrary HTML is safe.

No Prism, SugarHigh, Base UI, MDX runtime,
or secondary icon pack is required by Zero's shared implementation.

[Back to public components](./public-components.md#code-block)
· [Frontend index](./README.md)
