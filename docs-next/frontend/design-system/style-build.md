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
applies_to: ["2.1.1 source; publication qualification pending"]
modes: ["React browser UI", "SSR markup", "managed frontend styling"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Managed Styles And Class Discovery

[Design-system index](./index.md) · [Documentation index](../../index.md)

Managed frontend startup builds the platform stylesheet from globals.css using
Tailwind's compiler/scanner. It scans package source plus the configured appDir
for TS/TSX/JS/JSX class candidates. Missing appDir is ignored, so a backend-only
composition can still produce the platform base stylesheet.

The compiled CSS hash creates platform.<hash>.css under the build output,
served as /_build/platform.<hash>.css. Old matching platform.*.css files are
removed while unrelated build assets remain. Building is a filesystem mutation,
not a read-only configuration inspection.

## App-Owned Styling

Use complete literal class names for discoverable classes. Concatenating runtime
pieces such as "bg-" + color does not declare every possible candidate.
Configured appDir is the app scanning boundary; arbitrary separate custom
source trees are not implicitly new scan roots. Apps using their own CSS build
pipeline may import @zero/framework/styles.css and deliberately configure their
pipeline's candidates.

Source-local buildPlatformStyles/scanTailwindCandidates are internal helpers,
not supported public application imports. Do not use node_modules/src to invoke
them from a page. The Tailwind native compiler/scanner stays runtime-resolved
to avoid server bundling native internals; this is not a second Node server
runtime.

The base stylesheet handles semantic [tokens](./tokens.md),
[lanes](./lanes.md) and focus/base/code-block rules. Client NODE_ENV controls
related JS minify/sourcemap/replacements, not a live theme knob.

## Verification And Related Guides

Verify the actual app build contains its classes, loads hashed CSS, uses light/
dark roots and preserves unrelated build files. Source inspection/test presence
does not qualify every native scanner architecture or packaged server build.
[Runtime composition](../../backend/runtime/index.md) owns build/startup order;
[themes](./themes.md) owns browser selection; [configuration](./configuration.md)
separates presentation from server settings.
