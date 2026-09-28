import { describe, expect, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { resolveAuthRequestAdmissionConfig } from './auth-request-admission-config';
import {
  AUTH_REQUEST_ADMISSION_FLOWS,
  defineCurrentAuthRequestAdmissionTables,
} from './auth-request-admission-schema';
import { AuthRequestAdmissionService } from './auth-request-admission-service';
import { admitAuthRequest } from './auth-request-admission';

function createDatabase() {
  const db = createReactiveDB({ mode: 'memory' });
  db.exec(`CREATE TABLE _auth_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
  defineCurrentAuthRequestAdmissionTables(db);
  return db;
}

describe('public auth request admission', () => {
  test('persists every flow in the exhaustive current schema contract', () => {
    const db = createDatabase();
    const service = new AuthRequestAdmissionService(
      db,
      resolveAuthRequestAdmissionConfig(),
      () => 5_000,
    );

    for (const [index, flow] of AUTH_REQUEST_ADMISSION_FLOWS.entries()) {
      service.admit({
        flow,
        source: `source-${index}`,
        subject: `subject-${index}`,
      });
    }

    expect((db.prepare(`SELECT flow FROM _auth_request_admissions
      ORDER BY rowid`).all() as Array<{ flow: string }>).map((row) => row.flow))
      .toEqual([...AUTH_REQUEST_ADMISSION_FLOWS]);
    db.dispose();
  });

  test('persists the admitted row before atomic counts and rolls rejected rows back', () => {
    const db = createDatabase();
    let now = 10_000;
    const config = resolveAuthRequestAdmissionConfig({
      bootstrap: {
        window: '1m', maxGlobal: 10, maxPerSource: 2, maxPerSubject: 10,
      },
    });
    const service = new AuthRequestAdmissionService(db, config, () => now);

    service.admit({ flow: 'bootstrap', source: '203.0.113.1', subject: 'a@test' });
    service.admit({ flow: 'bootstrap', source: '203.0.113.1', subject: 'b@test' });
    expect(() => service.admit({
      flow: 'bootstrap', source: '203.0.113.1', subject: 'c@test',
    })).toThrow('Too many authentication requests');
    expect(countRows(db)).toBe(2);

    now += 60_001;
    service.admit({ flow: 'bootstrap', source: '203.0.113.1', subject: 'c@test' });
    expect(countRows(db)).toBe(3);
    expect(JSON.stringify(db.prepare(
      'SELECT * FROM _auth_request_admissions',
    ).all())).not.toContain('203.0.113.1');
    db.dispose();
  });

  test('limits hashed subjects across sources while keeping flows independent', () => {
    const db = createDatabase();
    const config = resolveAuthRequestAdmissionConfig({
      registration: {
        window: '5m', maxGlobal: 10, maxPerSource: 10, maxPerSubject: 2,
      },
      login: {
        window: '5m', maxGlobal: 10, maxPerSource: 10, maxPerSubject: 2,
      },
    });
    const service = new AuthRequestAdmissionService(db, config, () => 20_000);

    service.admit({ flow: 'registration', source: 'one', subject: 'same@test' });
    service.admit({ flow: 'registration', source: 'two', subject: 'same@test' });
    expect(() => service.admit({
      flow: 'registration', source: 'three', subject: 'same@test',
    })).toThrow('Too many authentication requests');
    expect(() => service.admit({
      flow: 'login', source: 'three', subject: 'same@test',
    })).not.toThrow();
    db.dispose();
  });

  test('trusts forwarded chains only when the direct peer is configured', () => {
    const db = createDatabase();
    const config = resolveAuthRequestAdmissionConfig({
      trustedProxyRanges: ['10.0.0.0/8'],
    });
    const service = new AuthRequestAdmissionService(db, config);
    const request = new Request('https://zero.test/auth/login', {
      headers: { 'x-forwarded-for': '198.51.100.8, 10.0.0.2' },
    });
    expect(config.sourceKey({
      request, flow: 'login', peerAddress: '10.0.0.3',
    })).toBe('198.51.100.8');
    expect(config.sourceKey({
      request, flow: 'login', peerAddress: '192.0.2.3',
    })).toBe('192.0.2.3');
    service.admit({ flow: 'login', source: '198.51.100.8', subject: 'user' });
    db.dispose();
  });

  test('fails closed on a broken deployment resolver and can be explicitly disabled', () => {
    const db = createDatabase();
    const broken = new AuthRequestAdmissionService(
      db,
      resolveAuthRequestAdmissionConfig({ sourceKey: () => { throw new Error('broken'); } }),
    );
    expect(() => admitAuthRequest({
      service: broken,
      request: new Request('https://zero.test/auth/register'),
      flow: 'registration',
      subject: 'USER@Example.test',
    })).toThrow('temporarily unavailable');

    const disabled = new AuthRequestAdmissionService(
      db,
      resolveAuthRequestAdmissionConfig({ enabled: false }),
    );
    for (let index = 0; index < 200; index += 1) {
      disabled.admit({ flow: 'bootstrap', source: 'same', subject: 'same' });
    }
    expect(countRows(db)).toBe(0);
    db.dispose();
  });

  test('rejects ambiguous proxy and malformed flow configuration', () => {
    expect(() => resolveAuthRequestAdmissionConfig({
      forwardedForHeader: 'x-real-ip',
    })).toThrow('requires at least one trustedProxyRange');
    expect(() => resolveAuthRequestAdmissionConfig({
      trustedProxyRanges: ['10.0.0.0/8'], sourceKey: () => 'source',
    })).toThrow('cannot be combined');
    expect(() => resolveAuthRequestAdmissionConfig({
      bootstrap: { window: '2w' },
    })).toThrow('positive duration');
    expect(() => resolveAuthRequestAdmissionConfig({
      login: { maxPerSource: 0 },
    })).toThrow('integer between 1');
  });
});

function countRows(db: ReturnType<typeof createReactiveDB>): number {
  return Number((db.prepare(
    'SELECT COUNT(*) AS count FROM _auth_request_admissions',
  ).get() as { count: number }).count);
}
