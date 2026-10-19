# Auth admission / identity projection regression

Recorded 2026-10-19. Zero 2.6.0 artifacts must be identified by their source
commit and archive SHA-256, not the unchanged package version alone.

## Affected release and failure

`3910810a11f81707344f098b2ace5bbb7cd32e9a` expanded fair auth admission to
account/admin mutations. `b2a65aee5f103826afd484f77471a28d41fe4a86` includes
that change. The earlier narrow session-admission build
`cb7ffed940232f0889a306d75414e95aeb9e89c7` was the downstream known-good pin.

The failing composition is managed Guardian with separate SYSTEM/application
databases and an application schema declaring `field.guardianUser()` or
`field.guardianMembership()` references. After first-administrator creation:

1. Canonical account persistence commits in SYSTEM.
2. Its synchronous post-commit callback reconciles the durable identity outbox.
3. Application anchor delivery needs shared authority, but admission still
   holds an exclusive lease until the entire operation returns.
4. The application commit fails with `DATABASE_AUTHORITY_CHANGED` and
   `Authorization state changed before the application commit.`
5. `ZERO_SYNC_POST_COMMIT_NOTIFICATION_FAILED` is emitted; the source target
   becomes quarantined and later provisioning/writes can fail.

The new composition regression test reproduced this exact stack through
`IdentityAnchorStore.apply`, synchronous reconciliation and the managed runtime.
It was not a bad password, corrupted credential or SQLite data corruption.
The reported downstream provider-credential failure was not independently
diagnosed from that application's private exception; the qualification suite
exercises representative protected, FK-backed credential records instead.

## Correction

Separate a fair queue **turn** from an actual commit **lease**:

- Admission still waits for active shared work without holding SQLite locks.
- A granted turn runs one synchronous persistence operation exactly once.
- Each final commit guard independently acquires/releases its real lease.
- After SQLite COMMIT, pinned anchor reconciliation can obtain shared leases.
- Queued callers cannot start their next exclusive turn until this synchronous
  completion finishes. Merely releasing admission early would leave a second
  race: releasing could grant the next queued exclusive lease before projection.
- Asynchronous acquisitions remain bounded/FIFO; no turn survives an await.
- Password hashing/signing/provider/email I/O remain outside the turn.

No auth check is bypassed: current account/session/tenant authority, revocation,
security generations, authority revision, exact file identity and cross-process
file fences remain enforced. Genuine unresolved conflicts still fail closed.
There is no automatic retry of an already committed account mutation.

Implementation is confined to the authority coordinator and authority commit
guards. The application guard also explicitly rejects a write nested inside
an unsettled SYSTEM transaction; sharing a synchronous turn must never allow
an application write to authorize against uncommitted Guardian state.
ReactiveDB transaction, rollback-only, mandatory durability-fence and
post-commit notification semantics are unchanged. SQLite is still one writer
per physical DB; independent Fabric DB actors retain their concurrency.

## Qualification

Run from the repository with external scratch configured:

```sh
bun --no-env-file src/testing/run-test-suite.ts --concurrency 3 \
  src/auth/ src/databases/ \
  src/frontend/server/identity-projection \
  src/frontend/server/auth-projection-http \
  src/frontend/server/auth-hot-mutations \
  src/frontend/server/pinned-automation-identity \
  src/frontend/server/platform-sync-policy
bun --no-env-file run typecheck
bun --no-env-file docs-next/_work/checks/check.ts
```

Focused regression files:

- `src/databases/authority-commit-admission-turn.test.ts`: FIFO priority,
  separate actual shared/exclusive fences, no async inheritance, invalid/reused
  turn rejection, throw cleanup and shutdown.
- `src/frontend/server/identity-projection-admission.integration.test.ts`:
  first administrator, six deliberately queued accounts, ready source/target
  anchors and immediate FK-backed application write.
- `src/frontend/server/auth-projection-http.integration.test.ts`: actual HTTP
  bootstrap/admin creation/protected create/read in single and multi tenancy,
  plus wrong password, missing credentials, ownership and revoked-session denial.
- `src/frontend/server/auth-hot-mutations.integration.test.ts`: populated hot
  Fabric actor/outbox with pinned user/membership projection, login, registration,
  membership/status/logout changes and protected application writes while busy.

Run these against the exact release candidate; earlier store-only/hot tests
without pinned Guardian references missed the composition regression.

## Upgrade and affected test data

This correction requires no database migration, password reset, account rewrite
or file/hot placement change. Install the corrected saved archive with the
normal updater and retain the previous working pin for rollback. Verify both
the source commit and archive SHA-256 from the release manifest.

It intentionally does **not** clear existing quarantine flags or replace
identity receipts automatically. A quarantined target can also indicate a real
installation mismatch or conflicting replay; treating all quarantines as safe
would weaken integrity. Updating code does not erase already persisted failure
state. Recreate only an explicitly disposable regression fixture, or preserve
and investigate a real affected installation through an evidence-backed
recovery plan. Do not delete production DBs, manually fabricate anchors, or
blindly update internal projection statuses. The downstream production app
reported remaining on the known-good package and was not changed by this fix.

The independent browser "Restoring session" investigation is not declared
fixed by this commit-admission correction.

See [session admission](../../docs-next/backend/guardian/sessions.md#fabric-commit-admission),
[identity projection](../../docs-next/backend/guardian/identity-projection.md),
[Fabric concurrency](../../docs-next/backend/fabric/concurrency.md), and
[the upgrade checklist](../../docs-next/guides/upgrade.md).
