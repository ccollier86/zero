---
id: zero.doctor.config-loading
type: architecture
audience: [developer, agent, operator]
owner: doctor
status: draft
visibility: internal
system: doctor
feature: config-loading
maturity: supported
applies_to: ["2.1.1 source; publication qualification pending"]
modes: ["configuration values", "trusted CLI modules", "explicit infrastructure snapshots"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Config Discovery Executes Trusted Modules

[Doctor index](./index.md) · [Documentation index](../../index.md)

`resolveDoctorConfigPath(input?)` resolves an explicit path, otherwise checks
these names in order under the current directory:

1. zero.config.ts
2. zero.config.js
3. config/zero.config.ts
4. config/zero.config.js

Absent match returns null. Explicit path resolution does not prove the file
exists or is safe; loading can fail afterward.

`loadDoctorConfig(modulePath)` asynchronously imports the module, choosing
`config`, then `appConfig`, then `zeroConfig`, then `default`. The selected
export must be an object. Imports execute top-level code; it is the app author's
responsibility to keep config definitions separate from server startup.

## Resources And Root Resolution

Root is the config directory, except a directory named config resolves one
level above. Unless `serverResourcesDir: false`, loader imports resource
definitions from configured directory or ./server/resources, relative to that
root (absolute directories remain absolute). It appends discovered resources
after explicitly configured resources. This matches startup definition loading,
not a promise that all app code can be safely evaluated.

Complete loader usage example, **executes trusted modules if run**:

```ts
import { loadDoctorConfig, resolveDoctorConfigPath, runPlatformDoctor } from "@zero/framework/doctor";

const path = resolveDoctorConfigPath("./zero.config.ts");
if (!path) throw new Error("Config path required");
const config = await loadDoctorConfig(path);
const report = runPlatformDoctor(config, { env: {}, usageAudit: false });
export { report };
```

env:{} affects selected resolution checks; it does not stop imported code from
reading ambient variables, starting servers or accessing files. This example
is an API contract demonstration, not executed against an actual app.

## Related Guides And Next Steps

[Configuration](./configuration.md) owns option precedence,
[configuration resolution](../../backend/configuration/resolution.md) owns the
platform resolver, and [infrastructure inspection](./infrastructure-inspection.md)
explains additional reads when projectRoot is supplied.
