/** Memory-only native SYSTEM qualification. All accounts are synthetic; no files, actors or servers. */
import { expect, spyOn, test } from 'bun:test';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { defineAuthTables } from '../auth/auth-schema';
import { UserStore } from '../auth/user-store';
import { TenantStore, TenancyService } from '../auth/tenancy';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { createAuthorizationKernel, type AccessRequirement } from '../auth/authorization-kernel';
import { AuthorizationRoleStore } from '../auth/authorization-role-store';
import { AuthorizationRoleService } from '../auth/authorization-role-service';
import { installAuthAuthorityRevision } from '../auth/auth-authority-revision';
import { applicationServiceDataScope, trustedSystemServiceDataScope } from '../auth/service-data-scope';
import { resolveCalendarConfig } from './config';
import { ManagedCalendarParticipantDirectory } from './participants-directory';
import type { CalendarParticipantReference } from './contracts';

const app = applicationServiceDataScope();
const ref = (userId: string): CalendarParticipantReference => ({ kind: 'guardian-user', userId });
function fixture(input: { tenancy?: 'single' | 'multi'; rule?: AccessRequirement; advanced?: boolean; pageSize?: number; maxParticipants?: number } = {}) {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    defineAuthTables(db);
    const auth = resolveAuthBehaviorConfig({ tenancy: input.tenancy ?? 'single',
      userProperties: { staff: { editableBy: 'admin', useInPolicies: true }, preference: { editableBy: 'user' } },
      ...(input.advanced ? { authorization: { mode: 'advanced', permissions: { 'calendar:participate': { label: 'Participant' } },
        roles: { participant: { permissions: ['calendar:participate'] } } } } : {}),
    });
    const users = new UserStore(db, { tenancyMode: input.tenancy ?? 'single' });
    const tenancy = new TenancyService(new TenantStore(db));
    const kernel = createAuthorizationKernel(auth);
    const roles = input.advanced ? new AuthorizationRoleService(db, new AuthorizationRoleStore(db), kernel, users, tenancy) : null;
    installAuthAuthorityRevision(db);
    const config = resolveCalendarConfig({ timezone: 'UTC', maxPageSize: input.pageSize ?? 100, maxParticipants: input.maxParticipants ?? 100,
      participants: { userEligibility: input.rule ?? { properties: { staff: 'yes' } } } }, '/synthetic-participant-directory', auth);
    if (!config) throw new Error('Expected synthetic calendar config.');
    const directory = new ManagedCalendarParticipantDirectory({ db, users, tenancy, kernel, roles, config, assertCurrent: () => users.assertCurrentProfile() });
    return { db, users, tenancy, kernel, roles, config, directory, close: () => { directory.close(); db.dispose(); } };
  } catch (error) { db.dispose(); throw error; }
}
function account(db: ReactiveDB, id: string, name: string | null = id, staff = true): void {
  db.prepare(`INSERT INTO users(user_id,username,email,first_name,role,status,created_at)
    VALUES(?,?,?,?,'user','active',1)`).run(id, id + '@login.example.test', id + '@private.example.test', name);
  if (staff) db.prepare("INSERT INTO user_properties(user_id,key,value) VALUES(?,'staff','yes')").run(id);
}
function marker(db: ReactiveDB, id: string, table: 'registration' | 'admin'): void {
  if (table === 'registration') db.prepare(`INSERT INTO _auth_registration_provisioning
    (registration_id,user_id,is_bootstrap,created_at) VALUES(?,?,0,1)`).run('marker-' + id, id);
  else db.prepare(`INSERT INTO _auth_admin_user_provisioning
    (provisioning_id,user_id,user_fingerprint,auth_generation,lease_owner_hash,lease_expires_at,created_at)
    VALUES(?,?,'synthetic',0,?,9999999999999,1)`).run('marker-' + id, id, 'a'.repeat(64));
}

