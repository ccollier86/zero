---
id: zero.frontend.sdk
type: index
audience: [developer, agent]
owner: frontend-sdk
status: draft
visibility: internal
system: frontend-sdk
feature: overview
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# The Integrated Client SDK

[Frontend index](../index.md) · [Documentation index](../../index.md)

One integrated client supplies authenticated HTTP, typed Eden access, reactive
collections, policy-aware resources and platform service facades. Browser hooks
and reusable controls consume this client; they do not invent separate auth
headers or replace server authority.

## Core Contracts

- [Client lifecycle](./client-lifecycle.md): creation, singleton ownership,
  connection state and deliberate teardown.
- [HTTP](./http.md): authenticated JSON requests, raw response mode, abort and errors.
- [Typed API](./typed-api.md): Eden results, unwrap and supported multipart transport.
- [Collections](./collections.md): local reactive rows, optimistic/accepted writes
  and natural identity.
- [Acknowledged mutations](./acknowledged-mutations.md): exact receipts, timeout,
  scope/disconnect errors and what cancellation does not mean.
- [Resources](./resources.md): generated policy-aware HTTP CRUD and idempotent retries.
- [Data hooks](./data-hooks.md): full/lazy shared collections and local reads.
- [Data composition](./data-composition.md): isolated accepted pages, records and selection.
- [Resource hooks](./resource-hooks.md): owned HTTP list/record/action state.
- [Mutations and health](./mutations-and-connection.md): accepted app commands and
  honest connection observations.
- [Scoped control planes](./scoped-control-planes.md): data readiness and Studio facades.
- [Service composition](./service-composition.md): links to owning Guardian/Torrent/
  room/notification/state contracts.
- [Low-level Sync](./low-level-sync.md): advanced transport/store/hooks, distinct
  from the integrated SDK.
- [Configuration](./configuration.md): construction/request options and their read time.
- [Roadmap](./roadmap.md): future client/tooling direction, not new runtime APIs.

All inventoried SDK feature groups now have first-draft homes. Independent review,
actual example checks and artifact qualification remain separate gates.

## Choose A Data Path

| Need | Normal path |
| --- | --- |
| render rows already synchronized or demand-loaded into the local store | collection/hook |
| wait for a tracked realtime write's exact server acceptance | collection Async method |
| query/filter/sort/page on the server or use a generated resource HTTP route | resource/data-query facade |
| invoke app-owned HTTP endpoints | client JSON helpers or typed Eden |
| upload typed multipart bodies | the supported Eden path, not JSON post(FormData) |

These paths share auth but not identical data/result/durability semantics.
The [runtime provider](../runtime/index.md) installs the normal client context;
[schema](../../backend/schema/index.md) owns logical versus stored values;
[server services](../../backend/runtime/server-services.md) owns backend execution.

Treat browser tables and cache keys as descriptive projection, never authority.
An organization selector must use Guardian's normal tenant transition, not set
a browser database path. Source-observed philosophy favors existing authenticated
transport, explicit accepted mutations and scope-partitioned cached data.
