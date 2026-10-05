---
id: zero.template.feature-guide
type: template
audience: [agent, maintainer]
owner: zero-documentation
status: draft
visibility: internal
---

# Feature Guide Template

[Template index](./index.md) · [Working evidence](../index.md) ·
[Documentation index](../../index.md)

Use this checklist for a reader-facing feature page. Replace template metadata
with the feature's stable ID, role, audience, applicability, supported modes,
and actual review baseline. Add it to its parent index and link back near the
beginning. Remove drafting prompts and non-applicable sections before review.
Rebase every relative link for the destination directory, including footer links,
and verify its targets/anchors. The standards define `owner`, `system`, `feature`,
`maturity`, `applies_to`, `modes`, and `reviewed_against`; do not omit them when
applicable or substitute the template's metadata for an actual review baseline.

## Overview And When To Use It

Explain the feature's purpose, suitable uses, terminology, maturity, supported
modes, and relevant alternatives within Zero. Link prerequisites where needed.

## Minimal Working Example

Show exact public imports and necessary configuration/providers/files. Label
fragments clearly. Explain the expected result and how to verify it. Link a
runnable fixture or reference app when available.

## How It Works

Explain the reader's mental model and the sequence of important events. Use a
small diagram/table only when it materially clarifies relationships or state.
The explanation must stand on its public contract without requiring source
inspection or private conversation context.

## Configuration

Describe relevant settings and link to exact sections of the system's canonical
configuration reference. Explain defaults, precedence, prerequisites, mode
interactions, and whether a setting applies at startup or runtime.

## Public API And Integration

Document signatures, inputs, results, asynchronous behavior, and relevant
server/SDK/hook/component/CLI integration. Link each surface's authoritative
reference and explain how it participates in this feature.

## Authority And Data Ownership

Explain identity, permissions, tenant scope, credential restrictions, data-plane
ownership, and secret handling where relevant. Identify server enforcement;
visibility gates and hidden buttons are not security boundaries.

## Lifecycle And Failure Behavior

Cover relevant readiness, loading, live updates, mutation confirmation,
cancellation, retry, idempotency, timeout, shutdown, recovery, and durability.
Document verified error codes, safe presentation, and observability behavior.
Link shared concepts instead of maintaining duplicate contracts.

## Realistic Examples

Show common combinations and advanced use with complete context. State the
application modes and relevant authority. Use synthetic data and safe test
resources, never actual credentials or application records.

## Verification And Troubleshooting

Provide focused checks and expected outcomes. Separate permission/configuration
errors from runtime failures. Explain remedies without weakening security or
bypassing supported services. Record example verification evidence in the
working audit, including version/commit and checks actually performed.

## Upgrade And Compatibility

Describe verified compatibility, changed contracts, configuration adjustments,
or deliberate migration steps when relevant. Distinguish a package update from
a database migration. Link the applicable release/upgrade guide once available.

## Related Guides And Next Steps

Link the parent/system index, configuration reference, prerequisites, related
features, task guides, and the system roadmap where useful. Explain why each
destination matters. Review whether useful reciprocal links should be added.

Apply the [page review gates](../../documentation-process.md#page-review) and
[standards](../../documentation-standards.md) before marking the page verified.
