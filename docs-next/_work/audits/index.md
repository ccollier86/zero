---
id: zero.documentation-audits
type: index
audience: [agent, maintainer]
owner: zero-documentation
status: in-review
visibility: internal
---

# Whole-Platform Documentation Audit

[Working evidence](../index.md) · [Documentation index](../../index.md)

This is the source-backed inventory and review ledger for the isolated rebuild.
It is internal preparation, not released API documentation or a security
certification. Existing docs are research input; contracts are reconciled
against code, public exports, runtime composition and actual checks.

## Evidence And Progress

- [2.4.2 array/trigger update](./trigger-production-update.md): scoped correction,
  independent review, synthetic regression and package-consumer evidence.

- [System registry](./systems/index.md): each discovered system and its features.
- [Public-surface catalogs](./catalogs/index.md): package paths, component/hook
  symbols, SDK members and source ownership.
- [Execution ledger](./execution.md): gates, checks run and outstanding work.
- [Findings and corrections](./findings.md): confirmed defects, approved fixes,
  documentation mismatches and remaining verification.
- [Experience reader walkthrough](./experience-reader-review.md): source-backed
  dry single/multi-mode tasks and Storage/Guardian/native/service trust decisions;
  explicitly not app execution or artifact qualification.
- [Task-guide walkthrough](./task-reader-review.md): docs-first independent
  construction plans, concrete assembly gaps and matched workflow corrections;
  explicitly not a fresh-history or installed-package qualification.
- [Data Studio UI follow-up](./data-studio-ui-review.md): scoped component reuse,
  virtual/progressive grid contracts, source-identity correction and focused evidence.
- [Documentation-plugin qualification](./docs-plugin-qualification.md): supplemental
  optional reader, shared CodeBlock replacement, native builds, confirmed fixes
  and actual source/browser/installed/compiled evidence for the main-branch 2.5.0
  release; Git release, registry publication and public-tree cutover are separate.
- [Informal naming candidates](./naming.md): approved aliases and unapproved
  suggestions, explicitly separate from API/import/config names.

## Original Baseline And Scope

Runtime source: clean committed `main`
`a3a5f726768dac890f241a3899c0a1acb66265d9`, framework `2.1.1`.
Documentation branch: `feature/production-documentation-foundation`.
Documentation baseline: `cd643b5b862f83b4ab40320486e1b89df1154c87`;
New documentation remains under `docs-next/`; approved focused defect fixes
also touch their owning runtime/tests/package surfaces.

Source-observed is not package-qualified. Audit scripts read source declarations
only: they do not evaluate application config, read real environment files,
open databases, run Doctor, invoke providers or launch apps. Separate SDKs retain
their own version/commit/maturity records. Current docs, release settings,
active agent instructions and applications remained unchanged during that
original inventory pass. The user approved
correction of all confirmed defects; working runtime/package diffs are recorded
separately in the findings ledger.

Detailed feature rewriting begins after the complete inventory is reconciled
and independently reviewed. Actual implementation defects are corrected under
the granted authority, not converted to documentation caveats. Material new
feature or publication decisions retain their separate approval boundaries.

## Current Documentation Checkpoint

The first draft and subsequent feature guides are now package-local on `main`.
The approved 2.4.1 handoff routes README, Start Here, knowledge files and scaffold
guidance to the new tree while preserving compatibility docs. The 2.5.0
documentation reader/search and CodeBlock release has separate final archive
and compiled-browser evidence in its qualification ledger.

Those later approvals supersede the original no-cutover scope only where
explicitly recorded. They do not mark every draft guide verified, authorize
public-site publication, or erase the original source baseline. The
[execution ledger](./execution.md) separates completed navigation/writing from
remaining whole-set qualification.
