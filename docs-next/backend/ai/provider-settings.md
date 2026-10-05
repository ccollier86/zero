---
id: zero.ai.provider-settings
type: reference
audience: [developer, agent, operator]
owner: ai
status: draft
visibility: internal
system: ai
feature: provider-construction-settings
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

# Provider Construction Settings

[Zero AI](./index.md) · [Providers](./providers.md) · [Configuration](./configuration.md) · [Documentation index](../../index.md)

This reference owns `ai.providers[id].settings`. These are trusted server
construction options, not per-prompt providerOptions or end-user settings.
Known strings are trimmed; whitespace-only strings normalize to omission.
Unsupported non-undefined settings on a built-in type raise
`AI_PROVIDER_CONFIG_INVALID` before constructing an adapter.

There is **no Zero wrapper default** for the settings below unless explicitly
noted as an environment/endpoint derivation. Omitted values are forwarded as
omitted to the selected installed adapter; do not infer one provider's SDK
default for another. Changes require rebuilding/restarting that service.
A `custom` adapter receives the typed settings object under its own trusted
semantics rather than the built-in allowlist.

## Complete Settings Reference

| Setting | Accepted value / admission | Built-in consumers |
| --- | --- | --- |
| teamIdOrSlug | String | gateway |
| metadataCacheRefreshMillis | Positive safe integer milliseconds | gateway |
| authToken | String, alternative to API key | anthropic |
| workspaceId | String; required for activation | anthropic-aws |
| region | Single DNS-label-style string, max 63 characters | anthropic-aws, amazon-bedrock |
| runtimeBaseURL | Absolute HTTP(S) URL | amazon-bedrock |
| agentRuntimeBaseURL | Absolute HTTP(S) URL | amazon-bedrock |
| accessKeyId | String; pair with secretAccessKey | anthropic-aws, amazon-bedrock |
| secretAccessKey | String; pair with accessKeyId | anthropic-aws, amazon-bedrock |
| sessionToken | String; optional temporary-token component | anthropic-aws, amazon-bedrock |
| credentialProvider | Function returning PromiseLike<AIBedrockCredentials> | anthropic-aws, amazon-bedrock |
| accessKey | String; pair with secretKey | klingai |
| secretKey | String; pair with accessKey | klingai |
| resourceName | Single DNS-label-style string, max 63 characters | azure |
| tokenProvider | Function returning Promise<string> | azure |
| apiVersion | String | azure |
| speechBaseURL | Absolute HTTP(S) URL | azure |
| useDeploymentBasedUrls | Boolean | azure |
| project | String | google-vertex |
| location | String | google-vertex |
| googleAuthOptions | Non-array object matching public Google auth options type | google-vertex |
| strictResponseInput | Boolean | open-responses |
| modelURL | Absolute HTTP(S) URL ending /sync or /sync/v1, no query/fragment; trailing slash normalized | baseten |
| performanceClient | Constructable function; requires modelURL | baseten |
| embeddingBaseURL | Absolute HTTP(S) URL | alibaba |
| videoBaseURL | Absolute HTTP(S) URL | alibaba, minimax |
| includeUsage | Boolean | alibaba, openai-compatible |
| pollIntervalMillis | Positive safe integer milliseconds | black-forest-labs |
| pollTimeoutMillis | Positive safe integer milliseconds | black-forest-labs |
| generateId | Function | anthropic, anthropic-aws, amazon-bedrock, google, google-vertex, cohere, mistral, huggingface |
| version | String | cartesia |
| webSocket | Constructable function matching public WebSocket-constructor type | cartesia |

