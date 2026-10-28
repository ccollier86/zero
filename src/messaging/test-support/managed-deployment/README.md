# Installed messaging deployment qualification

Disposable synthetic fixture, not an application scaffold or production config.
It installs a mounted exact archive, prepares real Guardian/message/Storage state
from source, runs the official `zero build`, then boots `dist/server.js` with
matching retained package/source actors and empty child environments.

Run in a fresh container, with a new external diagnostics directory each time:

```sh
docker run --rm --init --platform linux/amd64 \
  --mount type=bind,src=/absolute/qualified-framework.tgz,dst=/input/framework.tgz,readonly \
  --mount type=bind,src=/absolute/source/src/messaging/test-support/managed-deployment,dst=/fixture,readonly \
  --mount type=bind,src=/absolute/new-diagnostics-directory,dst=/evidence \
  oven/bun:1.3.14-slim bun --no-env-file /fixture/run.ts
```

The loopback synthetic provider is the only AI destination. The proof covers
source-to-bundle migration/fingerprint continuity, actual private bytes, exact
send replay, two simultaneous held AI calls, a foreground write during those
calls, private writer SIGKILL, main-process SIGKILL/restart, and an interrupted
invocation retained for manual review without automatic provider resend.
The five-second write ceiling is a nonblocking acceptance bound, not a production
throughput/latency benchmark. Recovery retries in this fixture are explicit and
retain the original key; they are not hidden production retries.

Reports/logs exclude the generated synthetic credential file. Only newly created
container state is used. Do not mount app data, production volumes, Docker socket,
provider keys or a host home directory. `--init` reaps orphaned fixture workers so
the shutdown checks can distinguish a live child from a zombie process. Record
the final archive commit/hash and run this again if runtime source changes.
