---
id: zero.doctor.infrastructure-inspection
type: architecture
audience: [developer, agent, operator]
owner: doctor
status: verified
visibility: internal
system: doctor
feature: infrastructure-inspection
maturity: supported
applies_to: ["2.6.0"]
modes: ["configuration values", "trusted CLI modules", "explicit infrastructure snapshots"]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "c5656b306051b04ec6adc641b7057a0672fd7a3e"
  snapshot: clean
  date: "2026-10-07"
  evidence_level: source-observed
---

# Existing Database Inspection And Data Planes

[Doctor index](./index.md) · [Documentation index](../../index.md)

Supplying projectRoot enables checks beyond static strings. Doctor may reuse
explicit SQLite/sqlite-wrapper handles or open an **existing** resolved database
file with readonly:true. It never creates a missing database merely to inspect
it. Newly opened handles are closed; caller-owned handles are not disposed.

The configured system plane holds canonical Guardian/control-plane state.
Application data lives separately; shallow user/organization anchors support
business foreign keys. Checks inspect separation, required identity/projection
shape and selected operational readiness. A reused handle is not made globally
read-only by Doctor; only Doctor's inspection queries are intended read-only.

## Paths And Readiness

Path resolution uses the configured persistence mode and explicit root.
Filesystem aliases/overlaps can matter even when text paths differ.
Missing/unsupported inspection targets produce absence/unavailable diagnostics
or skip inapplicable reads; SQLite failures are contained as safe findings
rather than exposing row contents.

File inspection is best-effort native SQLite admission, not a promise that every
offline WAL image can be opened. A fully closed WAL-mode file may have no `-wal`
or `-shm` sidecars after normal cleanup. The native SQLite build can reject a
read-only reopen in that state with `SQLITE_CANTOPEN`, even when the main file
exists and is readable. Doctor then reports the warning
`database.system.file_inspection_unavailable`; it does not invent schema-ready
findings or change the file to make it inspectable. This condition is distinct
from a missing or invalid installed feature schema.

An active writer with readable WAL sidecars allows normal SQLite snapshot reads
to include committed WAL state. Doctor does not copy only the main file, use
an `immutable`/no-lock bypass, open a read-write fallback, checkpoint, or alter
journal mode. Do not delete sidecars or rewrite a live database for diagnostics.
Use normal runtime checks or an explicitly admitted caller-owned SQL handle
when file inspection is unavailable; a runtime feature remains responsible for
its own exact admission. Native read-only WAL requirements are described in
[SQLite's WAL documentation](https://sqlite.org/wal.html#read_only_databases).

Read access can still touch sensitive infrastructure. Use deliberate authority,
inspected configuration and a disposable fixture for tests. `--no-usage-audit`
does not remove these checks, and env:{} does not virtualize filesystem reads.

Doctor does not seed anchors, repair stale memberships, move legacy control
tables, provision tenant files, create migrations, or dump user rows to reports.
If topology/projection fails, fix the owning startup/services before trusting
application mutations.

## Desired Guardian Features Versus Installed Schema

Zero 2.6.0 includes focused diagnostics for the configured Guardian profile
features. These inspect installed prerequisites; they do not provision a
feature or prove that an application-specific production rollout succeeded.

For enabled own profiles, contacts, avatars and first-use completion, Doctor
reuses the same exact read-only schema inspectors as the owning services. A
same-name table is not enough: missing indexes, changed constraints or a
colliding object produce targeted `auth.user_profile.<feature>.schema_missing`
or `.schema_invalid` findings. `.schema_ready` means admitted installed shape,
not an active provider, successful delivery or a functioning account session.

The profile schema includes a bootstrap-owned generation clock. Doctor reports
`auth.user_profile.profile.policy_pending` when the installed policy does not
match the desired resolved configuration, and `.policy_invalid` for malformed
retained generations. Neither finding installs a policy or revives a retired
runtime; normal Guardian startup owns that transaction.

The following additional checks remain read-only:

- Avatar metadata must point to an existing private global SYSTEM Storage
  drive: public access is zero, with no tenant or personal owner. Missing
  Storage metadata, absent namespace and wrong privacy/ownership have separate
  `auth.user_profile.avatars` findings. No staged upload, avatar byte stream or
  provider is accessed.
- A completion-policy marker may be absent, malformed or not yet reconciled
  with the desired startup configuration. `.completion.policy_pending` asks
  for normal startup/recomposition, not manual proof/fingerprint rewriting.
  `.completion.policy_invalid` is a private-state recovery problem, not a
  migration successfully completed by Doctor.
- Enabled presence checks exact SYSTEM schema admission and, for a pinned
  application projection, the separate application schema. Physical tenant
  presence requires the exact `guardianPresenceRealmContribution()` in the
  declared realm. Doctor does not open tenant files, launch actors, reclaim an
  owner lease, publish a reset or make a tenant ready.
- Configured email proof without managed Email and configured phone proof
  without a trusted adapter have actionable prerequisite warnings. An adapter's
  `isReady`, `start`, `verify` and `cancel` callbacks are never invoked; a
  configured adapter is not proof of live delivery readiness.

Disabled capabilities do not require retained optional schemas or cause their
data to be deleted. Inspection still requires an existing file or an admitted
caller-owned platform SQL handle; an uninspected ephemeral/missing target is
not silently labeled schema-ready. Normal managed startup and reviewed numbered
migrations own provisioning. `migrate: false` is not permission for Doctor to
create, repair or seed feature state.

Focused isolated regressions check unchanged schemas/row-change counts,
byte-for-byte unchanged closed readable SQLite files, committed active-WAL
state with unchanged main/WAL bytes, and truthful unavailable findings when a
native missing-sidecar reopen is rejected. They also check no adapter calls,
exact presence realm admission and privacy-safe diagnostics. They do not
establish production provider or installed-package readiness.

## Related Guides And Next Steps

[Fabric](../../backend/fabric/index.md) owns physical placement/actors,
[migration planes](../../backend/migrations/data-planes.md) own target safety,
[config loading](./config-loading.md) owns import effects, and
[automation diagnostics](./database-automations.md) uses explicit abstract health
rather than reading outbox payloads.

[Own profiles](../../backend/guardian/user-profiles.md),
[verified contacts](../../backend/guardian/contacts.md),
[avatars](../../backend/guardian/avatars.md) and
[first-use completion](../../backend/guardian/profile-completion.md) own their
feature rollout, state and migration contracts.
