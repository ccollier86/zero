---
id: zero.observability.endpoints
type: reference
audience: [developer, agent, operator]
owner: observability
status: draft
visibility: internal
system: observability
feature: event-http-boundary
maturity: supported
applies_to: ["2.1.1 development source; not package-qualified"]
modes: [managed-server, standalone-server, frontend]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Event Reads And Frontend Ingest

[Observability index](./index.md) · [Documentation index](../../index.md)

Default base path is /api/_zero/observability, with GET and POST /events.
Read access and write-only ingest are different policies. Configure them
explicitly for your deployment; do not expose an operational event store as
an ordinary organization table.

## Read Access

GET accepts level (including comma-separated values), category, code, source,
since, cursor and limit. The response is the configured store's event page.
Default read policy is admin with auth enabled, development otherwise.

Built-ins: admin checks the resolved authContext global role equals admin;
development permits when NODE_ENV is not production; admin-or-dev accepts
either; disabled denies. A custom callback receives request and safe optional
authContext and can return boolean/Promise<boolean>. These are not an automatic
tenant-specific RBAC dashboard policy; do not equate Administration membership
with this endpoint's explicit authorization.

Denial returns403 and emits OBSERVABILITY_ACCESS_DENIED. Authorized reads
without a store return503. Endpoint-disabled means routes are not registered.

## Frontend Reports

POST is write-only ingest; it does not require/read the event-store read
permission. Treat its content as untrusted browser reports, never proof that
a security mutation occurred. frontendIngest:false returns404.

Required message is nonempty/max2000characters. Optional fields are valid
level, category/code/prefix, metadata record, error, requestId and traceId.
Server sets source frontend; submitted userId is not an authenticated identity.
It emits the reported event and OBSERVABILITY_FRONTEND_INGESTED.

The development byte-limit correction checks actual cloned-stream bytes before
parsing, not only Content-Length. Default limit32768bytes; oversized returns413
and safe rejection telemetry. It preserves normal JSON/form parsing and
schema validation. Malformed JSON is classified400; invalid schema422.
The bound limits accepted/preparsed body bytes, not memory allocated by a host
transport chunk or a complete general gateway abuse policy.

## Privacy And Verification

Request telemetry strips query strings and known auth action-token and storage
presigned/upload-grant secret path segments. It is not arbitrary path-value
redaction. Browser messages/raw errors/custom metadata remain a privacy
responsibility; never send action tokens, API keys or PHI.

Test denied reads, disabled store/ingest, actual-byte overflow with missing/
misleading Content-Length, valid exact boundary, malformed JSON and scope/
runtime isolation. Never test against a real app's event history.

- [Configuration](./configuration.md) owns policy/defaults.
- [Store](./store.md) owns tail/count/cursor behavior.
- [Frontend events](../../frontend/observability.md) owns client serialization.