test('directory returns only minimal native current finalized eligible account names, never contact/login fallbacks', () => {
  const f = fixture();
  try {
    for (const id of ['ready', 'unnamed', 'registration', 'admin', 'password', 'verify', 'suspended', 'hidden']) account(f.db, id, id === 'unnamed' ? null : id, id !== 'hidden');
    marker(f.db, 'registration', 'registration'); marker(f.db, 'admin', 'admin');
    f.db.prepare("UPDATE users SET password_change_required=1 WHERE user_id='password'").run();
    f.db.prepare("UPDATE users SET email_verification_required=1 WHERE user_id='verify'").run();
    f.db.prepare("UPDATE users SET status='suspended' WHERE user_id='suspended'").run();
    expect(f.directory.list(app, {})).toEqual({ items: [
      { ref: ref('ready'), availability: 'available', name: 'ready' },
      { ref: ref('unnamed'), availability: 'available', name: 'Account' },
    ], truncated: false, nextAfter: null });
    expect(f.directory.resolve(app, ['ready', 'hidden', 'missing', 'registration', 'admin'].map(ref))).toEqual([
      { ref: ref('ready'), availability: 'available', name: 'ready' },
      ...['hidden', 'missing', 'registration', 'admin'].map(userId => ({ ref: ref(userId), availability: 'unavailable' as const })),
    ]);
    for (const id of ['hidden', 'missing', 'registration', 'admin', 'password', 'verify', 'suspended']) {
      expect(() => f.directory.assertBindable(app, [ref(id)])).toThrow(expect.objectContaining({ code: 'CALENDAR_NOT_FOUND' }));
    }
    expect(f.directory.assertBindable(app, [ref('ready')])).toBeUndefined();
    expect(JSON.stringify(f.directory.resolve(app, [ref('unnamed')]))).not.toContain('@');
  } finally { f.close(); }
});

test('discovery snapshots do not authorize later binding or stale names after subject revocation', () => {
  const f = fixture();
  try {
    account(f.db, 'participant', 'Synthetic name');
    const snapshot = f.directory.list(app, {}).items[0]!;
    expect(snapshot.availability).toBe('available');
    f.users.setProperty('participant', 'staff', 'no');
    expect(f.directory.resolve(app, [snapshot.ref])).toEqual([{ ref: ref('participant'), availability: 'unavailable' }]);
    expect(() => f.directory.assertBindable(app, [snapshot.ref])).toThrow(expect.objectContaining({ code: 'CALENDAR_NOT_FOUND' }));
    f.users.setProperty('participant', 'staff', 'yes');
    expect(f.directory.resolve(app, [snapshot.ref])[0]).toMatchObject({ availability: 'available' });
    marker(f.db, 'participant', 'registration');
    expect(f.directory.resolve(app, [snapshot.ref])).toEqual([{ ref: ref('participant'), availability: 'unavailable' }]);
  } finally { f.close(); }
});

test('lowering new-binding capacity never prevents resolving retained hard-bounded participant sets', () => {
  const f = fixture({ maxParticipants: 1 });
  try {
    account(f.db, 'first'); account(f.db, 'second');
    expect(f.directory.resolve(app, [ref('first'), ref('second')])).toHaveLength(2);
    expect(() => f.directory.assertBindable(app, [ref('first'), ref('second')])).toThrow(expect.objectContaining({ code: 'CALENDAR_INPUT_INVALID' }));
  } finally { f.close(); }
});

test('multi directory uses actual active exact-tenant membership and never application fallback', () => {
  const f = fixture({ tenancy: 'multi', rule: 'user' });
  try {
    for (const id of ['owner-a', 'owner-b', 'member', 'foreign']) account(f.db, id);
    const first = f.tenancy.createTenant({ slug: 'first', name: 'First', ownerUserId: 'owner-a' });
    const second = f.tenancy.createTenant({ slug: 'second', name: 'Second', ownerUserId: 'owner-b' });
    const member = f.tenancy.addMembership({ tenantId: first.tenant.tenantId, userId: 'member', roleKey: 'member', createdBy: 'owner-a' });
    f.tenancy.addMembership({ tenantId: second.tenant.tenantId, userId: 'foreign', roleKey: 'member', createdBy: 'owner-b' });
    const scope = trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: first.tenant.tenantId });
    expect(() => f.directory.list(app, {})).toThrow(expect.objectContaining({ code: 'CALENDAR_NOT_FOUND' }));
    expect(f.directory.list(scope, {}).items.map(item => item.ref.userId)).toEqual(['member', 'owner-a']);
    expect(f.directory.resolve(scope, [ref('foreign')])).toEqual([{ ref: ref('foreign'), availability: 'unavailable' }]);
    f.tenancy.suspendMembership(member.membershipId);
    expect(f.directory.resolve(scope, [ref('member')])).toEqual([{ ref: ref('member'), availability: 'unavailable' }]);
    expect(() => f.directory.assertBindable(scope, [ref('member')])).toThrow(expect.objectContaining({ code: 'CALENDAR_NOT_FOUND' }));
    f.tenancy.suspendTenant(first.tenant.tenantId);
    expect(() => f.directory.resolve(scope, [ref('owner-a')])).toThrow(expect.objectContaining({ code: 'CALENDAR_NOT_FOUND' }));
  } finally { f.close(); }
});

