---
id: zero.ai.configuration
type: reference
audience: [developer, agent, operator]
owner: ai
status: draft
visibility: internal
system: ai
feature: configuration
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

# AI Configuration

[Zero AI](./index.md) · [Backend systems](../index.md) · [Documentation index](../../index.md)

AI configuration is trusted server startup configuration. It selects providers
and models; it does not authorize users, meter tenants or create app endpoints.
Use an ordinary server-owned config module and pass its AI fragment to
`createApp()`. No live database settings/control plane is implied.

## App Switch

`AppConfig.ai` accepts `false | true | AIConfig` and may be omitted.

| Value | Result |
| --- | --- |
| Omitted or `false` | AI is disabled; no managed AI service or AI status route. |
| `true` | Enable AI with environment detection and default alias candidates. |
| An object | Enable AI; detection remains enabled unless `autoDetect: false`. |

The public resolver is `resolveAIConfig(input, env = Bun.env)`. It returns
`ResolvedAIConfig | false`; construction is separate. Passing an explicit
environment map supports controlled configuration tests. It does not make
importing an app's config module safe or stop that module from executing code.
Changing startup configuration requires recomposing/restarting the service.
Dynamic credential callbacks are invoked by their provider adapter; they are not
an arbitrary runtime-settings store.

Configuration fragment, not a complete application:

```ts
import type { AIConfig } from '@zero/framework/ai';

export const aiConfig = {
  autoDetect: false,
  providers: {
    primary: {
      type: 'openai',
      apiKey: Bun.env.APP_AI_API_KEY,
    },
  },
  aliases: {
    // Replace this provider model ID with one your account can actually use.
    smart: 'primary/<provider-model-id>',
  },
} satisfies AIConfig;
```

This reads a server credential without embedding its value. Missing credentials
leave a normal API-key provider inactive; source configuration is not proof of
remote account/model availability. Do not put this module in a browser import
graph.

## Top-Level Options

| Path | Type and omission/default | Effect |
| --- | --- | --- |
| `ai.autoDetect` | Boolean; default `true` | Scan built-in provider environment bindings. Exactly `false` limits discovery to explicit provider records. |
| `ai.providers` | `Record<string, AIProviderConfig | false>`; default empty | Explicit provider IDs replace detected records with the same ID. A `false` record deliberately disables that ID. |
| `ai.aliases` | `Record<string, string>`; default resolved candidates/env | Explicit entries override alias environment values and candidates. Values must resolve to `provider/model`, not another alias chain. |
| `ai.filesProvider` | Provider ID string; omitted falls back to `ZERO_AI_FILES_PROVIDER`, otherwise `null` | Default provider for hosted-file operations; empty/invalid explicit IDs are rejected. Callers otherwise select a provider explicitly. |
| `ai.statusEndpoint` | `false | AIStatusEndpointConfig`; omitted/`false` disabled | Optional safe status transport only. An object enables it unless `enabled: false`. |

Provider IDs must start with an ASCII letter or digit and then contain only
letters, digits, `.`, `_` and `-`. Built-in IDs ordinarily retain their adapter
identity; an incompatible type is rejected. The explicit `custom` and
`openai-compatible` replacement contracts remain available for app-owned
adapters. That escape hatch is not automatic discovery or a public gateway.

## Provider Records

Each `ai.providers[id]` object has these options:

