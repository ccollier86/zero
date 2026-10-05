---
id: zero.inventory.pdf
type: inventory
audience: [maintainer, agent]
owner: pdf
status: draft
visibility: internal
system: pdf
applies_to: ["Zero 2.1.1 source baseline; not a release qualification"]
modes: ["managed server app", "standalone server plugin"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: committed-baseline-clean
  date: "2026-10-04"
  evidence_level: source-observed
---

# PDF System Inventory

[Systems inventory index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity

PDF provides server-side HTML/document rendering through a managed browser,
policy-controlled resource loading, optional output storage, and browser
installation/status helpers. Inspected source is Zero package 2.1.1 at
`a3a5f726768dac890f241a3899c0a1acb66265d9`; documentation-only `HEAD` is
`cd643b5b862f83b4ab40320486e1b89df1154c87`. Source-observed only.

## Purpose And Terminology

PDF rendering transforms caller-supplied document content into a PDF using a
server renderer. Resource policy controls network/embedded assets loaded by the
browser. Storage is an optional destination adapter; it is not implied by render
itself. Browser installation is operational setup and separate from request
handling.

## Features And Documentation Coverage

| Feature | Maturity and modes | Public surfaces | Evidence | Canonical draft guide | Review |
| --- | --- | --- | --- | --- | --- |
| Render HTML/CSS and document composition | Supported; server | `PdfService.render`, `composePdfDocument`, print options and result | `pdf-service.ts`, `pdf-document.ts`, service/document tests | [rendering](../../../backend/pdf/rendering.md) | Source observed |
| Render to storage | Supported; server + Zero Storage | `PdfService.renderToStorage(input,target,writer?)`, `ZeroPdfStorageWriter` | storage writer/service tests | [storage](../../../backend/pdf/storage.md) | Source observed |
| Chromium and custom renderer | Supported; server | `PlaywrightPdfRenderer`, injectable `PdfRenderer`; lazy browser lifecycle/status | renderer/service tests | [browser-runtime](../../../backend/pdf/browser-runtime.md) | Source observed |
| Resource allow/deny policy | Supported; server | `deny|same-origin|allowlist|allow`, URL policy/sanitizer and private-network block | policy code/tests | [security](../../../backend/pdf/security.md) | Source observed |
| Browser install/status helpers | Supported operations and CLI; install mutates host | `getPdfBrowserInstallStatus`, `installPdfBrowser({withDependencies?})`, `zero pdf install|status` | `pdf-browser-install.ts`, `src/pdf/run.ts`, `src/cli/run.ts`, package scripts | [browser-runtime](../../../backend/pdf/browser-runtime.md) | Source observed |
| App lifecycle plugin | Supported; managed app/server | `createPdfPlugin`, Elysia decoration `pdf`, service status/close | plugin/config/app tests | [configuration](../../../backend/pdf/configuration.md) | Source observed |

## Public Surface Map

Package export is `@zero/framework/pdf`, server-only: config/doc helpers,
install/status, errors, plugin/service/writer/Playwright renderer, resource
policy and types. `PdfService` methods are `render/renderToStorage/status/close`.
`createApp({pdf})` accepts false/true/object; default false, true enables secure
Chromium defaults. Plugin exposes an Elysia `pdf` service decoration and no HTTP
routes. `src/cli/run.ts` dispatches the `zero pdf install|status` commands;
package scripts include `pdf:install` and `pdf:status`.

## Integration Map

- Rendering runs server-side in Playwright; startup/readiness and browser
  availability can differ from an individual render request.
- Resource URL policy is security-sensitive: redirects, schemes, local/private
  addresses, DNS rebinding, denied-resource behavior and limits must be traced
  from policy/tests before examples.
- Storage writer integrates with server storage and must preserve authorization
  and target scope. Do not imply generated PDF is automatically persisted.
- Render queue/concurrency and cancellation/shutdown behavior belong to service
  lifecycle; errors use stable PDF error types and observability.
- Browser install modifies machine dependencies; documentation must identify
  its operational side effects and avoid running it during audit.

## Configuration Inventory

`AppConfig.pdf?: boolean | PdfConfig`; omitted/false disables; true normalizes
empty object; recognized option shapes/values are validated, but unknown keys are not rejected. Print defaults Letter, printBackground true,
preferCSSPageSize true, tagged true; scale is left unset unless supplied. Browser: headless true,
launch timeout 30s, JavaScript false, managed Playwright executable unless
`browser.executablePath` or `ZERO_PDF_EXECUTABLE_PATH`. `waitForFonts` true.
Resource defaults remote deny, denied behavior error, data URLs allowed, blob
URLs denied, private network blocked; allowlist exact HTTP(S) origins.
Limits: HTML/template 2 MiB, CSS 512 KiB, output 25 MiB, render timeout 30s,
concurrency 2, queue 50. Custom renderer may replace Chromium; `pdf: true`
does not install/start Chromium during app startup; browser starts on first
render. `zero pdf install` invokes `installPdfBrowser({withDependencies})`,
which spawns Playwright CLI `install
[--with-deps] chromium`, an explicit host mutation. Config resolver accepts a
testable env map and defaults to `Bun.env`; only documented env binding is
`ZERO_PDF_EXECUTABLE_PATH`. Doctor calls checkPdf in platform-doctor-pdf.ts; it does not certify a render or network policy.

## Evidence And Verification

The [ten-page PDF manual](../../../backend/pdf/index.md) now covers renderer/
writer boundaries, full configuration, document/print behavior, actual CSP/
literal resource policy, queue/deadline/close and explicit host installation.
It does not claim DNS pinning/full network sandbox or real browser qualification.

### Authorized App-Ownership And Literal Corrections

Detailed review reproduced managed PDF emissions following ambient runtime,
default storage lookup not selecting its app and failed publication without
registered renderer cleanup. Separate pure URL tests reproduced missed IPv6
unspecified/mapped-private/full-link-local literals and falsely blocked
similarly prefixed ordinary hostnames. Each new failing case had a focused
synthetic reproduction before correction; no network/browser/storage was used.

Managed-created service/plugin now capture their app emitter and lazy Storage
getter, register shared cleanup before publication and start that same cleanup
on composition failure (stable PDF_CONFIG_INVALID). Prebuilt services remain
trusted caller-owned adapters. Literal classification follows normalized URLs
and the [IANA IPv6 registry](https://www.iana.org/assignments/iana-ipv6-special-registry).
The six-file synthetic suite passed 22 tests / 63 assertions; independent final
publication-failure source review and rerun passed. It is not artifact/browser security
qualification.

Tests present include config, content/resource policy, document/service,
render queue, renderer and plugin suites under `src/pdf/`. No tests were run
during the original inventory; later focused runs are recorded above.
Current `docs/pdf.md` is research only. Source shows public barrel exports but
not release qualification.

Source entry points: [`src/pdf/index.ts`](../../../../src/pdf/index.ts),
[`src/pdf/pdf-service.ts`](../../../../src/pdf/pdf-service.ts),
[`src/pdf/pdf-resource-policy.ts`](../../../../src/pdf/pdf-resource-policy.ts).

## Findings

### Independent Source Review Supplement

pdf-config.ts and CLI dispatch were inspected. Unknown-key rejection is not implemented and scale is not populated by Zero's defaults. Doctor invokes platform-doctor-pdf.ts; this reviewer did not launch Chromium or qualify SSRF/storage behavior. Those gates remain open.

This targeted independent source review is complete for this inventory. It keeps the pinned main baseline distinct from authorized working-tree fixes; it does not complete whole-platform or exact-package gates.

- The security and operations surface is substantial; a minimal “render HTML”
  page alone would omit remote-resource and browser-lifecycle contracts.
- Exact SSRF/network constraints and storage authorization require detailed
  review against tests.
- No release qualification performed.

## Known Future Plans

No approved future plan established. Preserve any sourced proposals in
`docs-next/backend/pdf/roadmap.md`; historical plans are not current contract.

## Navigation And Cross-Link Plan

Parent: `docs-next/_work/audits/systems/index.md`. Planned home:
`docs-next/backend/pdf/index.md`, configuration/roadmap, rendering, browser
runtime, security and storage pages. Link app lifecycle, storage, observability,
and operations/setup guides.

## Completion Review

- [x] Targeted independent source/default/public-boundary review completed; no whole-platform or package qualification inferred.

- [x] Check CLI dispatch and browser installation command ownership.
- [ ] Verify defaults, resource policy and failure/cancellation paths.
- [ ] Trace storage writer authorization and output semantics.
- [ ] Whole-platform independent review completed.
