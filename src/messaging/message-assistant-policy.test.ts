/** Pure source selection checks. Native model execution and retained-state behavior are separately exercised. */
import { expect, test } from 'bun:test';
import type { ConversationRow, MessagingActor } from './realm-model';
import { messagingMessageAssistantPolicy as select } from './message-assistant-policy';
test('disabling/replacing support automation does not reactivate a retained bot merely because it remains in the internal registry', () => {
  const hash = 'e'.repeat(64), other = 'f'.repeat(64), actor: MessagingActor = { id: 'member', scopeId: 'application', kind: 'user', staff: false, assistantPolicies: { default: hash, help: other } };
  const support = { kind: 'support', assistant_id: 'default', support_entry_id: null } as ConversationRow;
  expect(select(actor, support, hash, undefined)).toBe(hash);
  expect(select(actor, support, null, undefined)).toBeNull();
  expect(select(actor, support, other, undefined)).toBeNull();
  expect(select({ ...actor, assistantPolicies: {} }, support, hash, undefined)).toBeNull();
  const inbox = { ...support, support_entry_id: 'team', assistant_id: 'help' };
  expect(select(actor, inbox, null, { team: 'help' })).toBe(other);
  expect(select(actor, inbox, hash, {})).toBeNull();
  expect(select(actor, inbox, hash, { team: 'default' })).toBeNull();
  expect(select(actor, inbox, hash, { different: 'help' })).toBeNull();
  expect(select({ ...actor, assistantPolicies: {} }, inbox, null, { team: 'help' })).toBeNull();
  expect(select(actor, { ...support, kind: 'assistant' }, null, undefined)).toBe(hash);
  expect(select(actor, { ...support, kind: 'direct' }, hash, undefined)).toBeNull();
});
