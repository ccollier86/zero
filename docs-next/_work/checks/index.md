---
id: zero.documentation-checks
type: index
audience: [agent, maintainer]
owner: zero-documentation
status: in-review
visibility: internal
---

# Documentation Checks

[Working evidence](../index.md) · [Documentation index](../../index.md)

These are rebuild-only authoring checks, not shipped Zero commands or agent
hooks. They use Bun's file, glob and YAML APIs and read only the new Markdown
tree and explicitly linked local files. They do not import app configuration,
load environment files, run Doctor, open databases or call providers.

- [Navigation and metadata checker](./check.ts): unique IDs, required metadata,
  local targets/anchors, section indexes, parent backlinks and public/internal
  link isolation. Run from the repository with
  `bun --no-env-file docs-next/_work/checks/check.ts`.
- [Markdown evidence parser](./markdown.ts): strips fenced examples from link
  checks and extracts explicit links, front matter and GitHub-style headings.
- [Inventory placement report](./coverage.ts): measures which inventoried
  feature groups have their declared draft guide on disk and reports remaining
  gaps per system. This does not measure source accuracy, example depth, review
  or release readiness. Run
  `bun --no-env-file docs-next/_work/checks/coverage.ts`.
- [Inventory parser](./coverage-parser.ts) and
  [regressions](./coverage-parser.test.ts): preserve feature-prefixed names,
  differently ordered columns and rooted/section-relative guide plans.
- [Named-symbol home check](./catalog-homes.ts),
  [parser](./catalog-home-parser.ts) and [tests](./catalog-home-parser.test.ts):
  ensure every catalogued component/hook/support/SDK record has a real reader
  home, not only a planned path or a source link. This measures placement, not
  prop/method accuracy. Run `bun --no-env-file docs-next/_work/checks/catalog-homes.ts`.
- [Parser regression tests](./markdown.test.ts): synthetic in-memory cases;
  run `bun --no-env-file test docs-next/_work/checks/markdown.test.ts`.
- [AI example typecheck](./ai-examples.test.ts): reads the actual complete
  configuration/service examples and compiles them against public AI source
  exports with an in-memory TypeScript host. It does not execute app config,
  environment reads or providers. Run
  `bun --no-env-file test docs-next/_work/checks/ai-examples.test.ts`.
- [Platform example typecheck](./platform-examples.test.ts): selected actual
  Schema, ReactiveDB, runtime and configuration code fences, including the actual
  organization-assembly and lazy user-owned multi-file TS/TSX modules. Relative
  imports resolve through virtual files/directories; dependent fragments are
  assembled only where the documentation labels them. Uses an in-memory host;
  does not execute config, start a listener or open databases. Run
  `bun --no-env-file test docs-next/_work/checks/platform-examples.test.ts`.
- [Guardian example typecheck](./guardian-examples.test.ts): actual Guardian
  TypeScript examples checked in memory against public source facades, without
  executing account/bootstrap/credential operations. Run
  `bun --no-env-file test docs-next/_work/checks/guardian-examples.test.ts`.
- [Native SDK example typecheck](./native-examples.test.ts): framework browser
  broker and Chrome-extension examples checked against their actual source
  exports in memory. This does not build/run the separate Rust or extension
  packages or qualify their distribution. Run
  `bun --no-env-file test docs-next/_work/checks/native-examples.test.ts`.

- [Torrent and automation example typecheck](./workflow-examples.test.ts): actual
  complete backend declarations, targeted-reply task modules and frontend monitoring code fences, compiled
  against public source exports in memory. No app config, database, activity,
  provider or listener is executed. Run
  `bun --no-env-file test docs-next/_work/checks/workflow-examples.test.ts`.

- [Doctor, design-system and overlay example typecheck](./tooling-design-examples.test.ts):
  actual complete public API/component fences compiled with an in-memory
  TypeScript host. It does not load app config, run Doctor, initialize providers,
  render a browser or execute CLI installation/update commands. Run
  `bun --no-env-file test docs-next/_work/checks/tooling-design-examples.test.ts`.

- [Frontend UI example typecheck](./frontend-ui-examples.test.ts): actual AppShell,
  primitive, text, sensitive-display and public-page code fences checked in memory
  through the public source import routes. No client/provider, app, browser,
  transport or persistence operation runs. Execute alone in a coordinated compiler
  window: `bun --no-env-file test docs-next/_work/checks/frontend-ui-examples.test.ts`.

- [Guardian, Storage and small-service example typecheck](./storage-service-examples.test.ts):
  all 50 actual TS/TSX fences in the Guardian/Storage UI, Email, Notifications, Rooms,
  Tokens, Observability, KV and PDF families compile against public source
  facades using an in-memory host. It does not execute an example, configuration,
  provider, database, file storage or browser. Run
  `bun --no-env-file test docs-next/_work/checks/storage-service-examples.test.ts`.

The checker establishes structural validity only. It cannot prove source
accuracy, reciprocal link usefulness, licensing, support status, example
correctness or artifact contents. Those remain independent review gates.
