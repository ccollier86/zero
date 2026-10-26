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