| Field | Accepted value/default | Contract |
| --- | --- | --- |
| `type` | Required `AIProviderType` | Select the adapter; `meta-llama` is a retired compatibility type. |
| `enabled` | Boolean; omitted enabled when ready | `false` keeps a visible inactive provider without constructing it. |
| `apiKey` | String, `null`, or omitted | Nonblank explicit key wins. Omission normally inherits catalog/type environment keys. `null` suppresses ambient API-key fallback. Alternate credential settings also suppress unrelated API-key fallback. |
| `baseURL` | Absolute HTTP(S) string, `null`, or omitted | Explicit nonblank URL wins; omitted inherits ID/type environment endpoints and catalog defaults. `null` suppresses ambient overrides, including SDK fallback. |
| `headers` | String-valued record; omitted none | Adapter construction headers; server-only and potentially secret. |
| `fetch` | `AIFetchFunction`; omitted provider's normal fetch | Trusted custom request transport, for tests/proxies/policy. It is not a browser request service. |
| `settings` | `AIProviderInstanceSettings`; omitted none/env projection | Only settings supported by the selected built-in type are accepted. |
| `capabilities` | Partial capability flag map; omitted catalog defaults | Built-ins may disable capabilities, not enable operations beyond their maximum. Custom providers define their own surface. |
| `adapter` | AI SDK ProviderV3/ProviderV4 object or factory | Required for active `custom`; factory receives ID, resolved credentials/endpoints/settings and capabilities. |

A blank string normalizes to omission; it is not the suppression sentinel.
`autoDetect: false` turns off discovery, **not** environment fallback for an
explicit provider. Use `apiKey: null`, `baseURL: null` or an explicit credential
mode when ambient fallback must not be used.

All credentials, headers, callbacks and provider options are trusted server
values. Do not expose resolved provider records to a client. Safe status uses a
separate projection with environment key **names**, readiness, capability flags,
selected alias strings and only an endpoint's origin—not credentials, path,
query or fragment.

## Provider Detection And Precedence

The resolver normalizes explicit records first, then examines each catalog
provider whose ID was not explicitly defined, and merges explicit records last.
Inactive detected providers remain in safe status with their readiness reason;
only active providers are constructed in the registry.

For most generic endpoints the precedence is:

1. Nonblank explicit `baseURL` (unless suppressed by `null`).
2. `<PROVIDER_ID>_BASE_URL` with non-alphanumerics replaced by underscores and
   uppercase conversion.
3. `<PROVIDER_TYPE>_BASE_URL` with that same conversion.
4. The provider's catalog default, when declared; otherwise adapter default.

Bedrock additionally accepts `AWS_ENDPOINT_URL` and has separate runtime and
agent-runtime settings. A selected explicit or Zero ID/type generic URL
suppresses lower-priority service-specific environment endpoints; explicit
service settings still win. The runtime and reranking service URLs are resolved
independently. Region may select AWS partition-specific default service hosts.

For credential bindings, each catalog list is checked in order for its first
nonblank value. Explicit alternate modes (AWS credentialProvider/static SigV4,
Azure tokenProvider, Anthropic authToken, Kling legacy key pair, Vertex ADC)
prevent an unrelated ambient API key from silently changing auth modes. An
explicit API key combined with alternate credentials is rejected rather than
silently choosing one. Partial key pairs leave the provider inactive.

The [provider catalog](./providers.md) lists every built-in credential binding;
[provider settings](./provider-settings.md) covers every construction option and
cloud credential mode. Configuration resolution does not probe remote models or
prices.

## Aliases

Explicit alias entries win over their environment binding; an environment value
wins over static candidates. Candidates are selected only when their configured
provider is active and advertises the operation's capability. They are static
Zero defaults, not live provider model discovery.

| Standard alias | Environment key | Operation fallback |
| --- | --- | --- |
| `fast` | `ZERO_AI_FAST_MODEL` | Explicit fast selection; text does not automatically use it. |
| `smart` | `ZERO_AI_SMART_MODEL` | Text, conversation and agent model resolution. |
| `embedding` | `ZERO_AI_EMBEDDING_MODEL` | Single/batch embeddings. |
| `image` | `ZERO_AI_IMAGE_MODEL` | Image generation. |
| `transcription` | `ZERO_AI_TRANSCRIPTION_MODEL` | Audio transcription. |
| `speech` | `ZERO_AI_SPEECH_MODEL` | Speech generation. |
| `reranking` | `ZERO_AI_RERANKING_MODEL` | Reranking. |
| `video` | `ZERO_AI_VIDEO_MODEL` | Preview video. |

