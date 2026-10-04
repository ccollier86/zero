# Retired Meta Llama Provider

Zero no longer connects directly to Meta's former hosted Llama API. Meta
retired that service, so `LLAMA_API_KEY`, `META_LLAMA_API_KEY`, and the
`meta/<model>` provider route are not detected or used.

Use a currently supported host for Llama models instead:

- `bedrock/<model>` for Amazon Bedrock
- `groq/<model>` for Groq
- `togetherai/<model>` for Together AI
- `fireworks/<model>` for Fireworks AI
- `huggingface/<model>` for Hugging Face
- an explicitly configured `openai-compatible` provider for another host

For example:

```ts
const result = await ai.generateText({
  model: 'groq/meta-llama/llama-4-scout-17b-16e-instruct',
  prompt: 'Summarize this incident.',
});
```

The legacy `createMetaLlama`, `metaLlama`, and `type: 'meta-llama'` names remain
temporarily importable so existing applications receive a clear
`AI_PROVIDER_RETIRED` error. They never contact an endpoint and are not aliases
for a replacement provider. Remove old Meta keys, choose a host, and update
model references explicitly; Zero will not silently move requests or data to a
different vendor.

See [AI Providers](./ai-providers.md) for provider activation and capabilities.
