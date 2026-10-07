---
id: zero.doctor.usage
type: how-to
audience: [developer, agent, operator]
owner: doctor
status: verified
visibility: internal
system: doctor
feature: usage
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

# Run Doctor Deliberately

[Doctor index](./index.md) · [Documentation index](../../index.md)

Run from an inspected trusted app, with deliberate configuration and filesystem
authority. Typical operational command:

```sh
bunx --bun zero doctor --config ./zero.config.ts --strict --json
```

This assumes the app already has the framework installed. It executes trusted
config/resource imports and can read existing DBs; it is not a static safe
preview. [Config loading](./config-loading.md) explains the exact stages.

## Results And CI Policy

Without strict, errors fail and warnings do not. Strict additionally fails
warnings; info remains descriptive. CLI successful report exits zero; failed
report/loader errors exit one. JSON prints the report and leaves effective
configuration/private values out. Load failures become a doctor.failed finding.
Human output groups Errors/Warnings/Info and includes paths, hints and docs.

Use `--no-usage-audit` to isolate config/infrastructure findings while debugging
source heuristics. This does not disable existing DB inspection.
Use repeatable source options to choose intentional scan roots, then resolve
warnings in their owning [feature family](./check-families.md).

## Source Root Ownership

Zero 2.6 keeps infrastructure inspection and source scanning bound to the
explicitly selected application root.

`runPlatformDoctor(config, { projectRoot })` uses that root as the config origin
when `config.projectRoot` is omitted. Relative `appDir` and server directories
then resolve inside the intended app, not the Doctor process working directory.
An explicit `config.projectRoot` remains authoritative. If it disagrees with the
Doctor root, Doctor emits the error `usage.config.project_root_mismatch` and skips
source scanning and optional database filesystem inspection; it does not rebase
absolute paths or choose another tree. Existing symlink aliases of the same root
are accepted.

For a direct `runUsageAudit` call, resolve the config with the same project root
passed to the audit. An enabled audit returns the same error finding on mismatch.
Intentional absolute external `appDir`, server directory settings, and
`usageAudit.include` roots remain supported when config and audit origins agree.
Omitting Doctor's `projectRoot` still avoids optional filesystem inspection;
declaring `config.projectRoot` alone does not opt into it.

## Safe Synthetic Verification

For development tests, create explicit in-memory config values and pass
`env: {}` with no projectRoot when filesystem/DB inspection is unnecessary.
For loader/source/database checks, use inspected disposable modules/fixtures,
disable automatic env-file loading and authorize their effects separately.
A CI typecheck/Doctor script can execute arbitrary project hooks/plugins; inspect
it before `zero update --check`.

A clean report means its configured checks produced no failing findings. It
does not prove provider availability, all permissions, recovery, live Sync,
native platform compatibility or absence of defects.

## Related Guides And Next Steps

[Configuration](./configuration.md) for flags/defaults,
[programmatic reports](./configuration-checks.md) for app-owned CI integration,
[infrastructure reads](./infrastructure-inspection.md) for plane safety, and
[zero-doctor](../tooling/zero-doctor.md) for installed-version launchers.