test('sparse-policy scans are bounded, continue without hidden-ID disclosure and reuse healthy continuation tokens', () => {
  const f = fixture();
  try {
    f.db.transaction(() => { for (let n = 0; n < 1003; n++) account(f.db, 'subject-' + String(n).padStart(4, '0'), 'Subject', n === 1001 || n === 1002); });
    const policyReads = spyOn(f.users, 'getUserById');
    try {
      const first = f.directory.list(app, { limit: 1 });
      expect(first.items).toEqual([]); expect(first.truncated).toBe(true);
      expect(policyReads).toHaveBeenCalledTimes(1000);
      expect(first.nextAfter).toMatch(/^pc_[a-f0-9-]{36}$/);
      expect(first.nextAfter).not.toContain('subject');
      expect(f.directory.list(app, { limit: 1 }).nextAfter).toBe(first.nextAfter);
      const second = f.directory.list(app, { limit: 1, after: first.nextAfter! });
      expect(second.items.map(item => item.ref.userId)).toEqual(['subject-1001']);
      expect(f.directory.list(app, { limit: 1, after: second.nextAfter! }).items.map(item => item.ref.userId)).toEqual(['subject-1002']);
      for (const query of [{ limit: 2, after: first.nextAfter! }, { limit: 1, search: 'Subject', after: first.nextAfter! },
        { limit: 1, after: 'subject-0999' }]) expect(() => f.directory.list(app, query)).toThrow(expect.objectContaining({ code: 'CALENDAR_INPUT_INVALID' }));
    } finally { policyReads.mockRestore(); }
  } finally { f.close(); }
});

test('cursors are scope/query-bound, expire after five minutes and are invalid after owner restart', () => {
  const f = fixture({ tenancy: 'multi', rule: 'user' });
  const clock = spyOn(Date, 'now');
  try {
    clock.mockReturnValue(10_000);
    for (const id of ['owner', 'a', 'b']) account(f.db, id);
    const first = f.tenancy.createTenant({ slug: 'first', name: 'First', ownerUserId: 'owner' });
    const second = f.tenancy.createTenant({ slug: 'second', name: 'Second', ownerUserId: 'owner' });
    for (const id of ['a', 'b']) f.tenancy.addMembership({ tenantId: first.tenant.tenantId, userId: id, roleKey: 'member', createdBy: 'owner' });
    const scope = trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: first.tenant.tenantId });
    const other = trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: second.tenant.tenantId });
    const page = f.directory.list(scope, { limit: 1, search: ' a ' });
    // One matching item is terminal, so use unfiltered traversal to mint a token.
    expect(page.items.map(item => item.ref.userId)).toEqual(['a']);
    const token = f.directory.list(scope, { limit: 1 }).nextAfter!;
    expect(() => f.directory.list(other, { limit: 1, after: token })).toThrow(expect.objectContaining({ code: 'CALENDAR_INPUT_INVALID' }));
    clock.mockReturnValue(310_000);
    expect(() => f.directory.list(scope, { limit: 1, after: token })).toThrow(expect.objectContaining({ code: 'CALENDAR_INPUT_INVALID' }));
    f.directory.close();
    const restarted = new ManagedCalendarParticipantDirectory({ ...f, config: f.config, assertCurrent() {} });
    try { expect(() => restarted.list(scope, { limit: 1, after: token })).toThrow(expect.objectContaining({ code: 'CALENDAR_INPUT_INVALID' })); }
    finally { restarted.close(); }
  } finally { clock.mockRestore(); f.close(); }
});

test('search is literal minimal-name-only and strict bounds/kinds reject unsupported input', () => {
  const f = fixture({ pageSize: 2, rule: 'user' });
  try {
    account(f.db, 'wildcard', 'Percent % underscore _ slash \\'); account(f.db, 'ordinary', 'Ordinary');
    expect(f.directory.list(app, { search: '%' }).items.map(item => item.ref.userId)).toEqual(['wildcard']);
    expect(f.directory.list(app, { search: 'private.example.test' }).items).toEqual([]);
    expect(f.directory.list(app, { search: 'login.example.test' }).items).toEqual([]);
    expect(f.directory.list(app, { search: '' })).toEqual(f.directory.list(app, {}));
    expect(f.directory.list(app, { search: '   ' })).toEqual(f.directory.list(app, {}));
    for (const input of [{ limit: 3 }, { search: 'x'.repeat(101) }, { search: '\u0000' }, { count: true }]) {
      expect(() => f.directory.list(app, input as never)).toThrow(expect.objectContaining({ code: 'CALENDAR_INPUT_INVALID' }));
    }
    for (const refs of [[{ kind: 'contact', userId: 'wildcard' }], [ref('wildcard'), ref('wildcard')], [{ ...ref('wildcard'), eligible: true }], [ref('non-ascii-\u00e9')]]) {
      expect(() => f.directory.assertBindable(app, refs as never)).toThrow(expect.objectContaining({ code: 'CALENDAR_INPUT_INVALID' }));
    }
  } finally { f.close(); }
});

