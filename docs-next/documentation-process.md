---
id: zero.documentation-process
type: how-to
audience: [agent, maintainer]
owner: zero-documentation
status: draft
visibility: internal
---

# Documentation Process

This procedure turns a verified platform inventory into production-quality
developer and agent documentation. It also defines how that documentation
stays accurate as Zero changes.
This procedure is internal maintainer guidance. The public documentation will
have its own verified reader navigation, independent of working evidence.

[Documentation index](./index.md) · [Documentation standards](./documentation-standards.md)

## Before Starting

1. Read the [standards](./documentation-standards.md), especially isolation,
   authority, navigation, and evidence requirements.
2. Confirm the branch, Zero version, source commit, and worktree changes.
   Preserve unrelated user work and record the actual verification baseline.
3. Keep organized documentation in `docs-next/`. The initial rewrite used a
   separate documentation branch; focused feature releases now maintain the
   approved primary package/agent entrances alongside their canonical guides.
4. Keep inventories, findings, templates, and review notes under `_work/` with
   internal visibility. A future site must exclude them from publication/search.
5. Read-only inspection is the default audit activity. Do not execute imported
   application configuration, open live databases, or run application scripts
   merely to enumerate a feature. Such actions have their own trust and scope
   requirements.
6. Do not read real `.env` files or retain secrets, sensitive records, raw
   headers, or unredacted logs in inventories. Configuration/Doctor imports
   execute code: use inspected trusted modules, synthetic env, and disposable
   fixtures for authorized verification, with automatic env-file loading disabled.
   State each command's side effects; do not implicitly run app hooks/scripts,
   migrations, external-provider requests, or live-data checks.

## Audit Every System Before Feature Rewriting

### Establish The Whole-Platform Map

Create an internal system registry and one Markdown inventory per system under
`_work/audits/systems/`. The registry must have a linked section index; every
inventory must link back to it. Start with the
[system inventory template](./_work/templates/system-inventory.md).
When copying any template, rebase every relative link for its destination
directory, replace the parent-index backlink, and remove template-only drafting
instructions. Then verify every target and anchor.

Discover systems from source modules, package exports, app composition, CLI
dispatch, examples, and existing docs—not solely from named product brands.
Cover backend systems, cross-cutting runtime infrastructure, frontend components
and hooks, client/native SDKs, CLI/development tooling, and agent-facing files
or tools. Record separately maintained SDK/package boundaries rather than
assuming they ship with the core framework.

For each system:

1. Identify purpose, responsibility, public imports, and configuration.
2. Enumerate every feature and its server, SDK, hook, component, and CLI surfaces.
3. Trace dependencies and integration paths, including data planes, authority,
   transport, reactivity, lifecycle, errors, and observability.
4. Locate relevant implementation, tests, examples, release evidence, old docs,
   historical rationale, and known future plans.
5. Classify capability maturity and relevant modes. Do not infer support from
   a source file's existence.
6. Assign each public feature a canonical documentation destination, parent
   index, relevant configuration sections, and cross-feature links.
7. Record contradictions, unverified claims, missing coverage, and actual
   defects with concrete evidence and a disposition.

Do not mark the whole-platform map complete while a discovered subsystem or
public surface lacks an inventory destination. Perform a coverage reconciliation
against package exports and runtime composition. The inventory stage is a
feature/contract audit, not a claim that a comprehensive security audit passed.

### Resolve Findings Honestly

For each finding, record what was observed, the expected public contract,
evidence, affected modes/versions, and whether it concerns implementation,
documentation, release status, or missing verification.

Correct confirmed platform defects rather than documenting around them: the
user has explicitly authorized these fixes and focused regression tests for
this rebuild without per-defect questions. Preserve normal engineering review
and record expected behavior, the failing reproduction and verification. This
does not authorize unrelated roadmap implementation or app/live-data changes.
Keep drafts visibly unresolved when a correct contract cannot yet be established;
never mark them verified through a workaround or a caveat that conceals a defect.

## Write One System At A Time

Begin detailed rewriting after the whole-platform inventory is reviewed.

1. Read the system inventory and its relevant source, tests, existing docs,
   and integration evidence.
2. Create the system folder and `index.md`; link the folder into its parent
   index immediately. Keep planned pages as plain paths until they exist.
3. Write focused feature guides using the
   [feature guide template](./_work/templates/feature-guide.md).
4. Write the configuration reference when applicable. Link options to features
   and features back to the relevant configuration sections.
5. Write the roadmap from known plans and explicitly labeled ideas. Separate
   implementation findings from product expansion proposals.
6. Finish the index with a concise overview, terminology, supported modes,
   feature map, integration links, and established/inferred philosophy.
7. Complete the system's related frontend, CLI, and agent-facing documentation
   homes or record their outstanding status. Do not call end-to-end coverage
   complete solely because the backend pages exist.
8. Update the inventory to link to the authoritative pages and evidence. Keep
   the inventory as a coverage/review ledger, not a duplicate feature manual.

Use metadata as defined by the standards. `reviewed_against` should record the
Zero version and source commit actually inspected, plus verification date where
useful. Record broader supported version ranges only when established by the
contract and corresponding evidence.

## Build The General Guides And Agent Entrance

After system contracts are available, assemble:

