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
- [Phase 2: Middleware Matchers And Policy](./phase-2-middleware-policy.md):
  implemented matcher and authorization policy contract for app-owned
  middleware.
- [Phase 3: Unified Backend Context](./phase-3-backend-context.md): canonical
  app-facing `zero` backend service context, compatibility aliases, and lazy
  optional-service behavior.
- [Phase 4: Service API Smoothing](./phase-4-service-api-smoothing.md):
  canonical service method aliases and grouped storage APIs for app-owned
  backend code.
- [Phase 5: Resource And Policy API Plan](./phase-5-resource-policy-plan.md):
  planned resource declarations, trusted user-property policy rules, CRUD
  generation, `/api/data`, sync, and doctor integration.
- [Framework Developer Surface](../framework-developer-surface.md): current
  package-mode usage surface, imports, generated app shape, and examples.

## Working Rule

When framework-mode behavior changes, update the relevant document here and
link out to feature docs instead of duplicating entire subsystem manuals.
