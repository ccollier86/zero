/** Synthetic-only historical fixture, also exercised from the installed archive. */
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Migrator, migrations, hashMigration, type Migration, type LegacyStateMigrationInput } from '../index';

export const appMigration: Migration = {
  version: '2026072901', description: 'Synthetic clinical schema and retained custom history',
  up(db) { db.exec(`CREATE TABLE patients (
    patient_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    body BLOB, counter INTEGER
  ); CREATE TABLE notes (id TEXT PRIMARY KEY, patient_id TEXT REFERENCES patients(patient_id), text TEXT);`); },
};
export const syntheticPassword = 'Synthetic-only-password-123';
export const syntheticAction = 'synthetic-legacy-action-secret';
export const syntheticResume = 'synthetic-legacy-resume-secret';
export const syntheticRefresh = 'synthetic-legacy-refresh-secret';
export const digest = (value: string | Uint8Array) => new Bun.CryptoHasher('sha256').update(value).digest('hex');
export const fileSha256 = async (path: string) => digest(new Uint8Array(await Bun.file(path).arrayBuffer()));

export async function fixture() {
  const root = mkdtempSync(join(process.env.PROJECT_SCRATCH_DIR ?? tmpdir(), 'legacy-state-'));
  const sourcePath = join(root, 'source.db'), workingPath = join(root, 'working.db');
  const runner = new Migrator({ dbPath: workingPath, migrations: [...migrations.slice(0, 7), appMigration], backupDir: join(root, 'backups'), log() {} });
  try { runner.run(); } finally { runner.dispose(); }
  const db = new Database(workingPath, { strict: true });
  const passwordHash = await Bun.password.hash(syntheticPassword, { algorithm: 'bcrypt', cost: 4 });
  const steps = JSON.stringify([{ name: 'review', handler: 'review', waitFor: 'approved' }]);
  const created = new Date().toISOString();
  try {
    db.exec('PRAGMA foreign_keys=ON');
    db.query(`INSERT INTO users(user_id,username,email,role,status,created_at) VALUES (?,?,?,?,?,?)`).run('legacy-user', 'legacy-owner', 'legacy@example.test', 'admin', 'active', 100);
    db.query('INSERT INTO _credentials VALUES (?,?)').run('legacy-user', passwordHash);
    for (const id of ['legacy-staff', 'legacy-outsider']) {
      db.query('INSERT INTO users(user_id,username,email,role,status,created_at) VALUES (?,?,?,?,?,?)').run(id, id, `${id}@example.test`, 'user', 'active', 100);
      db.query('INSERT INTO _credentials VALUES (?,?)').run(id, passwordHash);
    }
    db.query('INSERT INTO user_properties VALUES (?,?,?)').run('legacy-user', 'practice_role', 'clinician');
    db.exec(`CREATE TABLE _auth_user_generations (
      user_id TEXT PRIMARY KEY, generation INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )`);
    db.query('INSERT INTO _auth_user_generations VALUES (?,?)').run('legacy-user', 2);
    db.query('INSERT INTO _refresh_tokens VALUES (?,?,?,?,?,?)').run('refresh-id', 'legacy-user', digest(syntheticRefresh), Date.now() + 1000000, 100, null);
    db.query('INSERT INTO _zero_action_tokens(token_id,purpose,token_hash,expires_at,created_at,metadata) VALUES (?,?,?,?,?,?)').run('action-id', 'clinical:review', digest(syntheticAction), Date.now() + 1000000, 100, '{"synthetic":true}');
    db.query('INSERT INTO _zero_resume_tokens(token_id,flow,token_hash,resource_type,resource_id,expires_at,created_at) VALUES (?,?,?,?,?,?,?)').run('resume-id', 'clinical:intake', digest(syntheticResume), 'assessment', 'legacy-assessment', Date.now() + 1000000, 100);
    db.query('INSERT INTO _zero_action_tokens(token_id,purpose,token_hash,expires_at,created_at,consumed_at) VALUES (?,?,?,?,?,?)').run('used-action', 'clinical:review', digest('used-action-secret'), Date.now() + 1000000, 100, 200);
    db.query('INSERT INTO _zero_resume_tokens(token_id,flow,token_hash,resource_type,resource_id,expires_at,created_at,revoked_at) VALUES (?,?,?,?,?,?,?,?)').run('revoked-resume', 'clinical:intake', digest('revoked-resume-secret'), 'assessment', 'legacy-assessment', Date.now() + 1000000, 100, 200);
    db.query('INSERT INTO patients VALUES (?,?,?,?)').run('legacy-patient', 'legacy-user', new Uint8Array([0, 255, 0]), 9007199254740993n);
    db.query('INSERT INTO notes VALUES (?,?,?)').run('legacy-note', 'legacy-patient', 'Synthetic retained text');
    db.exec('CREATE VIEW clinical_note_index AS SELECT notes.id,patients.owner_id FROM notes JOIN patients ON patients.patient_id=notes.patient_id');
    db.query('INSERT INTO storage_drives(drive_id,name,owner_id,created_at) VALUES (?,?,?,?)').run('legacy-drive', 'Documents', 'legacy-user', 100);
    db.query('INSERT INTO storage_objects(object_id,drive_id,name,path,type,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('legacy-object', 'legacy-drive', 'letter.pdf', '/letter.pdf', 'file', 100, 100);
    db.query('INSERT INTO _storage_permissions(permission_id,drive_id,grant_type,grant_value,permission,created_at) VALUES (?,?,?,?,?,?)').run('legacy-grant', 'legacy-drive', 'user', 'legacy-staff', 'read', 100);
    db.query('INSERT INTO workflow_definitions VALUES (?,?,?,?,?,?,?)').run('legacy-definition', 'clinical-followup', 1, steps, null, created, created);
    db.query('INSERT INTO workflow_instances(instance_id,definition_id,name,status,current_step,steps_json,started_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run('legacy-run', 'legacy-definition', 'clinical-followup', 'running', 0, steps, 'legacy-user', created, created);
    db.query('INSERT INTO workflow_steps(step_id,instance_id,step_index,step_name,status,wait_event,created_at) VALUES (?,?,?,?,?,?,?)').run('legacy-step', 'legacy-run', 0, 'review', 'waiting', 'approved', created);
    db.query('INSERT INTO workflow_events(event_id,instance_id,event_name,payload,sent_by,created_at) VALUES (?,?,?,?,?,?)').run('legacy-history', 'legacy-run', 'review-requested', '{"synthetic":true}', 'legacy-user', created);
    db.exec('CREATE TABLE _changes (seq INTEGER PRIMARY KEY, tbl TEXT, op TEXT, row_id TEXT, data TEXT, ts INTEGER)');
    db.query('INSERT INTO _changes VALUES (1,?,?,?,?,?)').run('users', 'insert', 'legacy-user', '{"synthetic":"private-old-projection"}', 100);
    // Model a consistent, consolidated backup including committed WAL pages.
    db.run('VACUUM INTO ?', [sourcePath]);
  } finally { db.close(); }
  const input: LegacyStateMigrationInput = { sourceFormat: 'zero-1.3-single-combined', offlineSource: true, sourcePath,
    sourceSha256: digest(new Uint8Array(await Bun.file(sourcePath).arrayBuffer())), applicationTables: ['patients', 'notes'],
    applicationMigrationChecksums: { [appMigration.version]: hashMigration(appMigration) } };
  return { root, sourcePath, input, passwordHash, dispose() { rmSync(root, { recursive: true, force: true }); } };
}
