/** Public controlled contracts and SSR-safe layout; browser tests cover menus/focus and retirement. */
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntegrationSettingsList, type IntegrationSettingsListProps } from './index';
import { findIntegrationSettingsAction, findIntegrationSettingsItem, integrationSettingsGroups } from './integration-settings-list-policy';

const item = { id: 'calendar', title: 'Calendar', description: 'App-owned scheduling',
  status: { label: 'Connected', tone: 'success' as const },
  actions: [{ id: 'disconnect', label: 'Remove connection', destructive: true, onSelect: () => {} }] };

describe('IntegrationSettingsList contracts', () => {
  test('flat mode avoids nested cards and groups include app-owned headings', () => {
    const flat = renderToStaticMarkup(<IntegrationSettingsList items={[item]} title="App Connections"
      description="Manage your connections" primaryAction={{ onSelect: () => {} }} />);
    expect(flat).toContain('integration-settings-list__flat');
    expect(flat).not.toContain('integration-settings-list__group-header');
    expect(flat).toContain('New Connection'); expect(flat).toContain('Actions for Calendar');
    expect(flat).toContain('Connected'); expect(flat).toContain('data-tone="success"');
    expect(flat).not.toContain('role="alertdialog"');
    const groups = renderToStaticMarkup(<IntegrationSettingsList groups={[{ id: 'schedule', title: 'Scheduling',
      description: 'Time management', items: [item] }]} />);
    expect(groups).toContain('<h3'); expect(groups).toContain('Scheduling'); expect(groups).toContain('Time management');
    expect(groups).toContain('integration-settings-list__group-header');
  });

  test('empty copy, restrictions, native props and fallback logo remain accessible', () => {
    expect(renderToStaticMarkup(<IntegrationSettingsList items={[]} emptyMessage="Nothing linked" />)).toContain('Nothing linked');
    const html = renderToStaticMarkup(<IntegrationSettingsList id="connections" aria-label="Account integrations"
      items={[{ ...item, disabledReason: 'Administrator managed' }]} primaryAction={{ disabledReason: 'Unavailable', onSelect: () => {} }} />);
    expect(html).toContain('id="connections"'); expect(html).toContain('aria-label="Account integrations"');
    expect(html).toContain('Administrator managed'); expect(html).toContain('Unavailable');
    expect(html.match(/disabled=""/g)?.length).toBe(2);
    expect(html).toContain('aria-hidden="true"');
    const readOnly = renderToStaticMarkup(<IntegrationSettingsList readOnly items={[item]} primaryAction={{ onSelect: () => {} }} />);
    expect(readOnly).toContain('Read-only connections'); expect(readOnly).toContain('Connected');
    expect(readOnly.match(/disabled=""/g)?.length).toBe(2);
    expect(findIntegrationSettingsAction({ readOnly: true, items: [item] }, '', item.id, undefined, 'disconnect')).toBeNull();
  });

  test('fresh descriptor objects stay current, but revision/identity and capability changes reject admission', () => {
    let props: IntegrationSettingsListProps = { items: [{ ...item, revision: 1 }] };
    expect(findIntegrationSettingsAction(props, '', item.id, 1, 'disconnect')?.item.title).toBe('Calendar');
    props = { items: [{ ...item, revision: 1, actions: [...item.actions] }] };
    expect(findIntegrationSettingsAction(props, '', item.id, 1, 'disconnect')).not.toBeNull();
    expect(findIntegrationSettingsItem(props, '', item.id, 2)).toBeNull();
    expect(findIntegrationSettingsAction({ items: [{ ...item, revision: 1, disabled: true }] }, '', item.id, 1, 'disconnect')).toBeNull();
    expect(findIntegrationSettingsAction({ items: [{ ...item, actions: [{ ...item.actions[0]!, disabledReason: 'Denied' }] }] }, '', item.id, undefined, 'disconnect')).toBeNull();
    expect(findIntegrationSettingsAction({ items: [] }, '', item.id, undefined, 'disconnect')).toBeNull();
  });

  test('rejects ambiguous IDs but permits the same row ID in separately named groups', () => {
    expect(() => integrationSettingsGroups({ items: [item, item] })).toThrow('row IDs');
    expect(() => integrationSettingsGroups({ items: [{ ...item, actions: [...item.actions, ...item.actions] }] })).toThrow('action IDs');
    expect(() => integrationSettingsGroups({ groups: [{ id: '', items: [] }] })).toThrow('group IDs');
    expect(() => integrationSettingsGroups({ groups: [{ id: 'g', items: [] }, { id: 'g', items: [] }] })).toThrow('group IDs');
    expect(integrationSettingsGroups({ groups: [{ id: 'one', items: [item] }, { id: 'two', items: [item] }] })).toHaveLength(2);
  });
});
