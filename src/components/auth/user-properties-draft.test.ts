import { expect, test } from 'bun:test';
import type { AuthUserPropertyConfig } from '../../frontend/client/auth-types';
import { UserPropertiesDraft } from './user-properties-draft';

const fields: AuthUserPropertyConfig[] = [
  { key: 'professional_credentials', type: 'string', editableBy: 'user' },
  { key: 'optional', type: 'string', editableBy: 'user' },
  { key: 'alerts', type: 'boolean', editableBy: 'user' },
  { key: 'quota', type: 'number', editableBy: 'user' },
  { key: 'plan', type: 'string', editableBy: 'admin', useInPolicies: true },
];

test('absent fields/defaults are not writes; typed equivalents and reverted edits are clean', () => {
  const draft = new UserPropertiesDraft();
  draft.reconcile(fields, { quota: '1.0', plan: 'premium' });
  expect(draft.changes()).toEqual([]);
  expect(draft.dirty).toBe(false);
  draft.edit('quota', 1); draft.edit('alerts', false); draft.edit('optional', '');
  expect(draft.changes()).toEqual([]);
  draft.edit('professional_credentials', 'Changed');
  expect(draft.changes()).toEqual([{ key: 'professional_credentials', value: 'Changed' }]);
  draft.edit('professional_credentials', ''); draft.edit('plan', 'forged');
  expect(draft.changes()).toEqual([]);
});

test('unrelated snapshots and presentation/config object replacement preserve professional drafts', () => {
  const draft = new UserPropertiesDraft();
  draft.reconcile(fields, {}); draft.edit('professional_credentials', 'Draft');
  draft.reconcile(structuredClone(fields).map(field => ({ ...field, label: 'New label' })), { unrelated: 'new' });
  expect(draft.value('professional_credentials')).toBe('Draft');
  expect(draft.changes()).toEqual([{ key: 'professional_credentials', value: 'Draft' }]);
  draft.reconcile(fields.map(field => ({ ...field, default: 'New default' })), {});
  expect(draft.value('professional_credentials')).toBe('Draft');
});

test('accepted fields leave the retry set; newer typing and an explicit revert survive pending acknowledgments', () => {
  const draft = new UserPropertiesDraft(); draft.reconcile(fields, {});
  draft.edit('professional_credentials', 'Submitted'); draft.edit('optional', 'Next');
  const writes = draft.changes(); draft.begin(writes);
  draft.edit('professional_credentials', ''); // An intentional newer revert, not untouched input.
  draft.reconcile(fields, { professional_credentials: 'Submitted' });
  expect(draft.value('professional_credentials')).toBe('');
  draft.accept(writes[0]!); draft.finish();
  expect(draft.changes()).toEqual([{ key: 'professional_credentials', value: '' }, { key: 'optional', value: 'Next' }]);
  draft.edit('professional_credentials', 'Submitted');
  expect(draft.changes()).toEqual([{ key: 'optional', value: 'Next' }]);
});

test('removed/restricted fields retire drafts and blank numbers never become implicit zero writes', () => {
  const draft = new UserPropertiesDraft(); draft.reconcile(fields, { quota: '2' });
  draft.edit('quota', ''); expect(() => draft.changes()).toThrow('finite number');
  draft.edit('quota', 3); draft.edit('optional', 'Removed');
  draft.reconcile(fields.filter(field => field.key !== 'optional').map(field => field.key === 'quota' ? { ...field, editableBy: 'admin' } : field), {});
  expect(draft.changes()).toEqual([]);
});
