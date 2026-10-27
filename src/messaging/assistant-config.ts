/** Named assistant configuration. Guardian owns admission; this registry contains no provider credentials. */
import { createAuthorizationKernel, type AccessRequirement } from '../auth/authorization-kernel';
import type { NormalizedAuthBehaviorConfig } from '../auth/types';
import { messagingCatalogId, messagingHash, messagingInteger, messagingRecord, messagingRegistry, messagingText } from './validation';

export interface MessagingAssistantConfig {
  name?: string;
  description?: string;
  access?: AccessRequirement;
  model?: string;
  instructions?: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
}
export interface ResolvedMessagingAssistant {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly access?: AccessRequirement;
  readonly model: string;
  readonly instructions: string;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly policyHash: string;
}
export function messagingAssistantId(value: unknown): string {
  return messagingCatalogId(value);
}
export function resolveMessagingAssistants(input: Record<string, unknown>, auth: NormalizedAuthBehaviorConfig): {
  assistants: Readonly<Record<string, ResolvedMessagingAssistant>>;
  assistant: ResolvedMessagingAssistant | false;
} {
  const registry: Record<string, ResolvedMessagingAssistant> = Object.create(null);
  const kernel = createAuthorizationKernel(auth);
  const add = (id: string, value: unknown, legacy = false) => {
    messagingAssistantId(id);
    if (Object.hasOwn(registry, id)) throw new Error('[messaging] Duplicate assistant identifier.');
    const r = messagingRecord(value, ['name', 'description', 'access', 'model', 'instructions', 'maxOutputTokens', 'timeoutMs']);
    const access = r.access === undefined ? undefined : structuredClone(r.access) as AccessRequirement;
    if (access !== undefined) kernel.compile(access, { user: 'required', credentials: ['session'] });
    const policy = { model: messagingText(r.model ?? 'smart', 200),
      instructions: messagingText(r.instructions ?? 'Help using this conversation. Do not claim to have completed external actions. State when the available information is insufficient.', 20000),
      maxOutputTokens: messagingInteger(r.maxOutputTokens ?? 1024, 1, 8192), timeoutMs: messagingInteger(r.timeoutMs ?? 120000, 1000, 300000) };
    // Retain the old support configuration's fingerprint when its original
    // fields/default instructions are unchanged. Existing jobs gain no new policy.
    if (legacy && r.instructions === undefined) policy.instructions = 'Help the customer using this conversation. Do not claim to have completed external actions. Ask for human assistance when the issue cannot be resolved from the available information.';
    registry[id] = freeze({ ...policy, id, name: messagingText(r.name ?? (id === 'default' ? 'Assistant' : id), 120),
      description: messagingText(r.description ?? '', 500, true), ...(access === undefined ? {} : { access }),
      policyHash: legacy && access === undefined ? messagingHash(policy) : messagingHash([id, policy, access ?? null]) });
  };
  if (input.assistants !== undefined) {
    const entries = Object.entries(messagingRegistry(input.assistants, 32));
    for (const [id, value] of entries) add(id, value);
  }
  if (input.assistant !== undefined && input.assistant !== false) add('default', input.assistant, true);
  if (Object.keys(registry).length > 32) throw new Error('[messaging] Too many configured assistants.');
  const support = input.support && typeof input.support === 'object' ? input.support as Record<string, unknown> : null;
  const selection = support?.assistant;
  const assistant = selection === false ? false : selection === undefined ? registry.default ?? false : registry[messagingAssistantId(selection)];
  if (assistant === undefined) throw new Error('[messaging] The support assistant is not configured.');
  return { assistants: Object.freeze(registry), assistant };
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
