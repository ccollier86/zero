import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { UserManagementControlBar } from './user-management-control-bar';
import { UserManagement } from './adaptive-user-management';

describe('adaptive user management', () => {
  test('waits for live auth configuration without rendering disconnected cards', () => {
    const markup = renderToStaticMarkup(createElement(UserManagement));
    expect(markup).toContain('Loading account and organization controls');
    expect(markup).not.toContain('data-slot="card"');
  });

  test('keeps resource and people scope controls in one compact bar', () => {
    const markup = renderToStaticMarkup(createElement(UserManagementControlBar, {
      view: 'people',
      peopleScope: 'administration',
      administrationName: 'Zero Administration',
      workspaceSingular: 'workspace',
      workspacePlural: 'workspaces',
      onViewChange() {},
      onPeopleScopeChange() {},
    }));
    expect(markup).toContain('People');
    expect(markup).toContain('Workspaces');
    expect(markup).toContain('Zero Administration');
    expect(markup).not.toContain('data-slot="card"');

    const identityScope = renderToStaticMarkup(createElement(UserManagementControlBar, {
      view: 'people',
      peopleScope: 'identities',
      administrationName: 'Zero Administration',
      workspaceSingular: 'workspace',
      workspacePlural: 'workspaces',
      onViewChange() {},
      onPeopleScopeChange() {},
    }));
    expect(identityScope).toContain('All platform identities');
  });

  test('uses configured singular terminology without guessing from the plural', () => {
    const markup = renderToStaticMarkup(createElement(UserManagementControlBar, {
      view: 'workspaces',
      peopleScope: 'administration',
      administrationName: 'Zero Administration',
      workspaceSingular: 'company',
      workspacePlural: 'companies',
      onViewChange() {},
      onPeopleScopeChange() {},
    }));

    expect(markup).toContain('Companies');
    expect(markup).toContain('Select a company to inspect its members and access.');
    expect(markup).not.toContain('companie');
  });

  test('hides platform scopes which live application authority cannot read', () => {
    const markup = renderToStaticMarkup(createElement(UserManagementControlBar, {
      view: 'people',
      peopleScope: 'administration',
      administrationName: 'Zero Administration',
      workspaceSingular: 'workspace',
      workspacePlural: 'workspaces',
      showWorkspaces: false,
      showIdentities: false,
      onViewChange() {},
      onPeopleScopeChange() {},
    }));

    expect(markup).toContain('People');
    expect(markup).toContain('Zero Administration');
    expect(markup).not.toContain('Workspaces');
    expect(markup).not.toContain('All platform identities');
    expect(markup).not.toContain('aria-label="People scope"');
  });
});
