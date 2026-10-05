---
id: zero.pdf.configuration
type: reference
audience: [developer, agent, operator]
owner: pdf
status: draft
visibility: internal
system: pdf
feature: configuration-and-defaults
maturity: supported
applies_to: ["2.1.1 development source; not package-qualified"]
modes: [managed-server, standalone-server, scoped-storage]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# PDF Configuration

[PDF index](./index.md) · [Documentation index](../../index.md)

createApp pdf accepts false/true/PdfConfig; omitted/false disables, true resolves
an empty object with secure defaults. resolvePdfConfig(input, env?) is public
and defaults env to Bun.env; documentation tests pass an explicit empty map.

| Setting | Default / meaning |
| --- | --- |
| renderer |Default PlaywrightPdfRenderer; optional explicit adapter. |
| browser.executablePath |Explicit value by nullish precedence, otherwise ZERO_PDF_EXECUTABLE_PATH; blank normalized to absent. |
| browser.headless |true. |
| browser.launchArgs |Empty array, trusted operator values. |
| browser.launchTimeoutMs |30000, positive integer. |
| browser.javaScriptEnabled |false; enable only for trusted document input. |
| resources.remote |deny; same-origin/allowlist/allow alternatives. |
| resources.allowedOrigins |Empty set, normalized exact HTTP(S) origins without credentials. |
| resources.deniedBehavior |error; omit alternative. |
| resources.allowDataUrls / allowBlobUrls |true / false. |
| resources.blockPrivateNetworks |true, pure literal/known-host policy described in security guide. |
| defaults |Letter, background/CSS-size/tagged true; other PrintOptions explicit or renderer defaults. |
| limits.maxHtmlBytes |2097152 (2MiB), aggregate HTML/template metadata bound. |
| limits.maxCssBytes |524288 (512KiB). |
| limits.maxOutputBytes |26214400 (25MiB). |
| limits.timeoutMs |30000. |
| limits.maxConcurrency / maxQueue |2 /50; queue0 disallows waiting. |
| waitForFonts |true. |

Known nested fields/shapes/enum/numeric options are validated; the resolver
does not implement a blanket unknown-key rejection policy. A typo is not a new
supported setting. Defaults are startup configuration; per-render options/
timeout are the explicitly supported request overrides.

Request timeout must be positive integer and no greater than configured
timeout. It includes queue wait, leaving only the remaining budget to the
renderer. Resource policy cannot be weakened by request print options.

Doctor checks PDF configuration/browser readiness conditions but does not
certify a Chromium render, output fidelity or network isolation. Enabling PDF
never automatically downloads/install browser dependencies.

## Plugin Options

createPdfPlugin accepts resolved config, optional prebuilt service, renderer,
storage writer, owning runtime, onServiceCreated and additive PdfServiceOptions
emitCode for standalone integration. Managed-created service captures its
own emitter and lazy Storage getter; supplied prebuilt adapters remain the
trusted caller's responsibility. No PDF-specific frontend hook/UI was inventoried.

- [Browser runtime](./browser-runtime.md) owns executable/install operations.
- [Security](./security.md) owns remote policy.
- [Adapters](./adapters.md) owns caller-supplied runtime contracts.
