/** Pure canonical route/config selection. Current identity, private membership and real native handoffs are separate gates. */
import { expect, test } from 'bun:test';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { resolveMessagingConfig } from './config';
import { selectMessagingConversationAssistant as select, type MessagingAssistantRoute } from './assistant-selection';

test('human restart selection uses the exact current authenticated or public destination rather than the global bot registry', () => {
  const make = (disabled = false) => {
    const config = resolveMessagingConfig({ portal: true, assistant: {}, assistants: { help: {} }, support: {
      ...(disabled ? { assistant: false as const } : {}), inboxes: { team: { assistant: disabled ? false : 'help' } },
      entries: { website: { origin: 'https://synthetic.example', assistant: disabled ? false : 'help' } },
    } }, '/synthetic', resolveAuthBehaviorConfig());
    if (!config) throw new Error('Missing synthetic messaging configuration.'); return config;
  };
  const config = make(), disabled = make(true), legacy: MessagingAssistantRoute = { kind: 'support', assistantId: 'default', entryId: null, visitor: false };
  const routed = { ...legacy, assistantId: 'help', entryId: 'team' }, visitor = { ...routed, entryId: 'website', visitor: true };
  expect(select(config, legacy)?.id).toBe('default'); expect(select(config, routed)?.id).toBe('help'); expect(select(config, visitor)?.id).toBe('help');
  for (const route of [legacy, routed, visitor]) expect(select(disabled, route)).toBeUndefined();
  expect(select(config, { ...routed, assistantId: 'default' })).toBeUndefined();
  expect(select(config, { ...routed, visitor: true })).toBeUndefined();
  expect(select(config, { ...visitor, visitor: false })).toBeUndefined();
  expect(select(config, { ...routed, entryId: 'removed' })).toBeUndefined();
  expect(select(disabled, { ...legacy, kind: 'assistant' })?.id).toBe('default');
  expect(select(config, { ...legacy, kind: 'direct' })).toBeUndefined();
});
