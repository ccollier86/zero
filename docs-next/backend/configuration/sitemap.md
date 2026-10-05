---
id: zero.configuration.sitemap
type: how-to
audience: [developer, agent, operator]
owner: platform-configuration
status: draft
visibility: internal
system: platform-configuration
feature: sitemap
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [managed-server]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Generate A Public Sitemap

[Configuration index](./index.md) · [Documentation index](../../index.md)

Sitemap support is opt-in. `sitemap:true` mounts `/sitemap.xml`;
false/omitted disables it. An object can change defaults and supply deliberate
dynamic entries.

```ts
// AppConfig fragment
app: { publicUrl: 'https://app.example.test' },
sitemap: {
  path: '/sitemap.xml',
  changefreq: 'weekly',
  priority: 0.5,
  entries: [{ href: '/articles/example', lastmod: '2026-10-05' }],
  exclude: ['/internal-preview'],
},
```

These are public URLs, not permission grants. Do not manually list private
organization/user routes.

## Exact Options

| Option | Accepted value / omitted behavior |
| --- | --- |
| `enabled` | boolean; false disables the object form |
| `path` | string; /sitemap.xml, leading slash added when absent |
| `changefreq` | always/hourly/daily/weekly/monthly/yearly/never; omitted |
| `priority` | number; omitted |
| `entries` | readonly list; [] |
| `exclude` | readonly path/URL list; [] |

Each entry has required href and optional lastmod (string or Date), changefreq
and priority. Per-entry frequency/priority overrides global defaults. Numeric
priority is clamped to 0–1 and formatted; invalid NaN is omitted. Date lastmod
uses ISO formatting; string lastmod is supplied by the app.

## Discovery And Overrides

The generator discovers static page routes and their inherited layout/page auth
requirements. Protected routes are excluded. Dynamic/catch-all routes require
manual entries because the file tree cannot enumerate valid parameters.

Route config imports execute code; an import failure is treated as protected.
Manual entries are deliberate overrides and are not passed through the discovered
route authorization test—review them explicitly. Exclusions apply to discovered
and manual entries, with exact/boundary-prefix path matching.

Entries are deduplicated by normalized href and sorted. Manual entries replace
the discovered entry for the same href. URLs use app.publicUrl when supplied,
otherwise the request origin; deployment configuration should set a trusted
public URL. XML values are escaped.

## Verification

Test public/private inherited routes, groups/dynamic paths, exclusion boundaries,
duplicate manual overrides and XML escaping in a synthetic route fixture.
Check that authenticated application URLs never leak through manual entries.

## Related Guides And Next Steps

- [Routing](./routing.md) owns public/protected page policy.
- [App identity](./app-identity.md) sets the trusted public origin.
- [Directories](./directories.md) identifies the file-router tree.
