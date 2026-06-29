# Framework Docs

This folder owns Zero's framework-mode documentation: create-app/package-mode
behavior, app-owned extension conventions, Zero-native backend APIs, and
standardized backend/frontend framework surfaces.

Use this folder for docs that explain how Zero behaves as an installed
framework. Keep feature-specific implementation docs in their existing folders
when the topic is mostly about one subsystem such as auth, sync, storage, AI,
vector, workflows, observability, or migrations.

## Documents

- [API Standardization Plan](./api-standardization-plan.md): phased plan for
  Zero-native backend extensions, middleware matchers, resources, actions,
  frontend parity, generators, and documentation standardization.
- [Phase 1: Backend Extensions](./phase-1-backend-extensions.md): contract for
  Zero-native endpoints, routers, middleware, plugins, loader behavior, and
  acceptance criteria.
- [Framework Developer Surface](../framework-developer-surface.md): current
  package-mode usage surface, imports, generated app shape, and examples.

## Working Rule

When framework-mode behavior changes, update the relevant document here and
link out to feature docs instead of duplicating entire subsystem manuals.
