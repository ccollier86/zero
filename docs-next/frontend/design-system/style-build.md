---
id: zero.design-system.style-build
type: architecture
audience: [developer, agent, operator]
owner: design-system
status: draft
visibility: internal
system: design-system
feature: style-build
maturity: supported
applies_to: ["2.6.0 working source; next application default and explicit legacy builds"]
modes: ["React browser UI", "SSR markup", "managed frontend styling"]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-10"
  evidence_level: source-observed
---

# Managed Styles And Class Discovery

[Design-system index](./index.md) · [Documentation index](../../index.md)

Managed frontend startup builds the platform stylesheet from globals.css using
Tailwind's compiler/scanner. It scans package source plus the configured appDir
for TS/TSX/JS/JSX class candidates. Missing appDir is ignored, so a backend-only
composition can still produce the platform base stylesheet.

The compiled CSS hash creates platform.<hash>.css under the build output,
served as /_build/platform.<hash>.css. Publication uses an atomic temporary
sibling. Existing hashed styles remain available to in-flight pages and
previous deployment manifests; output retention belongs to the deployment
lifecycle, not the next compilation. Failed builds do not retire the last
usable stylesheet. Building is a filesystem mutation, not a read-only inspection.

## Select The Managed Foundation

`AppConfig.themeFoundation` accepts only `'legacy'` or `'next'`; omission means
next. Explicit null, booleans, boxed strings and other values fail admission.
The next selection compiles `theme-next.css` after globals.css in the same
content-addressed stylesheet. It does not load font assets or set browser mode,
density or `data-zero-theme` attributes.

Complete server declaration:

```ts
import { defineZeroConfig, type AppThemeFoundation } from '@zero/framework/server';

const foundation: AppThemeFoundation = 'next';

export default defineZeroConfig({
  db: { mode: 'file', path: './data/app.db' },
  tables: {},
  themeFoundation: foundation,
});
```

`AppShell` activates the [next boundary](./foundation-next.md#activate-an-explicit-boundary)
on its existing application frame by default. Custom frames still own their
scope marker. Document roots and unmarked public/legacy siblings remain on
their old presentation even when supplemental rules are available.

Selected next builds, including the default, require their stylesheet to succeed; they never silently
deploy without the selected foundation. Compiled artifacts record
`frontend.themeFoundation`. Runtime admission rejects a different configured
selection and asks for a rebuild. Older artifacts without that metadata are
treated as legacy and require explicit legacy configuration or a rebuild.
No provider credentials or theme overrides are injected into
public configuration by this selection.

## App-Owned Styling

Use complete literal class names for discoverable classes. Concatenating runtime
pieces such as "bg-" + color does not declare every possible candidate.
Configured appDir is the app scanning boundary; arbitrary separate custom
source trees are not implicitly new scan roots. Apps using their own CSS build
pipeline may import @zero/framework/styles.css and deliberately configure their
pipeline's candidates. That entrypoint now includes the scoped next supplement;
@zero/framework/styles-legacy.css retains the original entrypoint for rollback.

The 2.5.0 optional native plugin build contract explicitly contributes
`styleSources` (source files or directories), prebuilt scoped `styles` and
tokenized browser enhancements. Those declared sources join the managed scan;
missing required inputs or a required style failure aborts preparation.
They do not silently add arbitrary content folders to Tailwind scanning.
See [build contributions](../../backend/runtime/build-contributions.md).

Source-local buildPlatformStyles/scanTailwindCandidates are internal helpers,
not supported public application imports. Do not use node_modules/src to invoke
them from a page. The Tailwind native compiler/scanner stays runtime-resolved
to avoid server bundling native internals; this is not a second Node server
runtime.

The base stylesheet handles semantic [tokens](./tokens.md),
[lanes](./lanes.md) and focus/base/code-block rules. Client NODE_ENV controls
related JS minify/sourcemap/replacements, not a live theme knob.

`globals.css` remains the shared Tailwind/base/component-style entrypoint for
both foundations. Removing its legacy palette requires first separating those
durable responsibilities; the generated next supplement is not a replacement
build entrypoint. Follow the [original-theme retirement gates](./foundation-next.md#retire-the-original-theme-safely).

## Verification And Related Guides

Verify the actual app build contains its classes, loads hashed CSS, uses light/
dark roots and preserves unrelated build files. Source inspection/test presence
does not qualify every native scanner architecture or packaged server build.
[Runtime composition](../../backend/runtime/index.md) owns build/startup order;
[themes](./themes.md) owns browser selection; [configuration](./configuration.md)
separates presentation from server settings.
