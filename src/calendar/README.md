# Managed calendar core

Feature-branch implementation, not a qualified release. `calendar` configuration,
private Fabric lifecycle, current-Guardian service, native HTTP/client facades and
connected UI are now composed. The selected 2.11.0 updater archive still has only
the experimental frontend; do not tell an application to adopt unreleased APIs.

The [integration plan](../../docs-next/_work/calendar-integration-plan.md) remains
the contract for the remaining work.

The [backend guide](../../docs-next/backend/calendar/index.md) documents the
implemented core and its explicit limitations. This is not the complete plan:

- Time helpers accept explicit canonical UTC instants and a scheduling zone.
  They do not convert wall time, expand recurrence or implement all-day records.
- Configuration is detached, bounded and connected to managed startup. A
  configured object is not proof of actor/storage or release readiness.
- Realm commands run in the native tracked transaction boundary. They are not
  routes: actor fields and creation IDs must come from a trusted broker, never
  browser input. The managed broker derives them from current Guardian authority.
- Safe receipts preserve identity and outcome, not historical access rights.
- Private effect references are handoff groundwork, not another audit system or
  a working notification pipeline.

The runtime uses fixed empty-environment actors, existing-only acquisition for
established files, immutable scope ownership, bounded queues and commit-only
invalidation. Semantic changes use the existing transaction-bound logging outbox;
idle watch renewal and raw reservation rows do not manufacture audit events.

`index.ts` exports setup/facade types and errors only; raw owner, actor, database
and command capabilities remain private. `@zero/framework/calendar` remains the
browser UI entry; `calendar/server` and `calendar/client` are separate entries.

Still required before release: actual file/actor, managed compliance, real-browser,
official JS bundle, Linux/amd64 installed archive and normal updater qualification.
Compiled executables fail closed with the default source actor launch. Recurrence,
availability rules, holds, participants, clinical states, invitations, reminders,
AI and public self-booking are not implemented; unsupported enablement rejects.
