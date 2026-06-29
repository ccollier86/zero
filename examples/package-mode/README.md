# Zero Package-Mode Fixture

This fixture shows the target app shape for a generated Zero app. It imports
the framework through `@zero/framework/*` only; app-owned code lives beside the
config, pages, data schema, and server routes.

Run from the repository root while this fixture is being developed:

```sh
bun build examples/package-mode/app/server.ts --target bun --outdir .zero/package-mode-fixture-build
```

Generated starter projects should use the same structure, but with Zero
installed as a dependency instead of living in this repository.
