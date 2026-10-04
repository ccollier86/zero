/** Amazon Bedrock endpoint resolution owned by Zero's provider boundary. */

const AWS_PARTITION_DNS_SUFFIXES = [
  { regionPrefix: 'cn-', dnsSuffix: 'amazonaws.com.cn' },
  { regionPrefix: 'us-iso-', dnsSuffix: 'c2s.ic.gov' },
  { regionPrefix: 'us-isob-', dnsSuffix: 'sc2s.sgov.gov' },
  { regionPrefix: 'eu-isoe-', dnsSuffix: 'cloud.adc-e.uk' },
  { regionPrefix: 'us-isof-', dnsSuffix: 'csp.hci.ic.gov' },
  { regionPrefix: 'eusc-', dnsSuffix: 'amazonaws.eu' },
] as const;

/** Official service-specific endpoint environment variable used by Bedrock runtime calls. */
export const AWS_BEDROCK_RUNTIME_ENDPOINT_ENV_KEY = 'AWS_ENDPOINT_URL_BEDROCK_RUNTIME';

/** Official service-specific endpoint environment variable used by Bedrock reranking calls. */
export const AWS_BEDROCK_AGENT_RUNTIME_ENDPOINT_ENV_KEY =
  'AWS_ENDPOINT_URL_BEDROCK_AGENT_RUNTIME';

/** Build the official Bedrock Runtime endpoint without consulting ambient process state. */
export function defaultBedrockRuntimeBaseURL(region: string): string {
  return defaultBedrockServiceBaseURL('bedrock-runtime', region);
}

/** Build the official Bedrock Agent Runtime endpoint without ambient process state. */
export function defaultBedrockAgentRuntimeBaseURL(region: string): string {
  return defaultBedrockServiceBaseURL('bedrock-agent-runtime', region);
}

/** Resolve the independent Bedrock service endpoints using AWS precedence. */
export function resolveBedrockServiceBaseURLs(input: {
  genericBaseURL?: string;
  runtimeBaseURL?: string;
  agentRuntimeBaseURL?: string;
  region?: string;
}): { runtimeBaseURL?: string; agentRuntimeBaseURL?: string } {
  return {
    runtimeBaseURL: input.runtimeBaseURL
      ?? input.genericBaseURL
      ?? (input.region ? defaultBedrockRuntimeBaseURL(input.region) : undefined),
    agentRuntimeBaseURL: input.agentRuntimeBaseURL
      ?? input.genericBaseURL
      ?? (input.region ? defaultBedrockAgentRuntimeBaseURL(input.region) : undefined),
  };
}

function defaultBedrockServiceBaseURL(
  service: 'bedrock-runtime' | 'bedrock-agent-runtime',
  region: string
): string {
  const dnsSuffix = AWS_PARTITION_DNS_SUFFIXES.find(
    ({ regionPrefix }) => region.startsWith(regionPrefix)
  )?.dnsSuffix ?? 'amazonaws.com';
  return `https://${service}.${region}.${dnsSuffix}`;
}
