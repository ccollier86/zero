import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TenantRolePicker } from './tenant-role-picker';

const roles = [
  { key: 'member', label: 'Member', description: 'Basic access' },
  { key: 'manager', label: 'Manager', description: 'Manage staff' },
];

describe('TenantRolePicker', () => {
  test('renders a single bounded choice for simple authorization', () => {
    const markup = renderToStaticMarkup(
      createElement(TenantRolePicker, {
        roles,
        selected: ['member'],
        simple: true,
        legend: 'Initial organization role',
        selectLabel: 'New member organization role',
        actionContext: 'for new member',
        onChange: () => {},
      }),
    );

    expect(markup).toContain('aria-label="New member organization role"');
    expect(markup).toContain('role="combobox"');
  });

  test('renders accessible independent choices for advanced authorization', () => {
    const markup = renderToStaticMarkup(
      createElement(TenantRolePicker, {
        roles,
        selected: ['member'],
        simple: false,
        legend: 'Roles granted when accepted',
        selectLabel: 'Invitation organization role',
        actionContext: 'on invitation',
        onChange: () => {},
      }),
    );

    expect(markup).toContain('Roles granted when accepted');
    expect(markup).toContain('Remove Member on invitation');
    expect(markup).toContain('Grant Manager on invitation');
    expect(markup).toContain('Manage staff');
    expect(markup).toContain(
      'type="button" role="checkbox" aria-checked="true"',
    );
    expect(markup).toContain(
      'type="button" role="checkbox" aria-checked="false"',
    );
    expect(markup).toContain('motion-reduce:transition-none');
  });

  test('describes and enforces the projected advanced-role selection ceiling', () => {
    const markup = renderToStaticMarkup(
      createElement(TenantRolePicker, {
        roles,
        selected: ['member'],
        simple: false,
        maxSelected: 1,
        legend: 'Approval roles',
        selectLabel: 'Approval role',
        actionContext: 'on approval',
        onChange: () => {},
      }),
    );

    expect(markup).toContain('Choose up to 1 role.');
    expect(markup).toContain('aria-describedby=');
    expect(markup).toContain('aria-label="Grant Manager on approval"');
    expect(markup).toContain(
      'data-state="unchecked" data-disabled="" disabled=""',
    );
  });
});
