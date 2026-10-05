---
id: zero.frontend.router.sitemap
type: reference
audience: [developer, agent]
owner: frontend-router
status: draft
visibility: internal
system: frontend-router
feature: sitemap
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

# Public Sitemap Discovery

[Router index](./index.md) · [Documentation index](../../index.md)

createApp sitemap is opt-in: omitted/false or enabled=false disables it.
true uses '/sitemap.xml'. An object can set enabled/path/changefreq/priority/
entries/exclude. The server [sitemap configuration](../../backend/configuration/sitemap.md)
owns exact settings.

```ts
const sitemap = {
  path: '/sitemap.xml',
  entries: [{ href: '/articles/introduction', priority: 0.7 }],
  exclude: ['/internal'],
};
```

This createApp option fragment assumes app composition; it does not turn a route
public. Static page routes are discovered from the file tree, with URL-less groups
and inherited auth considered. Dynamic/catch-all instances require explicit entries;
the scanner does not inspect all app data to invent IDs.

An entry has href and optional lastmod(string|Date), changefreq and priority.
Manual entries can deliberately override discovered ones, but operators must ensure
they are intended for publication. exclude applies to discovered/manual paths.
publicUrl or request origin establishes absolute URLs; entries are normalized and
XML-escaped. A module-policy import failure excludes the candidate rather than
weakening protection.

Sitemap is public metadata, not authentication, authorization, SEO correctness or
permission to reveal private tenant identities. Do not add account/secret/resource
URLs simply because a privileged admin knows them. Configuration/import evaluation
is trusted server work and can execute app module code.

## Related Guides And Next Steps

- [Configuration](./configuration.md) owns routing options.
- [Authentication](./authentication.md) owns public route decisions.
- [Segments](./segments-and-groups.md) explains manual dynamic entries.
- [Server sitemap settings](../../backend/configuration/sitemap.md) owns normalization.
