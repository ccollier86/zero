/** Private SYSTEM avatar row mechanics; no providers, HTTP or credential policy. */
import type { ReactiveDB } from '../sync/reactive-db';
import type { UserStore } from './user-store';
import type { AuthContextAuthorityReference } from './types';
import { AuthError } from './types';
import { inspectUserAvatarSchema } from './auth-user-avatar-schema';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';

export interface AvatarAssetRow {
  asset_id: string; user_id: string; path: string; state: 'pending' | 'current' | 'retired';
  checksum: string | null; byte_length: number | null; width: number | null; height: number | null;
  created_at: number; lease_token: string | null; lease_until: number;
}
export interface AvatarStageRow {
  stage_id: string; user_id: string; expected_revision: number; authority_json: string; receipt_hash: string;
  path: string; state: 'allocated' | 'processing' | 'consumed' | 'retired';
  expires_at: number; created_at: number; lease_token: string | null; lease_until: number; asset_id: string | null;
}
export class AuthUserAvatarStore {
  constructor(private readonly db: ReactiveDB, private readonly users: UserStore, private readonly now = Date.now) {
    if (db.getTransactionDomain() !== users.getTransactionDomain()) throw new AuthError('Avatar transaction domain is invalid', 'AUTH_STATE_INVARIANT_FAILED', 500);
  }
  assertReady(): void {
    this.users.assertCurrentProfile();
    if (inspectUserAvatarSchema(this.db) !== 'ready') throw new AuthError('Avatar storage needs a SYSTEM schema upgrade', 'AUTH_AVATAR_SCHEMA_UNREADY', 503);
  }
  namespace(): string | null {
    this.assertReady();
    return (this.db.prepare('SELECT drive_id FROM _auth_avatar_namespace WHERE singleton = 1').get() as { drive_id: string } | null)?.drive_id ?? null;
  }
  installNamespace(driveId: string): void {
    this.assertReady();
    this.db.prepare('INSERT INTO _auth_avatar_namespace (singleton, drive_id) VALUES (1, ?)').run(driveId);
  }
  revision(userId: string): number {
    this.assertReady();
    const row = this.db.prepare('SELECT profile_revision FROM users WHERE user_id = ?').get(userId) as { profile_revision: number } | null;
    if (!row || !Number.isSafeInteger(row.profile_revision) || row.profile_revision < 1) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
    return row.profile_revision;
  }
  current(userId: string): AvatarAssetRow | null {
    this.assertReady();
    return this.db.prepare(`SELECT a.* FROM _auth_avatar_assets a JOIN _auth_user_avatars u ON u.asset_id = a.asset_id
      WHERE u.user_id = ? AND a.user_id = ? AND a.state = 'current'`).get(userId, userId) as AvatarAssetRow | null;
  }
  asset(assetId: string): AvatarAssetRow | null {
    this.assertReady(); return this.db.prepare('SELECT * FROM _auth_avatar_assets WHERE asset_id = ?').get(assetId) as AvatarAssetRow | null;
  }
  directoryDisplayName(userId: string): string {
    this.assertReady();
    const user = this.users.getUserById(userId);
    if (!user) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
    const profile = this.db.prepare('SELECT preferred_name FROM _auth_user_profiles WHERE user_id = ?').get(userId) as { preferred_name: string | null } | null;
    return profile?.preferred_name || [user.firstName, user.lastName].filter(Boolean).join(' ') || 'User';
  }
  allocate(input: { id: string; userId: string; expectedRevision: number; authority: AuthContextAuthorityReference;
    receiptHash: string; path: string; expiresAt: number }, assertAuthority: () => void): AvatarStageRow {
    return this.users.transaction(() => {
      this.assertReady(); this.admit(assertAuthority); this.assertRevision(input.userId, input.expectedRevision);
      const count = this.db.prepare(`SELECT count(*) AS count FROM _auth_avatar_stages WHERE user_id = ?
        AND state IN ('allocated', 'processing') AND expires_at > ?`).get(input.userId, this.now()) as { count: number };
      if (count.count >= 3) throw new AuthError('Finish or cancel an existing avatar upload first', 'AUTH_AVATAR_STAGE_LIMIT', 429);
      this.db.prepare(`INSERT INTO _auth_avatar_stages (stage_id, user_id, expected_revision, authority_json, receipt_hash,
        path, state, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, 'allocated', ?, ?)`).run(input.id, input.userId,
        input.expectedRevision, JSON.stringify(input.authority), input.receiptHash, input.path, input.expiresAt, this.now());
      this.admit(assertAuthority); return this.stage(input.id)!;
    });
  }
  stage(id: string): AvatarStageRow | null {
    this.assertReady(); return this.db.prepare('SELECT * FROM _auth_avatar_stages WHERE stage_id = ?').get(id) as AvatarStageRow | null;
  }
  claim(stage: AvatarStageRow, lease: string, assertAuthority: () => void): AvatarStageRow {
    return this.users.transaction(() => {
      this.assertReady(); this.admit(assertAuthority); this.assertRevision(stage.user_id, stage.expected_revision);
      const result = this.db.prepare(`UPDATE _auth_avatar_stages SET state = 'processing', lease_token = ?, lease_until = ?
        WHERE stage_id = ? AND receipt_hash = ? AND expires_at > ? AND
        (state = 'allocated' OR (state = 'processing' AND lease_until < ?))`).run(lease, this.now() + 120_000,
        stage.stage_id, stage.receipt_hash, this.now(), this.now());
      if (result.changes !== 1) throw retiredStage();
      this.admit(assertAuthority); return this.stage(stage.stage_id)!;
    });
  }
  assertStageLease(stageId: string, lease: string): AvatarStageRow {
    const row = this.stage(stageId);
    if (!row || row.state !== 'processing' || row.lease_token !== lease || row.lease_until <= this.now()
      || row.expires_at <= this.now()) throw retiredStage();
    return row;
  }
  allocateAsset(stageId: string, lease: string, assetId: string, assertAuthority: () => void): AvatarAssetRow {
    return this.users.transaction(() => {
      this.assertReady(); this.admit(assertAuthority);
      const stage = this.assertStageLease(stageId, lease);
      this.assertRevision(stage.user_id, stage.expected_revision);
      this.db.prepare(`INSERT INTO _auth_avatar_assets (asset_id, user_id, path, state, created_at, lease_token, lease_until)
        VALUES (?, ?, ?, 'pending', ?, ?, ?)`).run(assetId, stage.user_id, `/avatars/assets/${assetId}.webp`, this.now(), lease, stage.lease_until);
      this.db.prepare('UPDATE _auth_avatar_stages SET asset_id = ? WHERE stage_id = ? AND lease_token = ?').run(assetId, stageId, lease);
      this.admit(assertAuthority); return this.asset(assetId)!;
    });
  }
  assertPendingAsset(assetId: string, lease: string): AvatarAssetRow {
    const row = this.asset(assetId);
    if (!row || row.state !== 'pending' || row.lease_token !== lease || row.lease_until <= this.now()) throw retiredStage();
    return row;
  }
  accept(stageId: string, lease: string, image: { checksum: string; byteLength: number; width: number; height: number }, assertAuthority: () => void): number {
    return this.users.transaction(() => {
      this.assertReady(); this.admit(assertAuthority);
      const stage = this.assertStageLease(stageId, lease);
      if (!stage.asset_id) throw retiredStage();
      const asset = this.assertPendingAsset(stage.asset_id, lease);
      this.assertRevision(stage.user_id, stage.expected_revision);
      const previous = this.current(stage.user_id);
      if (!this.db.update('users', stage.user_id, { profile_revision: stage.expected_revision + 1, updated_at: this.now() })) throw retiredStage();
      this.db.prepare(`UPDATE _auth_avatar_assets SET state = 'current', checksum = ?, byte_length = ?, width = ?, height = ?,
        lease_token = NULL, lease_until = 0 WHERE asset_id = ? AND state = 'pending' AND lease_token = ?`).run(image.checksum,
        image.byteLength, image.width, image.height, asset.asset_id, lease);
      this.db.prepare(`INSERT INTO _auth_user_avatars (user_id, asset_id) VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET asset_id = excluded.asset_id`).run(stage.user_id, asset.asset_id);
      if (previous) this.db.prepare("UPDATE _auth_avatar_assets SET state = 'retired' WHERE asset_id = ?").run(previous.asset_id);
      this.db.prepare("UPDATE _auth_avatar_stages SET state = 'consumed', lease_token = NULL, lease_until = 0 WHERE stage_id = ? AND lease_token = ?").run(stageId, lease);
      this.admit(assertAuthority); return stage.expected_revision + 1;
    });
  }
  remove(userId: string, expectedRevision: number, assertAuthority: () => void): number {
    return this.users.transaction(() => {
      this.assertReady(); this.admit(assertAuthority); this.assertRevision(userId, expectedRevision);
      const previous = this.current(userId);
      if (!previous) { this.admit(assertAuthority); return expectedRevision; }
      this.db.prepare('DELETE FROM _auth_user_avatars WHERE user_id = ?').run(userId);
      this.db.prepare("UPDATE _auth_avatar_assets SET state = 'retired' WHERE asset_id = ?").run(previous.asset_id);
      this.db.update('users', userId, { profile_revision: expectedRevision + 1, updated_at: this.now() });
      this.admit(assertAuthority); return expectedRevision + 1;
    });
  }
  retireStage(stageId: string, lease?: string): void {
    this.users.transaction(() => {
      this.assertReady();
      const stage = this.stage(stageId);
      this.db.prepare(`UPDATE _auth_avatar_stages SET state = 'retired', lease_token = NULL, lease_until = 0
        WHERE stage_id = ? AND state != 'consumed' ${lease ? 'AND lease_token = ?' : ''}`).run(...(lease ? [stageId, lease] : [stageId]));
      // Only the finalizer returning from provider I/O can release its asset
      // lease. Cancellation alone must not race cleanup against that write.
      if (lease && stage?.asset_id) this.db.prepare(`UPDATE _auth_avatar_assets
        SET state = 'retired', lease_token = NULL, lease_until = 0
        WHERE asset_id = ? AND state = 'pending' AND lease_token = ?
          AND NOT EXISTS (SELECT 1 FROM _auth_user_avatars WHERE asset_id = ?)`)
        .run(stage.asset_id, lease, stage.asset_id);
    });
  }
  claimCleanup(limit = 20): { stages: AvatarStageRow[]; assets: AvatarAssetRow[]; lease: string } {
    return this.users.transaction(() => {
      this.assertReady(); const lease = crypto.randomUUID(), now = this.now();
      const stages = this.db.prepare(`SELECT * FROM _auth_avatar_stages WHERE lease_until <= ?
        AND (expires_at <= ? OR state = 'retired') ORDER BY created_at LIMIT ?`).all(now, now, limit) as AvatarStageRow[];
      const assets = this.db.prepare(`SELECT a.* FROM _auth_avatar_assets a WHERE a.lease_until <= ?
        AND NOT EXISTS (SELECT 1 FROM _auth_user_avatars u WHERE u.asset_id = a.asset_id)
        ORDER BY a.created_at LIMIT ?`).all(now, limit) as AvatarAssetRow[];
      for (const stage of stages) this.db.prepare("UPDATE _auth_avatar_stages SET state = CASE WHEN state = 'consumed' THEN 'consumed' ELSE 'retired' END, lease_token = ?, lease_until = ? WHERE stage_id = ?").run(lease, now + 60_000, stage.stage_id);
      for (const asset of assets) this.db.prepare("UPDATE _auth_avatar_assets SET state = 'retired', lease_token = ?, lease_until = ? WHERE asset_id = ?").run(lease, now + 60_000, asset.asset_id);
      return { stages, assets, lease };
    });
  }
  finishStageCleanup(id: string, lease: string): void {
    this.db.prepare('DELETE FROM _auth_avatar_stages WHERE stage_id = ? AND lease_token = ?').run(id, lease);
  }
  finishAssetCleanup(id: string, lease: string): void {
    this.db.prepare(`DELETE FROM _auth_avatar_assets WHERE asset_id = ? AND state = 'retired' AND lease_token = ?
      AND NOT EXISTS (SELECT 1 FROM _auth_user_avatars WHERE asset_id = ?)`).run(id, lease, id);
  }
  private assertRevision(userId: string, expected: number): void {
    if (this.revision(userId) !== expected) throw new AuthError('Your profile changed. Review the current profile before saving.', 'AUTH_PROFILE_REVISION_CONFLICT', 409);
  }
  private admit(callback: () => void): void { invokeSynchronousAuthCallback(callback, {
    component: 'user-avatar-store', invariant: 'synchronous-authority', message: 'Avatar authority must be synchronous',
  }); }
}
export function retiredStage(): AuthError { return new AuthError('This avatar upload has expired or was already changed. Start a new upload.', 'AUTH_AVATAR_STAGE_RETIRED', 409); }
