/** Pure projection/selection checks, not persistence or transport qualification. */
import { expect, test } from 'bun:test';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { resolveMessagingConfig } from './config';
import { messagingSupportInboxes, selectMessagingSupportInbox } from './support-inbox-policy';
import type { MessagingActor } from './realm-model';

test('a current member can select only an admitted named inbox and never a visitor entry or guessed staff ID', () => {
  const config = resolveMessagingConfig({ portal: true, support: { defaultInbox: 'frontdesk', inboxes: { frontdesk: { title: 'Front desk' }, billing: {} } } }, '/synthetic', resolveAuthBehaviorConfig());
  if (!config) throw new Error('Missing synthetic config.');
  const actor: MessagingActor = { id: 'member', scopeId: 'application', kind: 'user', staff: false, portal: true,
    inboxPolicies: { frontdesk: config.supportInboxes.frontdesk!.policyHash } };
  expect(messagingSupportInboxes(config, actor)).toEqual([{ id: 'frontdesk', title: 'Front desk', canOpen: true, canHandle: false, assistant: false, default: true }]);
  expect(selectMessagingSupportInbox(config, actor, undefined)?.id).toBe('frontdesk');
  for (const value of ['billing', 'website', 'staff-user-id', '__proto__']) expect(() => selectMessagingSupportInbox(config, actor, value)).toThrow();
  expect(() => selectMessagingSupportInbox(config, { ...actor, inboxPolicies: {} }, undefined)).toThrow();
  const operator = { ...actor, portal: false, staff: true, inboxPolicies: {}, inboxStaffPolicies: { billing: config.supportInboxes.billing!.policyHash } };
  expect(messagingSupportInboxes(config, operator)).toEqual([{ id: 'billing', title: 'billing', canOpen: false, canHandle: true, assistant: false, default: false }]);
  expect(() => selectMessagingSupportInbox(config, operator, 'billing')).toThrow();
});
