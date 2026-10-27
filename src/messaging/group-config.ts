/** Declarative organizational groups reuse Guardian role/permission/trusted-property requirements. */
import { createAuthorizationKernel, type AccessRequirement } from '../auth/authorization-kernel';
import type { NormalizedAuthBehaviorConfig } from '../auth/types';
import { messagingCatalogId, messagingChoice, messagingHash, messagingRecord, messagingRegistry, messagingText } from './validation';

export interface MessagingGroupConfig {
  name?: string;
  /** Omit for every active user in the current application/tenant directory. */
  members?: AccessRequirement;
  history?: 'all' | 'since-join';
}
export interface ResolvedMessagingGroup {
  readonly id: string;
  readonly name: string;
  readonly members?: AccessRequirement;
  readonly history: 'all' | 'since-join';
  readonly policyHash: string;
}
export function resolveMessagingGroups(value: unknown, auth: NormalizedAuthBehaviorConfig): Readonly<Record<string, ResolvedMessagingGroup>> {
  const groups: Record<string, ResolvedMessagingGroup> = Object.create(null), kernel = createAuthorizationKernel(auth);
  for (const [id, input] of Object.entries(value === undefined ? {} : messagingRegistry(value, 32))) {
    messagingCatalogId(id);
    const r = messagingRecord(input, ['name', 'members', 'history']);
    const members = r.members === undefined ? undefined : structuredClone(r.members) as AccessRequirement;
    if (members !== undefined) kernel.compile(members, { user: 'required', credentials: ['session'] });
    const history = messagingChoice(r.history ?? 'all', ['all', 'since-join']);
    groups[id] = freeze({ id, name: messagingText(r.name ?? id, 120), ...(members === undefined ? {} : { members }), history,
      policyHash: messagingHash([id, members ?? null, history]) });
  }
  return Object.freeze(groups);
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
