# Changelog

All notable Zero Platform changes are tracked here.

## 1.0.0 - 2026-06-28

Initial versioned platform release.

### Platform

- Hardened the Elysia/Bun backend foundation with stricter sync policy, safer `/api/data` querying, result limits, pagination, sorting, filtering, and platform doctor guidance.
- Added first-class migration tooling with status, planning, rollback safety classification, schema history, drift checks, and doctor integration.
- Added centralized observability contracts, stable event codes, default sinks, frontend reporting, and a protected platform event endpoint.
- Added auth account lifecycle support for controlled registration, admin-created users, password reset/setup flows, email delivery through the platform email service, and admin user management capabilities.
- Added natural identity support for relationship-style tables so apps can keep one ReactiveDB sync primary key while enforcing composite uniqueness semantics.
- Added AI service integration for Vercel AI SDK providers, model aliases, provider readiness, conversation helpers, workflow bridges, tool registration, and documentation for required provider environment variables.
- Added zvec-backed vector storage with collection management, query helpers, AI bridge utilities, doctor checks, and documentation.

### Frontend

- Added and documented reusable admin user management, storage management, data table, details view, auth, storage, sync, workflow, AI, vector, upload, and platform-specific hooks.
- Added a generic hook library for common React behavior such as idle detection, clipboard, click-away, OS detection, text selection, debounce, and throttle helpers.
- Added Animate UI animated Lucide icons as the default platform icon pack through `@platform/frontend/icons`.
- Improved auth persistence and session refresh behavior so expired or invalid sessions redirect through the configured login route.

### Tooling And Docs

- Added `docs/start-here.md`, platform feature docs, frontend hook/icon docs, AI/vector docs, and updated environment examples.
- Added `bun run version:bump -- <semver>` for explicit package version metadata updates.
