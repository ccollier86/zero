---
id: zero.plugin-docs.operations
type: operations
audience: [developer, agent, operator]
owner: docs-plugin
status: draft
visibility: internal
---

# Build And Operate Documentation

[Docs plugin index](./index.md) · [Documentation index](../../index.md)

The native plugin declares a **required build contribution**. Publication
compiles bounded Markdown, resolves links/attachments, prepares syntax highlighting
and produces an immutable snapshot before runtime setup. A failed required
contribution rejects the build/startup; it does not render an empty successful
site or publish arbitrary source files.

## Development

Ordinary app startup discovers the plugin declaration once, builds its
enhancements and shared styles, and mounts that same declaration. Runtime setup
uses captured project/app directories and app-bound observability. It does not
guess the consuming app's React installation or recalculate paths from mutable
working directories.

With `watch: true`, file edits, additions, removals and ignore-policy changes
withdraw the previous public snapshot immediately. A coalesced, complete valid
rebuild replaces it. Overlapping old work cannot publish after newer input or
shutdown. Readers temporarily receive a safe `503` during an invalid/pending
rebuild, including attachment requests; unpublished diagnostics are not sent
through the public docs API.

Correct the source/ignore/link error and refresh the page after the new snapshot
is admitted. V1 provides server refresh, not an additional browser live-editing
protocol. Closing the app drains and disposes the watcher before its service
dependencies disappear.

## Production

Use the framework's [declared app-build workflow](../../cli/tooling/build.md),
not an isolated browser bundle. The
[native build-contribution contract](../../backend/runtime/build-contributions.md)
owns discovery, private artifacts, public asset graphs and runtime setup inputs.
It prepares the private content manifest, namespaced public reader script/CSS,
shared style bundle and private referenced files. The original app entry,
configuration exports and custom hooks remain the application's own code.

Production requires the compiled frontend build manifest. Missing or mismatched
required artifacts are errors; production does not silently scan source and
recompile a different documentation site. A docs-only deployment can run without
the original Markdown folder or framework source/node_modules when bundled or
compiled with the supported build workflow. Ordinary file-page apps retain
their documented source-deployment requirements; this is not a promise that
every application route is automatically compiled into an executable.

When testing **unpublished local archives** on Bun 1.3.14, the isolated installed
fixture uses a root `overrides` entry pointing `@zero/framework` to the exact same
framework archive as its root dependency. That resolves the optional package's
framework peer without querying for a nonexistent public registry version.
This local-fixture resolution is not a source patch or a substitute for normal
compatible registry dependencies. The release evidence records both archive
versions and SHA-256 rather than pretending that a registry release exists.

Keep compiled content/private attachments outside public `/_build`. Only reader
JS/CSS and explicitly public build assets belong there. Do not replace the safe
attachment route with a static content-directory mount.

The native browser-entry build path admits the canonical source and bytes through
the framework's shared file reader before bundling. Declared `contentHash` and
`sourceRoot` are enforced, then those admitted bytes are compiled with normal
relative import/chunk resolution. Imported dependencies remain trusted app build
code; this is not an imported-dependency sandbox. A wrong hash or out-of-root
entry fails the build instead of silently generating a script.

## HTTP Cache And Security Policy

Nonce-bearing documentation HTML uses `Cache-Control: private, no-store` and
never returns 304, including for a matching or wildcard `If-None-Match`. The
quoted HTML ETag hashes the complete emitted representation, including its
frontend script/CSS URLs and nonce. Each request receives a fresh CSP nonce
matching its markup; a 304 must not replace the CSP while retaining an old body.
Deployment changes therefore cannot retain obsolete asset references through
the former content-only HTML validator.

Public JSON/Markdown/agent-index/sitemap projections and admitted attachments
use `public, max-age=0, must-revalidate`. Text projection validators hash emitted
text and media type, not one shared site hash; attachment validators use their
admitted bytes. Current snapshot admission runs before conditional success.
Weak entity tags and complete quoted lists are supported. Malformed validator
lists are ignored, not accepted by substring matching.

GET and HEAD preserve status and representation/security metadata. HEAD omits
the body only after HTML rendering and final snapshot admission, so it exposes
the same render failures and retired-generation fences as GET. Fresh nonce
values naturally differ between separate requests. Safe errors and ordinary
404 HTML are non-cacheable. Successful reads use explicit media types and
`X-Content-Type-Options: nosniff`; HTML additionally carries a nonce-based CSP.

Configure a reverse proxy/CDN to honor these policies. Do not add a blanket
HTML cache or static source-folder mount in front of the publication boundary.
Browser/service-worker caches under app control need the same discipline;
the plugin cannot recall a file that a reader already downloaded.

## Errors And Observability

`DocsContentError` carries stable `code` and bounded source-relative diagnostics.
Initial authoring errors can identify the file/field/line without exposing an
absolute local path. Compiler codes distinguish config/source/metadata/Markdown,
route conflicts, links, assets, ignore inputs, limits and an empty collection.

Public HTTP errors use safe `{code, error}` bodies. Unknown ordinary docs pages
get a themed 404 reader; API/asset misses return safe errors. Rebuild errors
are non-cacheable. GET and HEAD errors retain the safe status/content/security
contract, with no body for HEAD. Successful reads follow the representation-
specific cache policy above, not a single blanket revalidation rule.

Standard events include `DOCS_CONTENT_COMPILED/FAILED`, `DOCS_STARTED/STOPPED`,
`DOCS_REQUEST_FAILED`, `DOCS_REBUILD_FAILED` and frontend search/hydration failure.
Events use the framework sink with aggregate stage/count data; no page text,
credential, private filename or raw search phrase is included by default.
Custom proxy access logs can still record the query URL; apply query redaction
there if that is part of the application's privacy requirements.

## Verification Before Shipping

1. Start from a compatible **installed** framework and optional package.
2. Verify anonymous SSR, ordinary links and code with JavaScript disabled.
3. Verify search, mobile navigation, light/dark and keyboard focus with JS.
4. Exclude a page/attachment and verify absence in every projection.
5. Build and start the resulting production artifact without the source folder.
6. Check stable config identity, representation validators, fresh nonce CSP,
   GET/HEAD, missing artifacts and shutdown.
7. Repeat search at a short/keyboard-shrunk viewport, invoke it from an open
   mobile drawer, test native modified links and clear destination highlights.

Source tests, actual styled-browser checks and installed artifact qualification
prove different things. This document remains a draft until its release evidence
is recorded; it is not itself proof that all release gates passed.

## Related Guides And Next Steps

- [Publication](./publication.md) owns the security/classification policy.
- [API](./api.md) supplies the endpoint acceptance list.
- [Search](./search.md) supplies query bounds, index lifetime and privacy checks.
- [Verification](../../guides/verification.md) explains evidence levels.
- [Runtime](../../backend/runtime/index.md) explains platform drain ownership.
- [Build command](../../cli/tooling/build.md) gives the exact command/options and
  source-deployment versus standalone deployment conventions.