Other built-in types accept no non-undefined settings. Generic apiKey, baseURL,
headers, fetch and capabilities still belong to their
[provider record](./configuration.md#provider-records).

Cloud callbacks, auth option objects, headers and keys may contain secrets.
Never serialize a resolved settings object into frontend state, workflow public
progress or logs. Dynamic credential callbacks remain app-owned trusted code
and may refresh credentials without changing the provider declaration.

## Settings Environment Bindings

Only these setting bindings are supplied by Zero's static catalog. Explicit
nonblank settings win; omitted settings use the first nonblank listed key,
subject to the selected credential/endpoint mode. The presence of a public
setting does not imply an undocumented environment key for it.

| Provider type | Setting | Environment keys in order |
| --- | --- | --- |
| azure | resourceName | AZURE_RESOURCE_NAME |
| anthropic | authToken | ANTHROPIC_AUTH_TOKEN |
| anthropic-aws | workspaceId | ANTHROPIC_AWS_WORKSPACE_ID |
| anthropic-aws | region | AWS_REGION |
| anthropic-aws | accessKeyId / secretAccessKey / sessionToken | AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN respectively |
| amazon-bedrock | region | AWS_REGION → AWS_DEFAULT_REGION |
| amazon-bedrock | runtimeBaseURL | AWS_ENDPOINT_URL_BEDROCK_RUNTIME |
| amazon-bedrock | agentRuntimeBaseURL | AWS_ENDPOINT_URL_BEDROCK_AGENT_RUNTIME |
| amazon-bedrock | accessKeyId / secretAccessKey / sessionToken | AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN respectively |
| google-vertex | project / location | GOOGLE_VERTEX_PROJECT / GOOGLE_VERTEX_LOCATION respectively |
| klingai | accessKey / secretKey | KLINGAI_ACCESS_KEY / KLINGAI_SECRET_KEY respectively |

The selected API-key mode suppresses ambient alternate credential bindings.
For example, a selected Bedrock bearer token does not also inherit ambient
SigV4 key fields. An explicitly declared credentialProvider/static key pair
suppresses ambient bearer/API-key selection. This avoids silently switching
credential modes as deployment environment variables change.

## AWS Providers

### Amazon Bedrock

The catalog ID is bedrock; type is amazon-bedrock. Choose **one** auth mode:

- Bearer token in apiKey. A region or resolved runtime endpoint is needed for
  readiness. Reranking still requires a region.
- Static accessKeyId and secretAccessKey, optional sessionToken, plus region.
- Dynamic credentialProvider plus region.

A partial static key pair is inactive with `partial_aws_credentials`.
No credentials yields `missing_credentials`; absent required region yields
`missing_region`. Explicitly mixing an API key with SigV4 credentials is an
invalid configuration, not a fallback strategy.

Config fragment using an explicit dynamic loader (the loader is app-owned and
must return current authorized AWS credentials):

```ts
import type { AIProviderConfig, AIAwsCredentialProvider } from '@zero/framework/ai';

export function bedrockProvider(loadCredentials: AIAwsCredentialProvider): AIProviderConfig {
  return {
    type: 'amazon-bedrock',
    apiKey: null, // Do not inherit an unrelated ambient bearer token.
    settings: {
      region: 'us-east-1',
      credentialProvider: loadCredentials,
    },
  };
}
```

Runtime and agent-runtime URLs resolve independently:

1. Explicit settings.runtimeBaseURL or settings.agentRuntimeBaseURL.
2. Service-specific environment settings, unless a higher-priority explicit or
   Zero ID/type generic endpoint was selected.
3. Generic baseURL, including AWS_ENDPOINT_URL after Zero ID/type bindings.
4. Region-derived service endpoint.

An explicit generic endpoint does not prevent explicit service overrides. With
baseURL:null, ambient overrides are suppressed; region-derived service defaults
remain available. Region selection respects the AWS DNS partitions implemented
by this source version. The adapter creates distinct runtime/reranking clients
when their URLs differ; reranking is not sent to the wrong runtime service merely
because language generation uses a custom endpoint.

### Claude Platform On AWS

Type anthropic-aws requires workspaceId. API-key mode needs region or baseURL;
static/dynamic SigV4 modes require region. CredentialProvider/static key pair
and an explicit API key are mutually exclusive. Unlike Bedrock's catalog,
its region binding is AWS_REGION only; do not infer AWS_DEFAULT_REGION fallback
from the other AWS provider.

## Azure OpenAI

Activation requires a resolved baseURL or resourceName, and either apiKey or
tokenProvider. An explicit API key and tokenProvider together are rejected.
Use apiKey:null for explicit Entra token mode when ambient key fallback must be
suppressed. resourceName is one DNS label, not a full URL.

apiVersion, speechBaseURL and useDeploymentBasedUrls are passed to the adapter.
No Zero wrapper default is invented for those options. Model IDs for Azure
are the selected adapter/account's deployment/model contract; an alias does not
create a deployment.

## Google Vertex AI

The available readiness modes are express API key, explicit endpoint, or
project/location-based Google auth. A baseURL can opt into an app-controlled
endpoint; actual endpoint authentication still belongs to the trusted provider.

Explicit project/location/googleAuthOptions select the ADC-style mode and
suppress unrelated ambient express-key fallback. An explicit API key together
with ADC settings is rejected. Transcription is removed from capabilities in
express API-key mode or without project/location. A ready language provider does
not therefore guarantee the same transcription surface.

## Other Credential Alternatives And Endpoint Details

- Gateway can be explicitly configured without an API key as deliberate OIDC
  opt-in. Auto-detection without a key does not activate OIDC implicitly. Local
  readiness is not proof that an OIDC token/account is available.
- Anthropic accepts an API key or authToken, not both explicitly. generateId is
  its optional request identifier factory.
- Kling accepts a current API key or a legacy accessKey/secretKey pair. Partial
  legacy pairs are inactive and explicit mixed modes are rejected.
- Baseten modelURL is mandatory for embeddings; performanceClient additionally
  requires that URL. The URL targets a model's /sync or /sync/v1 endpoint, not
  an arbitrary metadata/pricing route.
- Open Responses requires a baseURL and optionally uses strictResponseInput.
- Some fixed-endpoint adapters (Deepgram, ElevenLabs, Hume, RevAI, AssemblyAI,
  Gladia, Cartesia) honor a configured proxy baseURL through Zero's scoped fetch
  rewriting. fal rewrites its normal/queue origins. This is trusted server
  endpoint configuration, not permission for end users to choose arbitrary URLs.
- Catalog endpoint defaults are DeepSeek https://api.deepseek.com,
  Perplexity https://api.perplexity.ai and Voyage https://api.voyageai.com/v1.
  Explicit null endpoint suppression is handled at the factory boundary; OpenAI,
  Anthropic and Quiver have provider-native fallback hosts there. Other adapter
  omission semantics remain those of the installed SDK.

## Verification And Related Guides

Use [configuration](./configuration.md) for generic precedence and a synthetic
env-map resolver test. Check [safe status](./configuration.md#status-endpoint)
for readiness rather than printing credentials. Fix an invalid field at its
declaration; do not bypass built-in admission with a dummy capability or key.

Return to [providers](./providers.md) for the 44-entry static catalog and maximum
modalities. The [roadmap](./roadmap.md) describes future database-backed settings
and model discovery; this constructor reference does not claim those features.
