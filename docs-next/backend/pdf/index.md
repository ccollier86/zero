---
id: zero.pdf
type: index
audience: [developer, agent, operator]
owner: pdf
status: draft
visibility: internal
system: pdf
feature: overview
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

# PDF Rendering

[Backend index](../index.md) · [Documentation index](../../index.md)

PDF renders server-owned HTML/CSS into in-memory PDF bytes, optionally storing
the result through a narrow writer. Default Chromium is lazy and resource-
restricted; enabling PDF does not install a browser or expose a public render
endpoint.

- [Rendering](./rendering.md): inputs, document composition and print options.
- [Configuration](./configuration.md): full defaults and app/env precedence.
- [Resource security](./security.md): CSP, remote policy and literal host protection.
- [Storage](./storage.md): scoped output, creator identity and accepted writes.
- [Browser runtime](./browser-runtime.md): installation/status and lazy Chromium.
- [Adapters](./adapters.md): explicit renderer/writer contracts.
- [Lifecycle](./lifecycle.md): queue/deadline/shutdown.
- [Errors](./errors.md): stable failures and safe operational events.
- [Roadmap](./roadmap.md): future direction, not promised extra APIs.

Public server package is @zero/framework/pdf. Normal request zero.pdf is a
restricted render/status/storage facade; privileged setup/raw PdfService also
owns close/adapter selection. No browser credential or HTTP path is inferred.

The source design separates presentation composition, resource policy,
renderer process, bounded queue and storage authority. This development draft
includes app-local emitter/default writer and IPv6 literal classification
corrections; exact released-package/browser qualification remains pending.
