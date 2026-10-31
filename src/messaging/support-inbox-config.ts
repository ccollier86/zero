/** Authenticated inbox destinations. Guardian owns customer/staff admission; no account or tenant IDs come from the browser. */
import { createAuthorizationKernel, type AccessRequirement } from '../auth/authorization-kernel';
import type { NormalizedAuthBehaviorConfig } from '../auth/types';
import type { ResolvedMessagingAssistant } from './assistant-config';
import { messagingHash, messagingRecord, messagingRegistry, messagingText } from './validation';

export interface MessagingSupportInboxConfig {
  title?: string;
  /** Optional current Guardian requirement for members who may open this destination. */
  access?: AccessRequirement;
  /** Narrows the existing support.staff requirement; never grants global transcript access. */
  staff?: AccessRequirement;
  assistant?: string | false;
}
export interface ResolvedMessagingSupportInbox {
  readonly id: string; readonly title: string; readonly access?: AccessRequirement; readonly staff?: AccessRequirement;
  readonly assistantId: string | null; readonly policyHash: string;
}
/** Validate/freeze named portal destinations without opening private storage or evaluating a user-supplied callback. */
export function resolveMessagingSupportInboxes(input: unknown, auth: NormalizedAuthBehaviorConfig,
  assistants: Readonly<Record<string, ResolvedMessagingAssistant>>, defaultAssistantId: string | null): Readonly<Record<string, ResolvedMessagingSupportInbox>> {
  const result: Record<string, ResolvedMessagingSupportInbox> = Object.create(null), kernel = createAuthorizationKernel(auth);
  for (const [id, value] of Object.entries(messagingRegistry(input ?? {}, 32))) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(id)) throw new Error('[messaging] Invalid support inbox name.');
    const r = messagingRecord(value, ['title', 'access', 'staff', 'assistant']);
    const access = r.access === undefined ? undefined : structuredClone(r.access) as AccessRequirement;
    const staff = r.staff === undefined ? undefined : structuredClone(r.staff) as AccessRequirement;
    for (const requirement of [access, staff]) if (requirement !== undefined) kernel.compile(requirement, { user: 'required', credentials: ['session'] });
    const assistantId = r.assistant === false ? null : r.assistant === undefined ? defaultAssistantId : messagingText(r.assistant, 64);
    if (assistantId !== null && !Object.hasOwn(assistants, assistantId)) throw new Error('[messaging] The inbox assistant is not configured.');
    const policy = { id, title: messagingText(r.title ?? id, 120), ...(access === undefined ? {} : { access }), ...(staff === undefined ? {} : { staff }), assistantId };
    result[id] = freeze({ ...policy, policyHash: messagingHash(policy) });
  }
  return Object.freeze(result);
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