Alias resolution performs one lookup, then parses the first slash. You may use
application aliases such as `support`, but their values must be qualified
references. Use an explicit model/alias per operation where implicit candidates
would be operationally surprising. A safe readiness check is not a network test.

## Status Endpoint

The status route is `statusEndpoint.basePath + '/status'`. The default basePath
is `/api/_zero/ai`; enabling the default object therefore exposes
`GET /api/_zero/ai/status`, not the base path alone.

| Option | Default | Behavior |
| --- | --- | --- |
| `enabled` | Object defaults true | Register the route; omitted top-level object still disables it. |
| `basePath` | `/api/_zero/ai` | Elysia route group prefix. |
| `read` | `admin` when auth enabled, `development` otherwise | Access policy below. |

`admin` checks the live legacy global `role === 'admin'` on auth context.
Administration-organization membership or an ordinary app role is not itself
that policy. `development` allows non-production NODE_ENV; `admin-or-dev`
allows either; `disabled` denies all reads. A custom sync/async callback receives
`{ request, authContext }` and returns a boolean. Standalone composition must
supply its auth middleware; setting `authEnabled: true` does not authenticate a
request by itself. Denial returns 403 and the standard AI status denial event.

The status response describes local activation and aliases; it does not list
all current remote models, account entitlements, model capabilities or prices.
Protect custom status exposure according to your app's live authority rules.

## Verification And Failure Behavior

### Public Resolution Helpers

| Helper | Contract |
| --- | --- |
| `resolveAIConfig(input, env = Bun.env)` | Resolve false/true/config into false or `ResolvedAIConfig`; supplying a synthetic environment avoids ambient credential reads. |
| `createAIRegistry(resolved, emitCode?)` | Construct adapter instances for active providers and an SDK registry using `/` as its separator. This is trusted startup work, not an inert status check. |
| `parseAIModelReference(value)` | Split at the first slash into providerId/modelId, or return null for missing/empty sides. It does not resolve plain aliases or call a provider. |
| `isAIModelActive(registry, aliases, requested, capability = 'text')` | Return active/reason and optional resolved reference from local configured provider presence, instance and capability. It does not probe a model endpoint. |

AIRegistry contains the provider records, constructed providerInstances, SDK
registry and optional app-bound emitter. Keep that object server-only. Status
projects configured source/reasons/capabilities and only the origin of a custom
baseURL, dropping path/query credentials. Low-level registry access does not
automatically perform the generation service's snapshots, prompt bounds or
request lifecycle; prefer AIService and [model preparation](./model-execution.md).

Use a synthetic environment to test resolution without reading real credentials,
then inspect `ai.getStatus()` in trusted server code. Invalid IDs, unsupported
settings, invalid URL/settings values or credential-mode conflicts raise
`AI_PROVIDER_CONFIG_INVALID`. Invalid model references raise
`AI_MODEL_NOT_CONFIGURED` when model resolution is requested. Disabled/missing
providers and unsupported capabilities are separate readiness failures.

Doctor reads the same core AI resolver and reports configuration/activation,
alias, cloud credential, file-provider and status-policy findings. Doctor also
loads trusted app/resource modules and can inspect other app data: it is not a
purely static command. No live provider test is necessary to explain the local
contract, but remote account/model qualification remains a separate check.

## Related Guides And Next Steps

Return to [Zero AI](./index.md) for execution/agent integration. The
[roadmap](./roadmap.md) distinguishes future model/configuration control planes
from startup configuration. Per-operation controls belong to their focused
contracts; this reference does not introduce blanket runtime defaults for all
SDK operations.

The platform [configuration resolution guide](../configuration/resolution.md)
explains trusted startup declarations versus live app policy.
