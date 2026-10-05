---
id: zero.pdf.browser-runtime
type: operations
audience: [developer, agent, operator]
owner: pdf
status: draft
visibility: internal
system: pdf
feature: chromium-installation-and-status
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

# Chromium Runtime And Installation

[PDF index](./index.md) · [Documentation index](../../index.md)

pdf:true configures the default renderer but neither installs nor launches
Chromium at app startup. The first render lazily imports the deployed Playwright
package and starts its pinned managed browser or explicit executable.

## Explicit Host Operations

zero pdf status (also the default zero pdf subcommand) loads Playwright and checks
whether its expected managed executable exists. Exit0 means found, exit1 missing;
it prints the path. It does not render a document or certify custom executable
compatibility.

zero pdf install runs the pinned Playwright CLI install chromium.
--with-deps also requests Linux system dependencies. This is an explicit
host/network/package mutation; run it during controlled deployment, not as
a hidden consequence of a docs/Doctor test. No installation was run in this
documentation pass.

Public helpers are getPdfBrowserInstallStatus and
installPdfBrowser({withDependencies?}); package scripts pdf:status/pdf:install
cover the same operational surface.

## Process Lifecycle

A shared lazy launch promise deduplicates startup. Each render uses its own
browser context, print media, scoped resource interceptor, disabled service
workers/downloads and configured JS policy. Contexts close after rendering/
error/timeout. Browser disconnect retires the shared browser so a later render
can launch again.

Status ready reports the current renderer's readiness; default Chromium is
not connected before first launch. It is not equivalent to service disabled,
nor a real test that a future render will succeed. Launch failures produce
PDF_BROWSER_UNAVAILABLE with safe public guidance.

Playwright remains an external runtime dependency in Bun server bundles; a
compiled server is not a promise that Chromium and all Playwright internals
are embedded. Configure external dependency/cache/install locations according
to your deployment/storage policy.

- [Lifecycle](./lifecycle.md) owns render queue/shutdown.
- [Security](./security.md) owns resource/script controls.
- [Configuration](./configuration.md) owns executable/env precedence.
