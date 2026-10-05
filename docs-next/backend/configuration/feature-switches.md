---
id: zero.configuration.feature-switches
type: reference
audience: [developer, agent, operator]
owner: platform-configuration
status: draft
visibility: internal
system: platform-configuration
feature: feature-switches
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [managed-server]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Enable Features Without Assuming Readiness

[Configuration index](./index.md) · [Documentation index](../../index.md)

Feature switches choose what composition attempts to mount. They do
not prove provider credentials, schema, browser availability or a caller's
permissions.

## Supported Forms

| Feature | Omitted | false | true | object |
| --- | --- | --- | --- | --- |
| Guardian auth | off | off | defaults | behavior plus app token TTLs |
| Torrent workflows | on when auth on | off | not an accepted typed form | registration/lifecycle options |
| email | off | off | default Resend config | provider/config options |
| AI | off | off | environment detection | providers/aliases/controls |
| vector | off | off | default local index | named indexes/config |
| KV | on | off | durable defaults | durability/path/options |
| PDF | off | off | secure default renderer config | limits/resources/adapter |
| stateSync | off | off | per-user state | not an accepted typed form |
| sitemap | off | off | default path | sitemap settings |

`storage`, `db` and `databaseTopology` have their own contracts, not this
universal switch shape. Null is not a supported substitute for every off value.

KV defaults to everysec journal/checkpoint persistence, not memory-only tests.
Email defaults to noop when disabled. A disabled email runtime still offers a
service-shaped boundary; it does not mean a public reset email was delivered.

## Dependency Gates

StateSync and an explicitly enabled workflows object require Guardian.
Authless Sync is public; required Sync without auth is rejected. Tenant-file
isolation additionally requires multi-tenant Guardian and admitted realm tables.
Durable database automations require a crash-durable system plane.

These are startup dependencies, not runtime grants. Turning storage or AI on
does not give every user permission to inspect drives, credentials or model
status. Reusable UI should adapt to actual capabilities and live permissions.

## True Is Not A Credential

`ai:true` selects provider detection; an empty/incomplete provider configuration
does not guarantee a usable model. `email:true` selects Resend defaults; valid
sender/adapter credentials and action-link public URL are separate readiness
requirements. `pdf:true` enables configuration; Chromium starts lazily and its
resource policy still constrains rendering.

Use status/readiness methods of the owning service without exporting its
secrets. Do not emulate readiness by checking a different ambient environment
key after an adapter already captured its configuration.

## Verification

Test omitted, false and supported true/object forms independently using synthetic
environment values. Test rejected dependency combinations before mounting an app.
For a real provider, an explicitly authorized integration check is separate
from config admission; documentation inspection must not send requests.

## Related Guides And Next Steps

- [Reference](./configuration.md) gives exact top-level defaults.
- [Data modes](./data-modes.md) relates tenancy to physical files.
- [Guardian](../guardian/index.md) owns auth-dependent completion gates.
- [AI providers](../ai/providers.md) distinguishes adapter enablement from model capability.