test('offline eligibility follows current actual advanced canonical assignments, not global admin or self-editable fields', () => {
  const f = fixture({ advanced: true, rule: { permission: 'calendar:participate' } });
  try {
    account(f.db, 'scheduler'); account(f.db, 'not-assigned');
    f.db.prepare("UPDATE users SET role='admin' WHERE user_id='not-assigned'").run();
    f.users.setProperty('not-assigned', 'preference', 'participant');
    f.roles!.assignApplicationRole({ userId: 'scheduler', roleKey: 'participant', createdBy: 'scheduler' });
    expect(f.directory.list(app, {}).items.map(item => item.ref.userId)).toEqual(['scheduler']);
    f.roles!.removeApplicationRole({ userId: 'scheduler', roleKey: 'participant', revokedBy: 'scheduler' });
    expect(f.directory.resolve(app, [ref('scheduler')])).toEqual([{ ref: ref('scheduler'), availability: 'unavailable' }]);
  } finally { f.close(); }
});

test('directory owns only disposable in-memory hints and retained facades stop after close', () => {
  const f = fixture();
  try {
    account(f.db, 'participant'); let wakes = 0;
    const unsubscribe = f.directory.subscribe(app, () => { wakes++; });
    f.users.setProperty('participant', 'staff', 'no'); expect(wakes).toBe(1);
    unsubscribe(); f.users.setProperty('participant', 'staff', 'yes'); expect(wakes).toBe(1);
    f.directory.subscribe(app, () => { wakes++; }); f.directory.close();
    f.users.setProperty('participant', 'staff', 'no'); expect(wakes).toBe(1);
    expect(() => f.directory.resolve(app, [ref('participant')])).toThrow(expect.objectContaining({ code: 'CALENDAR_NOT_READY' }));
    const asyncDirectory = new ManagedCalendarParticipantDirectory({ ...f, assertCurrent: async () => {} });
    try { expect(() => asyncDirectory.assertBindable(app, [])).toThrow(expect.objectContaining({ code: 'AUTH_STATE_INVARIANT_FAILED' })); }
    finally { asyncDirectory.close(); }
  } finally { f.close(); }
});

test('read-only SYSTEM confirmation transactions are quiet while real raw name, policy and provisioning changes still invalidate', () => {
  const f = fixture();
  try {
    account(f.db, 'participant', 'Before'); let wakes = 0;
    const unsubscribe = f.directory.subscribe(app, () => { wakes++; });
    const total = () => (f.db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
    const beforeReads = total();
    for (let n = 0; n < 20; n++) f.db.transaction(() => {
      f.users.getUserById('participant'); f.directory.resolve(app, [ref('participant')]);
    });
    expect(total()).toBe(beforeReads); expect(wakes).toBe(0);
    f.db.transaction(() => { f.db.prepare("UPDATE users SET first_name='Current' WHERE user_id='participant'").run(); });
    expect(wakes).toBe(1);
    expect(f.directory.resolve(app, [ref('participant')])[0]).toMatchObject({ availability: 'available', name: 'Current' });
    f.db.transaction(() => { f.users.getProperties('participant'); }); expect(wakes).toBe(1);
    f.users.setProperty('participant', 'staff', 'no'); expect(wakes).toBe(2);
    expect(f.directory.resolve(app, [ref('participant')])).toEqual([{ ref: ref('participant'), availability: 'unavailable' }]);
    f.users.setProperty('participant', 'staff', 'yes'); expect(wakes).toBe(3);
    f.db.transaction(() => { marker(f.db, 'participant', 'registration'); }); expect(wakes).toBe(4);
    expect(f.directory.resolve(app, [ref('participant')])).toEqual([{ ref: ref('participant'), availability: 'unavailable' }]);
    unsubscribe(); f.db.transaction(() => {}); expect(wakes).toBe(4);
  } finally { f.close(); }
});
