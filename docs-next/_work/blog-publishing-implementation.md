---
id: zero.work.blog-publishing-implementation
type: architecture
audience: [maintainer, agent]
owner: blog
status: draft
visibility: internal
system: blog
feature: publishing
maturity: experimental
---

# Blog Publishing Implementation Checkpoint

[Working plans](./index.md) · [Publishing API](../backend/blog/publishing-api.md)

Worktree: `zero-platform-array-policy`; branch: `feature/blog-publishing-backend`.
The selected main archive is unchanged. Unreleased work is not update-ready.

## Approved Order

1. Complete and qualify blogging end to end. Finish the backend before choosing
   or replacing the floating text-selection editor toolbar. Public defaults are
   the recovered Magazine and sidebar-TOC article, using Zero tokens and motion.
2. Review and replace the poor logging investigation UI. Preserve the logging
   service/security contract; do not mix a dashboard redesign into publishing.
3. Implement the complete messaging backend. Existing UI and real room typing
   are not durable conversations, send/history APIs, attachments or AI takeover.

## Current Evidence

- Private file/WAL Fabric publishing, draft/public snapshot isolation, revision
  conflicts, idempotent command replay, taxonomy and indexed search have focused
  actor tests.
- Managed `createApp`, real native HTTP and the SDK exercise enrollment,
  publish/edit/withdraw, restart, current-user audit attribution and live changes.
- Actual private PNG upload is normalized to WebP; published references gate
  anonymous delivery, range reads work, and referenced media cannot be removed.
- Main's qualified navigation, audit recovery and avatar fixes are merged into
  the feature branch. No consuming app or production state was changed.
- Real Chromium checks now cover the actual managed build, SSR, enhancement,
  indexed search, rich formatting, draft privacy, accepted publish, noindex,
  sitemap withdrawal and permanent-slug redirects.
- The native writer workspace has a real-browser compose → selection formatting
  → save → publish flow, Save/Discard/Stay and competing-revision preservation,
  also under React StrictMode. Screenshot evidence is retained under the normal
  external diagnostics root, not embedded as a replacement for assertions.
- Bounded native image processing and lease expiry/replacement/cleanup failures
  have focused tests. New 048 migration preservation/collision checks pass, and
  native read/write/publication scopes retain explicit ceilings.
- The focused 22-file regression run passed 98 tests / 2,158 assertions, including
  two fresh-package consumers and real Chromium reader/editor flows. Follow-up
  coverage exercises marked line-break round trips, bounded/cancelled media
  transport, batched public term resolution and retention-enforced metric reads.
  These follow-up changes require their own final candidate run.
- Fresh-process focused follow-ups passed all six selected files (22 tests),
  including exact-post and aggregate live streams, bounded media transport and
  the native StrictMode writer flow. Typecheck, frozen offline install, whitespace
  and the 862-page documentation graph check passed.
- A fresh installed publishing consumer passed source-created state → official
  `zero build` → two compiled server generations, strict audit admission,
  retained identities/history, native normalized image delivery and browser-only
  editor bundling. This host check is not the Linux/amd64 qualification.
- Candidate `32823628d0276fde56f3e78f98e256397a6b1bfb`, archive
  `/Volumes/code-bank/artifacts/zero-platform/dev/blog/3282362/zero-framework.tgz`,
  SHA-256 `89268134a425315b4bf4ff99f0123d564a5f947846269832bfa76adc526632e7`,
  also passed the public consumer protocol in an isolated Linux/x64 Bun 1.3.14
  container: source preparation, official build and two compiled server starts.
  A diagnostic resume and a subsequent fresh synthetic-state run passed. An
  initial run during competing host qualification failed actor startup; the
  underlying reason was not established. No authorization, checksums, startup
  deadlines or runtime behavior was relaxed to obtain the passing runs. This is
  not a cold-start latency/stress guarantee and is not the selected update.
- Full-suite preflight identified existing main failures in a regex import guard,
  historical theme count, and malformed SMTP/IMAP documentation snippets.
  Corrections keep exact real-import checks/retained compatibility mappings and
  compile all 60 service examples. Missing independent Chrome source and payments
  dependencies are qualification prerequisites, not shipped blog dependencies.

The admitted Chrome source fixture is clean child commit
`622ef4e4eeb2577510417d0405286c7771765fe4`, tree
`3a512e1620c18a02bbe4d50cb9b9d569932a5295`, tar SHA-256
`4b61c262ecab99041b3b0c20995f2fe2c540389a7c566de85fc55bf1e0ecc59b`.
It is excluded from the framework archive. Initial full-suite preflight was
stopped after failures; it is not a full-suite pass. Exact final candidate
qualification must be rerun with the declared prerequisites and scratch root.

These are focused checks, not a complete release claim. Exact candidate archive,
installed Linux/bundle qualification and final review remain required.

## Remaining Gates

- [ ] Recovery/authority review: shutdown drain, media lease expiry and retained
  cleanup, strict audit admission and native scope ceilings.
- [ ] Complete review of optional bounded aggregates/collection and current-authority UI;
  never claim unique people, attention or audit evidence.
- [ ] Expanded public reader and editor/media/taxonomy/author browser checks;
  existing passing flows do not establish every interaction or package shape.
- [ ] Expanded single/multi-tenant and simple/advanced RBAC tests, disabled and
  migrate:false behavior, additive migrations and source/bundle identity.
- [ ] Current API/configuration/operations/upgrade docs, browser evidence,
  installed Linux qualification, review and qualified release archive.

Do not reset data, alter prior migration checksums, replace Guardian identities,
publish private avatars, loosen admission or expose private Storage paths to
make a test pass. The blog remains one application-owned Fabric file in either
tenancy mode by default; explicit organization ownership is a compatibility opt-in.
