---
id: zero.doctor.check-families
type: reference
audience: [developer, agent, operator]
owner: doctor
status: draft
visibility: internal
system: doctor
feature: check-families
maturity: supported
applies_to: ["2.1.1 source; publication qualification pending"]
modes: ["configuration values", "trusted CLI modules", "explicit infrastructure snapshots"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Doctor Check Families And Remedies

[Doctor index](./index.md) · [Documentation index](../../index.md)

Doctor's focused checkers inspect declarations and selected state. The owning
runtime/service remains authoritative; do not weaken enforcement merely to
silence a finding.

| Family | What is inspected | Owning manual |
| --- | --- | --- |
| Config/schema/resources | admission, primary keys, identities, resource permissions and Sync scope | [Schema](../../backend/schema/index.md), [resources](../../backend/resources/index.md) |
| Guardian/native/email | auth policy, provider/action-email requirements, public flow paths, native callbacks | [Guardian](../../backend/guardian/index.md), [native auth](../../backend/native-auth/index.md), [email](../../backend/email/index.md) |
| System/app/Fabric | separate paths/handles, projection shape, topology/actor/readers/durability budgets | [Fabric](../../backend/fabric/index.md), [infrastructure reads](./infrastructure-inspection.md) |
| Migrations | disabled startup and explicit ledger/schema target guidance | [Migrations](../../backend/migrations/index.md) |
| Database automations | admitted functions/triggers, realm fingerprints, dispatcher/outbox and aggregate health | [Automation diagnostics](./database-automations.md) |
| Storage/observability | signing/auth readiness, endpoint policy and retained event settings | [Storage](../../backend/storage/index.md), [observability](../../backend/observability/index.md) |
| AI/vector | configured provider/model aliases, supported capabilities, index dimensions/paths and scope-field indexing | [AI](../../backend/ai/index.md); vector source manual pending root completion |
| PDF | browser executable/installation policy | [CLI browser operations](../tooling/dispatch.md#operational-subcommands) |
| Source usage | public import/component/service use and responsibility heuristics | [Source audit](./source-audit.md) |

## Public Paths And TTLs

Managed auth accessTokenTTL/refreshTokenTTL settings must not suppress public
login/registration/password/account-setup/verification path checks. The corrected
development source removes those createApp-only fields before strict Guardian
behavior admission. Explicit routeAuth mode intentionally bypasses automatic
public-path diagnostics; auth:false disables them.

Example warning codes include auth.login_path.not_public and
auth.registration_path.not_public. Remedies preserve intended routing and
auth policy; they are not blanket advice to mark the whole app public.

## What Is Not Proven

Provider configuration checks do not call every provider/model. Vector index
policy checks do not provision stores. File path/projection inspection does not
migrate them. Automation fingerprint agreement does not hash arbitrary handler
closure behavior. No checker silently repairs a deployment.

See [configuration](./configuration.md), [report API](./configuration-checks.md)
and [roadmap](./roadmap.md) for supported versus proposed coverage.
