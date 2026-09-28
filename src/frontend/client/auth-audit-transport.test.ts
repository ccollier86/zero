import { describe, expect, test } from 'bun:test';
import { AuthAuditTransport } from './auth-audit-transport';

describe('AuthAuditTransport', () => {
  test('uses fixed scope routes and encodes only bounded audit filters', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const transport = createTransport(async (url, init) => {
      requests.push({ url, init });
      return Response.json({
        events: [],
        page: { limit: 25, count: 0, hasMore: false, nextCursor: null },
      });
    });

    await transport.list('tenant', {
      limit: 25,
      cursor: 'cursor/value',
      action: 'tenant.member-added',
      outcome: 'succeeded',
      from: 10,
      to: 20,
      targetType: 'tenant-membership',
      ...({ tenantId: 'must-not-cross-boundary' } as object),
    });

    expect(requests[0]?.url).toBe(
      'https://zero.test/auth/audit/tenant/events?limit=25&cursor=cursor%2Fvalue&action=tenant.member-added&outcome=succeeded&from=10&to=20&targetType=tenant-membership',
    );
    expect(requests[0]?.url).not.toContain('tenantId');
    expect(requests[0]?.init?.cache).toBe('no-store');
  });

  test('keeps export and retention on their explicit authorized routes', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const transport = createTransport(async (url, init) => {
      requests.push({ url, init });
      return Response.json(url.endsWith('/prune')
        ? { deleted: 0, hasMore: false }
        : { ndjson: '', count: 0, hasMore: false, nextCursor: null });
    });

    await transport.export('platform', { limit: 1_000 });
    await transport.prune();
    expect(requests.map(({ url, init }) => [url, init?.method])).toEqual([
      ['https://zero.test/auth/audit/platform/export?limit=1000', undefined],
      ['https://zero.test/auth/audit/platform/prune', 'POST'],
    ]);
  });

  test('normalizes authorization failures through the shared client error boundary', async () => {
    const normalized = new Error('normalized audit failure');
    const transport = new AuthAuditTransport({
      baseUrl: 'https://zero.test',
      authenticatedFetch: async () => Response.json(
        { code: 'FORBIDDEN', error: 'Forbidden' },
        { status: 403 },
      ),
      assertResponseCurrent: () => {},
      createResponseError: (_response, body, fallback) => {
        expect(body).toEqual({ code: 'FORBIDDEN', error: 'Forbidden' });
        expect(fallback).toBe('Failed to export authorization audit events');
        return normalized;
      },
    });

    await expect(transport.export('tenant')).rejects.toBe(normalized);
  });

  test('rejects malformed or oversized successful response bodies', async () => {
    const malformedPage = createTransport(async () => Response.json({
      events: [{ eventId: 'event-without-required-fields' }],
      page: { limit: 25, count: 1, hasMore: false, nextCursor: null },
    }));
    await expect(malformedPage.list('platform')).rejects.toThrow(
      'Failed to load authorization audit events: server returned an invalid response.',
    );

    const inconsistentExport = createTransport(async () => Response.json({
      ndjson: '',
      count: 1,
      hasMore: true,
      nextCursor: null,
    }));
    await expect(inconsistentExport.export('platform')).rejects.toThrow(
      'Failed to export authorization audit events: server returned an invalid response.',
    );

    const invalidPrune = createTransport(async () => Response.json({
      deleted: 10_001,
      hasMore: false,
    }));
    await expect(invalidPrune.prune()).rejects.toThrow(
      'Failed to prune authorization audit events: server returned an invalid response.',
    );

    const unexpectedExportField = createTransport(async () => Response.json({
      ndjson: JSON.stringify({ ...validEvent(), unexpected: 'must-not-pass-through' }),
      count: 1,
      hasMore: false,
      nextCursor: null,
    }));
    await expect(unexpectedExportField.export('platform')).rejects.toThrow(
      'Failed to export authorization audit events: server returned an invalid response.',
    );
  });
});

function validEvent() {
  return {
    eventId: 'event-1',
    occurredAt: 1,
    action: 'tenant.member-added',
    outcome: 'succeeded',
    reason: null,
    scopeKind: 'tenant',
    tenantId: 'tenant-1',
    actorUserId: 'user-1',
    actorMembershipId: null,
    actorSessionId: null,
    actorSessionKind: null,
    actorClientId: null,
    actorProvenance: 'authenticated-request',
    requestId: null,
    correlationId: null,
    targetType: 'tenant-membership',
    targetId: 'membership-1',
    metadata: {},
  };
}

function createTransport(
  authenticatedFetch: (url: string, init?: RequestInit) => Promise<Response>,
) {
  return new AuthAuditTransport({
    baseUrl: 'https://zero.test',
    authenticatedFetch,
    assertResponseCurrent: () => {},
    createResponseError: () => new Error('unexpected response error'),
  });
}
