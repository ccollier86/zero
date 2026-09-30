import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AuditRow,
  ControlPlaneAuditViewer,
  formatAuthAuditScope,
} from './control-plane-audit-viewer';
import type { AuthAuditEvent } from '../../frontend/client/auth-audit-types';

describe('ControlPlaneAuditViewer', () => {
  test('renders an SSR-safe, explicitly scoped audit control surface', () => {
    const markup = renderToStaticMarkup(createElement(ControlPlaneAuditViewer, {
      scope: 'tenant',
    }));
    expect(markup).toContain('Authorization audit');
    expect(markup).toMatch(
      /<h2[^>]*data-slot="card-title"[^>]*>Authorization audit<\/h2>/,
    );
    expect(markup).toContain('Filter audit action');
    expect(markup).toContain('Filter audit target type');
    expect(markup).toContain('Export NDJSON');
    expect(markup).toContain('Apply filters');
    expect(markup).not.toContain('Prune');
    expect(markup).not.toContain('email');
  });

  test('attributes application and tenant events explicitly', () => {
    expect(formatAuthAuditScope({ scopeKind: 'application', tenantId: null }))
      .toBe('application');
    expect(formatAuthAuditScope({ scopeKind: 'tenant', tenantId: 'ten_acme' }))
      .toBe('tenant:ten_acme');
  });

  test('renders Scope before Action to match the table header order', () => {
    const event: AuthAuditEvent = {
      eventId: 'event-1',
      occurredAt: 1,
      action: 'tenant.member-added',
      outcome: 'succeeded',
      reason: null,
      scopeKind: 'tenant',
      tenantId: 'ten_acme',
      actorUserId: 'user-1',
      actorMembershipId: null,
      actorSessionId: null,
      actorSessionKind: null,
      actorClientId: null,
      actorProvenance: 'authenticated-request',
      requestId: null,
      correlationId: null,
      targetType: null,
      targetId: null,
      metadata: {},
    };
    const row = renderToStaticMarkup(createElement(AuditRow, { event }));
    expect(row.indexOf('ten_acme')).toBeLessThan(row.indexOf('tenant.member-added'));
  });
});
