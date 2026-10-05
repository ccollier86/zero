---
id: zero.frontend.router.segments-and-groups
type: reference
audience: [developer, agent]
owner: frontend-router
status: draft
visibility: internal
system: frontend-router
feature: segments-and-groups
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR, Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Dynamic Segments, Catch-Alls And Groups

[Router index](./index.md) · [Documentation index](../../index.md)

Static directories become URL segments. [id] captures one segment; [...path]
captures a nonempty remainder. (group) organizes files/layouts without adding
that name to the URL.

| File path | URL pattern / parameters |
| --- | --- |
| app/tasks/[taskId]/page.tsx | /tasks/[taskId], params.taskId |
| app/docs/[...path]/page.tsx | /docs/[...path], params.path |
| app/(public)/about/page.tsx | /about, group layout may still wrap it |

Static matches precede dynamic and catch-all candidates. URL-less groups preserve
layout ancestry and auth requirements: a folder called (public) is not itself a
public-access declaration. Define publicness through app/route config.

MatchResult includes pattern, params, layouts, pagePath, notFoundPath and
apiRoutePath. RouteNode/MatchResult types are public support types; scanner/tree
constructors are internal runtime machinery, not a plugin API to import by path.

Use [parameter validation](./loaders-and-validation.md) before interpreting an ID
or constructing data access. Matched text is not proof of existence, ownership,
safe SQL syntax or an admitted tenant selector. Use schema/domain validation
and bound service methods; never concatenate path values into SQL.

The catch-all shape is a string remainder, not an inferred array API. Optional
catch-all conventions from another router must not be assumed implemented.
Navigation manifests match patterns; query/hash remain URL state, not extra
path parameters.

## Related Guides And Next Steps

- [File routes](./file-routes.md) owns module conventions.
- [Validation](./loaders-and-validation.md) owns safe parameter use.
- [Provider hooks](./provider-and-hooks.md) exposes matched browser params.
- [Authentication](./authentication.md) owns inherited group/layout authority.
