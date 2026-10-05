---
id: zero.ai.roadmap
type: roadmap
audience: [developer, agent, operator]
owner: ai
status: draft
visibility: internal
system: ai
feature: roadmap
maturity: supported
applies_to: ["2.1.1 source baseline"]
modes: ["managed Bun server", "standalone Bun service", "Torrent-backed durable agent"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# AI Roadmap

[Zero AI](./index.md) · [Backend systems](../index.md) · [Documentation index](../../index.md)

This is an unordered backlog of known product plans and research, not a release
schedule or current API. Existing text/streaming, embeddings, media, tools,
structured output and bounded/durable agent features are present-day contracts,
not merely groundwork for future work.

## Known Plans And Research

- [ ] **Model discovery and configuration control plane.** Research provider
  discovery endpoints and a potential Gateway-backed central catalog, with
  capability metadata and effective-dated prices. Keep observed provider facts
  separate from maintained metadata and account-specific availability.
- [ ] **Explicit env/database configuration modes.** Design trusted database
  provider settings alongside environment/startup configuration, including
  secret storage, authority, reload/rotation, precedence and migration. No
  existing provider table or runtime reconfiguration API is promised here.
- [ ] **App, tenant and bring-your-own-key usage accounting.** Build reusable
  token/attempt/cost observability and views without conflating estimated prices,
  provider-reported usage, failures or end-user billing.
- [ ] **Packaged AI chat/prompt UI.** Tokenized reusable UI and helpers for the
  existing services, distinct from the general streamed-text component and
  application-owned chat persistence.
- [ ] **Schema-declared AI behavior.** Explore explicit embedding/enrichment
  declarations with validation, lifecycle, ownership and cost controls.
- [ ] **Optional public OpenAI-compatible gateway.** A separately designed
  transport/authority boundary over Zero services; `openai-compatible` as an
  outbound adapter does not already provide this gateway.

The plans above come from Zero's product roadmap and the AI-layer design
backlog. They require their own design, implementation and acceptance, not an
app workaround documented as a platform feature.

## Existing Boundaries To Preserve

Configuration remains server-only. Enabling AI does not authorize end users,
store prompts, meter an organization or make remote model lists authoritative.
Provider capability flags are adapter-level maxima; models/accounts may differ.
Durable agents require Torrent and protect private prompts/context/tool state
from public workflow projections. Video remains preview even when its guide is
reviewed.

A new feature should have a canonical contract, configuration home, focused
verification and contextual links in the [AI index](./index.md). Its roadmap
checkbox should change only after those contracts and checks are actually in
place. A reviewed roadmap does not qualify a release.

## Related Guides And Next Steps

See [configuration](./configuration.md) for what can be configured now and
[Zero AI](./index.md) for implemented execution paths. Use this backlog to discuss
expansion without treating it as a list of hidden APIs.
