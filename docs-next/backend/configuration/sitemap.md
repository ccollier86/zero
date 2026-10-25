---
id: zero.configuration.sitemap
type: how-to
audience: [developer, agent, operator]
owner: platform-configuration
status: in-review
visibility: internal
system: platform-configuration
feature: sitemap
maturity: supported
applies_to: ["2.6.0 SEO extension on feature/seo-foundation; pin the qualified archive"]
modes: [managed-server]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "e6a817b87e9f661af0b9a44b14caed3733993c96"
  snapshot: clean
  date: "2026-10-25"
  evidence_level: package-qualified
  artifact:
    version: "2.6.0"
    commit: "e6a817b87e9f661af0b9a44b14caed3733993c96"
    sha256: "02e7ca3c2b1ea6da43ed45087674fea3c37c515d19d977b4457b37b8e1a3d97d"
---

# Generate A Public Sitemap

[Configuration index](./index.md) · [Documentation index](../../index.md)

Sitemap support is opt-in. `sitemap:true` mounts `/sitemap.xml`; an SEO object
with trusted app.publicUrl also enables it when omitted. Explicit false disables
it. An object can change defaults and supply deliberate dynamic entries. The
[SEO extension](./seo.md) describes the feature-branch/archive applicability.

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
Manual entries that match a file page must pass its inherited authorization and
metadata test too; they cannot reintroduce protected or noindex routes. Dynamic
metadata receives that entry's matched params. Explicit plugin/CMS URLs with no
file page remain an application publication declaration, not inferred authority.
Exclusions apply to discovered, contributed and manual entries, including
absolute URLs on the same site, with exact/boundary-prefix path matching.

The SEO-enabled docs plugin contributes only its current admitted public page
manifest. Metadata canonicals determine the final URL; noindex pages and foreign
origins are omitted. Sitemap generation does not run page loaders. A page or
layout metadata function may execute trusted app code and should remain public,
bounded and side-effect-free.

Entries are deduplicated by normalized href and sorted. Manual entries replace
the discovered entry for the same href. URLs use app.publicUrl when supplied,
otherwise the legacy explicit-sitemap request-origin fallback; production should
always set a trusted public URL. XML values are escaped. A single sitemap is
bounded to 50,000 URLs and 50 MiB of uncompressed XML, following the
[sitemap protocol](https://www.sitemaps.org/protocol.html). Generation/publication
failures return a safe 503 and ZERO_SEO_DISCOVERY_FAILED rather than stale or
partial XML. SEO indexing=false yields an empty page list.

## Verification

Test public/private inherited routes, groups/dynamic paths, exclusion boundaries,
duplicate manual overrides and XML escaping in a synthetic route fixture.
Check that authenticated application URLs never leak through manual entries.

## Related Guides And Next Steps

- [Routing](./routing.md) owns public/protected page policy.
- [App identity](./app-identity.md) sets the trusted public origin.
- [Directories](./directories.md) identifies the file-router tree.
