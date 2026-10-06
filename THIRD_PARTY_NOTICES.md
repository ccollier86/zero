# Third-Party Notices

Zero includes or adapts the following third-party software. The notices below
apply to those portions and do not change the licensing of unrelated Zero
code.

## Pheralb Code Blocks — Shared Code Examples And Shiki Compositions

Source repository: https://github.com/pheralb/code-blocks/tree/a726aec02e94797e1d8276f2eb5806ffc9f40d97

Reference documentation: https://code-blocks.pheralb.dev/docs/getting-started/prerequisites

Inspected source at that pinned revision:

- `apps/website/src/components/code-block/code-block.tsx`
- `apps/website/src/components/code-block/copy-button.tsx`
- `apps/website/src/components/code-block/client/shiki.tsx`
- `apps/website/src/components/code-block/mdx/pre-shiki.tsx`
- `apps/website/src/components/code-block/blocks/inline-code.tsx`
- `apps/website/src/components/code-block/blocks/copy-text-morph.tsx`
- `apps/website/src/components/code-block/blocks/multi-tabs.tsx`
- `apps/website/src/components/code-block/blocks/copy-with-select-package-manager.tsx`
- `apps/website/src/components/code-block/blocks/copy-with-tabs-package-manager.tsx`
- `apps/website/src/utils/shiki/highlight.ts`
- `apps/website/src/utils/shiki/transformers/` and `apps/website/src/styles/shiki.css`

Zero adapts the complete code-example composition and interaction family into
its existing public CodeBlock facade: composable surfaces/tools, copy/morph,
file tabs, compact snippets, package-manager selection/persistence, shared Shiki
metadata/highlight/wrap/diff/focus/anchor behavior, and browser/server/compiled
Markdown adapters. Styling, syntax colors, metrics and motion use Zero tokens;
controls and icons reuse Zero primitives. The existing `code`/`files` API remains
supported. Alternative Prism/SugarHigh examples are represented by the same
shared Shiki renderer rather than introducing additional highlighter engines;
the MDX adapter does not execute authored MDX. Pheralb's source and MIT license
were inspected directly, alongside the official public registry items.

MIT License

Copyright (c) 2026 Pablo Hdez

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## ReUI — SVG Signature Pad, Button Group And Context Menu

Source: https://github.com/keenthemes/reui/blob/ef0fe1252d9b24d69bdedee48a69ec9b29d1f217/registry-reui/bases/radix/reui/signature-pad.tsx

Additional component references:

- https://github.com/keenthemes/reui/blob/ef0fe1252d9b24d69bdedee48a69ec9b29d1f217/registry/bases/radix/ui/button-group.tsx
- https://github.com/keenthemes/reui/blob/ef0fe1252d9b24d69bdedee48a69ec9b29d1f217/registry/bases/radix/ui/context-menu.tsx

Zero adapts its SVG outline geometry, pressure/velocity pointer handling,
guides and preview presentation into focused modules using Zero's own controls,
form binding, guarded history, lifecycle handling and observability.
Button Group adapts the public joined-control composition, with Zero controls,
logical-direction styling and Radix selection. Context Menu adapts the public
item/submenu composition with Zero tokens, focused modules, native Radix
behavior, keyboard opening and leading/trailing adornments. No paid ReUI Pro
blocks or assets are redistributed.

MIT License

Copyright (c) 2025 Keenthemes Inc

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Mischief UI — Streaming Text

Source: https://github.com/Tinkerers-Labs/mischief-ui/blob/92c335bf6910007b95e282a6e0a1168555b86cf1/registry/default/streaming-text/streaming-text.tsx

MIT License

Copyright (c) 2026 Tinkerers Labs

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Mischief UI — Secret Field

Source: https://github.com/Tinkerers-Labs/mischief-ui/blob/7e9f81c61a73d0b84c5d58d906f039b61e5d953a/registry/default/secret-field/secret-field.tsx

MIT License

Copyright (c) 2026 Tinkerers Labs

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