- A concise main index linking every reader-facing section index.
- Start Here, introducing Zero and a minimal verified application-building path.
- Shared concept guides to avoid repeating cross-cutting contracts.
- Task guides connecting features in the order a developer or agent needs them.
- Focused agent onboarding that explains use-first behavior, mode selection,
  public imports, engineering boundaries, and relevant checks.
- Instructions/tooling documentation that distinguishes existing files and
  commands from proposed hooks, skills, scripts, catalogs, or MCP adapters.

Use one maintained feature-to-document map for these entry points. Check its
public symbols against the installed package; do not invent runtime capabilities
from descriptive metadata. No new discovery or automation tool is implied by
writing this procedure.

## Add Or Update Documentation After A Feature Change

1. Identify the feature's canonical page, configuration reference, parent index,
   affected concept/task guides, and frontend/CLI/agent consumers.
2. Update the actual contract and relevant examples first.
3. Update applicability, prerequisites, defaults, security/lifecycle behavior,
   error guidance, and upgrade instructions when affected.
4. Update navigation and the feature-to-document map in the same change.
5. Search inbound links and section anchors; update meaningful reciprocal links.
6. Update the audit/coverage ledger and verification evidence.
7. Run the relevant documentation and example checks. Use focused checks for a
   narrow edit and the documented release gates for publication.
8. Review resulting pages from both developer and agent perspectives.

For a new feature, create its documentation home and index entries alongside
the feature. A runtime change is not documented completely by adding a changelog
line or a roadmap checkbox.

## Move Or Split A Page

1. Determine its authoritative owner and stable ID before moving it.
2. Split by reader task or contract, retaining a concise entrance page when
   the feature requires several detailed references.
3. Search all inbound paths and anchors; update indexes, prerequisites,
   contextual links, related-guide links, and catalog destinations.
4. Preserve or deliberately redirect previously published URLs and anchors.
   Never silently break a released link.
5. Check that no page is orphaned and every section still has an index.
6. Preserve released compatibility links under `docs/`; add contextual pointers
   to the new canonical guides as contracts change. The 2.4.1 handoff approved
   primary-entry routing, not wholesale deletion of the older reference tree.

## Review And Publication Gates

### Page Review

- [ ] The page has one clear role, audience, owner, stable ID, and applicability.
- [ ] Capability maturity is separate from documentation review status.
- [ ] Public imports/options/behavior match the supported package contract.
- [ ] Prerequisites, examples, modes, failure behavior, and verification are clear.
- [ ] Relevant authority, ownership, lifecycle, and observability are covered.
- [ ] The parent index links here and this page links back.
- [ ] Contextual links and related next steps are present and meaningful.
- [ ] File targets and anchors resolve, with no false links to planned pages.
- [ ] Public pages have no links to internal pages or `_work/` material.
- [ ] Examples are labeled accurately; important checks have recorded evidence.
- [ ] No live data, secret values, private context, or internal imports are needed.
- [ ] No unresolved defect is presented as a correct supported contract.

### System Review

- [ ] Every inventoried public feature has a documentation home.
- [ ] The overview/index, configuration reference where needed, and roadmap agree.
- [ ] Backend/frontend/SDK/CLI/agent integration coverage is reconciled.
- [ ] Concepts have one authoritative explanation and useful cross-links.
- [ ] Source evidence, test presence, check execution, and pass results are distinct.
- [ ] An independent review has checked accuracy and navigation.

### Whole-Set And Publication Review

- [ ] Reconcile all systems/public exports against inventories and final pages.
- [ ] Check unique page IDs, required metadata, indexes, reachability, backlinks,
  local links, and anchors across the complete new tree.
- [ ] Verify package-relative source/example links in a normal installed package.
- [ ] Verify the representative examples against the documented release.
- [ ] Record the qualified artifact's package version, source commit, and
  SHA-256. Dirty-checkout observations do not establish shipped support.
- [ ] Have a fresh developer or agent perform representative tasks without
  conversation history, private source imports, or maintainer-only knowledge.
- [ ] Cover relevant mode combinations in those tasks; do not treat one success
  as proof of every Guardian/Fabric profile.
- [ ] Verify that working notes/templates are excluded from public reader
  navigation, site publication, search, and production agent bundles. The
  approved package-local Markdown tree also contains classified internal notes;
  packaging those files is not permission to index them as public content.
- [ ] Build an explicit public-only projection/allowlist; inspect actual archives,
  rendered links, search entries, and agent bundles. Metadata alone is not filtering.
- [ ] Replace this internal preparation index with self-contained public reader
  navigation before changing its visibility. Keep authoring governance internal
  or separately prepare a public contributor version without internal dependencies.
- [ ] Keep package-local documentation available and aligned with its version.
- [ ] Review the old-to-new link map and legacy-release documentation handling.
- [ ] Freeze release docs against their exact package; keep unreleased-source
  guidance explicit and separately versioned SDK support accurate.
- [ ] Obtain explicit approval before retargeting current docs, package/site
  entries, root README, agent bundles, active instructions, or hooks.

At handoff, record the exact changes and checks. The 2.4.1 primary-entry handoff
is approved and implemented; individual guide review remains separate. Preserve
older compatibility documentation and do not infer public-site qualification
from its package-local replacement entrance.
