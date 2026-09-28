import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApplicationAccessManagement } from './application-access-management';

describe('ApplicationAccessManagement', () => {
  test('renders an SSR-safe profile hint without global account controls', () => {
    const markup = renderToStaticMarkup(createElement(ApplicationAccessManagement));
    expect(markup).toContain('Application access');
    expect(markup).toContain('advanced single-application authorization profile');
    expect(markup).not.toContain('tenant');
    expect(markup).not.toContain('organization');
    expect(markup).not.toContain('Reset password');
    expect(markup).not.toContain('MFA');
    expect(markup).not.toContain('Delete account');
  });
});
