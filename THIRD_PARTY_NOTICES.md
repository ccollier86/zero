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

## react-easy-crop — Profile Avatar Cropping

Source: https://github.com/ValentinH/react-easy-crop

Dependency version: 6.2.4. Zero composes the installed crop engine with its own
Dialog, avatar, dropzone, buttons, scope fences and styling. The engine retains
its distributed MIT license. Zero does not replace its geometry engine with a
bespoke crop implementation.

MIT License

Copyright (c) 2022 Valentin Hervieu

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

## sharp — Server Avatar Validation And Normalization

Source: https://github.com/lovell/sharp

Dependency version: 0.35.5. Zero uses the existing decoder for bounded actual
raster validation, EXIF orientation, resizing, metadata removal and WebP output.
The dependency and native codecs retain their distributed license notices;
sharp is distributed under Apache License 2.0, available in its installed
LICENSE file and at https://www.apache.org/licenses/LICENSE-2.0.
No upstream source file or native binary is vendored as Zero-authored code.

## ReUI — SVG Signature Pad, Button Group, Context Menu, Phone Input, Avatar Group And Kbd

Source: https://github.com/keenthemes/reui/blob/ef0fe1252d9b24d69bdedee48a69ec9b29d1f217/registry-reui/bases/radix/reui/signature-pad.tsx

Additional component references:

- https://github.com/keenthemes/reui/blob/ef0fe1252d9b24d69bdedee48a69ec9b29d1f217/registry/bases/radix/ui/button-group.tsx
- https://github.com/keenthemes/reui/blob/ef0fe1252d9b24d69bdedee48a69ec9b29d1f217/registry/bases/radix/ui/context-menu.tsx
- https://github.com/keenthemes/reui/blob/6e433ddaba3a4be38182c8c8883b6cc335183c42/registry-reui/bases/radix/reui/phone-input.tsx
- https://github.com/keenthemes/reui/blob/ef0fe1252d9b24d69bdedee48a69ec9b29d1f217/components/ui/kbd.tsx
- https://github.com/keenthemes/reui/blob/ef0fe1252d9b24d69bdedee48a69ec9b29d1f217/registry/styles/style-vega.css

Phone Input examples inspected through the public `radix-vega` registry:

- https://reui.io/r/radix-vega/c-phone-input-7.json
- https://reui.io/r/radix-vega/c-phone-input-8.json

Avatar Group references inspected through the public `radix-vega` registry:

- https://reui.io/r/radix-vega/c-avatar-29.json
- https://reui.io/r/radix-vega/c-avatar-12.json

Zero adapts its SVG outline geometry, pressure/velocity pointer handling,
guides and preview presentation into focused modules using Zero's own controls,
form binding, guarded history, lifecycle handling and observability.
Button Group adapts the public joined-control composition, with Zero controls,
logical-direction styling and Radix selection. Context Menu adapts the public
item/submenu composition with Zero tokens, focused modules, native Radix
behavior, keyboard opening and leading/trailing adornments. No paid ReUI Pro
blocks or assets are redistributed.

Phone Input adapts the flags, joined country/number composition, searchable
picker, size variants and read-only example to Zero's existing Input, Button,
Popover, Command, ScrollArea and icons. Formatting and bundled flags retain the
`react-phone-number-input` engine; headless canonical validation uses
`libphonenumber-js`. Native canonical form submission, shared read-only semantics,
reset handling and schema/form integration are Zero additions. Its upstream MIT
license was inspected directly in `LICENSE.md`; dependency packages retain their
own distributed notices.

Avatar Group adapts the overlapping avatars, overflow count/icon and optional
separate add action to Zero's existing Avatar, animated group, Button and
Tooltip controls. Shape/size and opt-in presence decoration are presentation
extensions; no upstream example is represented as a connected presence service.

Kbd and KbdGroup adapt the native keyboard-hint composition and `radix-vega`
compact defaults into Zero semantic colors and documented CSS metric variables.
Tooltip hints target Zero's actual tooltip surface rather than an upstream slot.
No keyboard command registry, shortcut listener or operating-system detection is
included in this presentation component.

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
