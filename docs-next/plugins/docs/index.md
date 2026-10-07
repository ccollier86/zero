---
id: zero.plugin-docs
type: index
audience: [developer, agent, operator]
owner: docs-plugin
status: draft
visibility: internal
system: docs-plugin
feature: overview
maturity: preview
applies_to: ["2.5.0 source/local release with @zero/plugin-docs 0.1.0"]
modes: [public read-only, development, production]
reviewed_against:
  package: "@zero/framework"
  version: "2.5.0"
  commit: "0ef2cb30d47788722627014c7a28da616f33b5c8"
  snapshot: clean
  date: "2026-10-06"
  evidence_level: source-observed
related_packages:
  - package: "@zero/plugin-docs"
    version: "0.1.0"
    maturity: preview
---

# Markdown Documentation Plugin

[Plugins index](../index.md) · [Documentation index](../../index.md)

`@zero/plugin-docs` turns a selected Markdown folder into a public documentation
section. It is an optional package: an app installs it and declares `docs()`;
the framework does not require its Markdown parsing dependencies.

The reader follows the Elysia documentation layout: grouped left navigation with
nested guide rails, a focused article, right-hand table of contents and quiet
previous/next page links. It uses current Zero tokens and shared controls, not
a separate theme or authentication client.

The current optional preview is **0.1.1** and requires framework **2.6.0 or newer
within major 2**. The reader imports Zero's shared `Kbd`/`KbdGroup` controls even
when search is disabled; a 2.5.x framework does not satisfy this package's peer.
The normal framework updater does not install or upgrade the separate plugin.

## Start With A Folder

Install the optional package alongside a compatible framework release. In an
existing Zero server plugin file, for example `server/plugins/docs.ts` in the
default discovery folder:

```ts
import { docs } from '@zero/plugin-docs';

export default docs({ contentDir: './documentation' });
```

Add `documentation/index.md` and other `.md` pages. The default mount is `/docs`.
Relative paths resolve against the captured app configuration root, not whatever
directory happens to be current when a request arrives.

The build integration was introduced in the 2.5.0 source/local release; a 2.4.x
package does not contain it. That historical 0.1.0/2.5.0 pair does not describe
the current 0.1.1 preview's compatibility floor. The optional package is qualified through fresh
archives, not assumed to exist in a public registry. Follow the
[installation boundary](./operations.md#source-and-local-archive-installation).

## Guides And References

- [Configuration](./configuration.md): options, defaults and complete examples.
- [Authoring](./authoring.md): folders, metadata, links, callouts and code fences.
- [Publication and exclusions](./publication.md): `.docsignore`, private content,
  admitted attachments and the shared projection boundary.
- [Reader and theming](./reader.md): layout, keyboard use, search, motion and
  the optional React composition facade.
- [Search and result navigation](./search.md): indexed content, ranking,
  section targets, Unicode-safe highlights and transient query privacy.
- [Build and operations](./operations.md): required builds, deployment artifacts,
  development refresh, errors and observability.
- [Public API and agent projections](./api.md): exports and exact HTTP readers.
- [Roadmap](./roadmap.md): future authoring, protected mounts and versions.

## Boundaries And Principles

V1 is public and read-only. Guardian sessions are not needed to read its pages;
the renderer does not wait for `AppProvider` session restoration. It must not
be used as a shortcut for exposing private app files or tenant documents.

One immutable **publication manifest** owns pages, links, navigation, headings,
search, Markdown and attachments. A hidden nav item is still a published page;
an excluded page does not exist in any public projection. Plain Markdown is
data, never executable MDX or imported application code.

Source configuration is trusted app code. It chooses the root and namespace.
File content is still untrusted and goes through bounded parsing, URL admission
and safe React rendering. Production uses a compiled snapshot rather than
reading arbitrary files on demand.

## Related Guides And Next Steps

- [Code presentation](../../frontend/components/public-pages/code-block.md)
  covers the shared replacement CodeBlock family used by documentation fences.
- [Design tokens](../../frontend/design-system/index.md) explains the existing
  public/application lanes; neither is an authorization policy.
- [Runtime](../../backend/runtime/index.md) explains plugin setup and shutdown.
- [Qualification ledger](../../_work/audits/docs-plugin-qualification.md)
  distinguishes actual source/browser/archive checks from registry/main publication.
