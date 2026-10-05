---
id: zero.cli.tooling.maintainer-scripts
type: reference
audience: [developer, agent, operator]
owner: cli-tooling
status: draft
visibility: internal
system: cli-tooling
feature: maintainer-scripts
maturity: supported
applies_to: ["2.1.1 source; publication qualification pending"]
modes: ["Bun package-mode applications", "trusted local development"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Framework Maintainer Scripts

[Tooling index](./index.md) · [Documentation index](../../index.md)

These scripts belong to the framework repository, not ordinary application
runtime APIs. Inspect their exact package scripts before invocation; their names
do not promise read-only verification.

| Entry | Responsibility |
| --- | --- |
| create-project.sh | legacy creation wrapper; accepts target/skip-install/create options and delegates creation |
| bun run version:bump | scripts/bump-version.ts updates semver release metadata according to its arguments |
| bun run private-imports:sync | regenerates framework-owned private-import mappings |
| bun run auth:psl:update | refreshes the public suffix data used by auth domain policy; network/generated source effects |
| bun run install:local-tools | installs external launchers and managed Git hooks |
| build / build:binary | build outputs; binary builds the CLI dispatcher, not every app as a complete deployable binary |
| test:package | focused package/distribution/update tests, including disposable install fixtures |

Do not use version bump/source generation/hooks as an app fix without separate
authorization. User work in a dirty checkout must be preserved. A successful
test script does not publish a package or prove an installed archive matches it.

[Public dispatch](./dispatch.md) and [saved releases](./releases.md) are the normal
CLI boundary. [Agent verification](../../agents/tooling/verification.md) describes
choosing scoped checks rather than invoking every maintainer script.
