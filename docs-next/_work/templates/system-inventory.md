---
id: zero.template.system-inventory
type: template
audience: [agent, maintainer]
owner: zero-documentation
status: draft
visibility: internal
---

# System Inventory Template

[Template index](./index.md) · [Working evidence](../index.md) ·
[Documentation index](../../index.md)

Copy this outline to the system audit area when the audit begins. Replace the
template metadata with a unique inventory ID, `type: inventory`, the system
name, and the actual review baseline. Add the new page to its parent index and
give it a backlink to that index. Rebase every relative link—including the
process/standards footers—for the destination directory and verify its anchors.
Remove template-only instructions. Do not claim checks that were not performed.

## Audit Identity

- System name, responsibility, and applicable source modules.
- Public package/repository boundary, including separately maintained SDKs.
- Zero version, source commit, inspection date, and any relevant uncommitted
  changes in the reviewed snapshot.
- Audit status, reviewer, and outstanding uncertainty.
- System owner, relevant modes, evidence level, and separately versioned
  package/SDK applicability. Use the metadata format in the standards; record
  artifact provenance only when a real artifact was checked.

## Purpose And Terminology

Explain what this system owns, how developers encounter it, and the vocabulary
used by its public contract. Record established principles separately from
design patterns inferred during inspection.

## Features And Documentation Coverage

Use one row per distinct feature; add columns as needed to make gaps visible.

| Feature | Maturity and modes | Public surfaces | Evidence | Planned/final guide | Review status |
| --- | --- | --- | --- | --- | --- |
| Replace with verified feature | Supported, preview, internal-only, or planned; applicable modes | Imports, config, services, SDK, hooks, UI, CLI | Specific source/tests/examples/release evidence | Plain planned path, or a link once it exists | Not started, draft, in review, or verified |

Every public feature needs a destination. Record public components and hooks
individually even when related primitives share a documentation page.

## Public Surface Map

Enumerate exports/import paths, API routes and services, configuration options,
SDK methods, hooks/components, CLI commands, and agent-facing tools. Identify
trusted escape hatches and internals separately from supported app contracts.

## Integration Map

Trace relevant connections to other systems:

- Identity, permissions, credential ceilings, and live authority.
- App/system/Fabric data placement and ownership.
- HTTP, WebSocket, reactivity, state, and client reconciliation.
- Startup, readiness, provisioning, cancellation, shutdown, and recovery.
- Errors, operational events, sinks, and redaction.
- Schema, migrations, storage, AI, workflows, or other relevant dependencies.

Name the owning layer for each invariant rather than infer backend enforcement
from a visible UI control.

## Configuration Inventory

For each option record exact path, type/values, default, environment binding,
precedence, required conditions, interactions, security implications, and
startup/runtime effect. Map it to its feature and eventual configuration section.
Also record resolution timing, whether Doctor follows the same resolution path,
restart requirements, omission/boolean/null/object semantics where supported,
and server-only/redacted/client-visible exposure.

## Evidence And Verification

List concrete source references, public export checks, relevant tests, examples,
current documentation, release evidence, and official external sources used.
Distinguish implementation observed, tests present, checks run, and checks passed.
Record commands/results only when actually executed against safe scoped data.
Use sanitized summaries and synthetic examples. Do not retain actual env values,
secrets, application records, raw tokens, sensitive payloads, or runtime artifacts.

## Findings

For each finding record category, observed behavior/claim, expected contract,
affected modes/versions, source or reproduction evidence, severity where
justified, required discussion, and disposition. Do not document a defect away.

## Known Future Plans

Record plans and ideas with provenance and explicit status. Distinguish roadmap
expansions from defects that need correction. Link the future system roadmap
once it exists; do not keep two competing detailed backlogs.

## Navigation And Cross-Link Plan

Record the system's parent index, feature homes, configuration sections, shared
concepts, frontend/CLI/agent consumers, task guides, and useful reciprocal links.
Use plain paths for unwritten pages, then replace them with real links.

## Completion Review

- [ ] All discovered features and public surfaces are accounted for.
- [ ] Integrations and relevant modes have been traced.
- [ ] Evidence is specific and its verification status is accurate.
- [ ] Findings have a clear disposition; uncertainty is not hidden.
- [ ] Every public feature has a documentation destination and index owner.
- [ ] Future plans are separate from current behavior.
- [ ] Independent review has checked coverage.

Follow the [process](../../documentation-process.md) before marking the inventory
complete or beginning detailed feature rewriting.
