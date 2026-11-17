/** Additive 002 guards. Never rebuild or reinterpret retained 001 evidence. */
import type { Migration } from '../migrations/migrator';

export function migrateCalendarScheduling(database: Parameters<Migration['up']>[0]): void {
  for (const sql of [
    'CREATE UNIQUE INDEX calendar_availability_history_identity ON _calendar_availability_history(scope_id,resource_id,policy_revision)',
    'CREATE UNIQUE INDEX calendar_availability_identity ON _calendar_availability(scope_id,resource_id)',
    'CREATE INDEX calendar_block_range ON calendar_blocks(scope_id,status,start_ms,id)',
    'CREATE UNIQUE INDEX calendar_block_reservation_identity ON _calendar_block_reservations(scope_id,block_id,resource_id)',
    'CREATE INDEX calendar_block_reservation_overlap ON _calendar_block_reservations(scope_id,resource_id,active,occupied_start_ms,occupied_end_ms,block_id)',
    'CREATE UNIQUE INDEX calendar_block_receipt_identity ON _calendar_block_receipts(scope_id,principal,request_id)',
    'CREATE INDEX calendar_block_effect_source ON _calendar_block_effect_intents(scope_id,target_kind,target_id,revision)',
  ]) database.run(sql);

  const immutable = ['_calendar_availability_history', '_calendar_block_receipts', '_calendar_block_effect_intents'];
  const tables = [...immutable, '_calendar_availability', 'calendar_blocks', '_calendar_block_reservations'];
  for (const table of tables) {
    const duplicate = 'id=NEW.id' + (table === '_calendar_availability_history' ? ' OR (scope_id=NEW.scope_id AND resource_id=NEW.resource_id AND policy_revision=NEW.policy_revision)'
      : table === '_calendar_availability' ? ' OR (scope_id=NEW.scope_id AND resource_id=NEW.resource_id)'
      : table === '_calendar_block_receipts' ? ' OR (scope_id=NEW.scope_id AND principal=NEW.principal AND request_id=NEW.request_id)'
      : table === '_calendar_block_reservations' ? ' OR (scope_id=NEW.scope_id AND block_id=NEW.block_id AND resource_id=NEW.resource_id)' : '');
    // A BEFORE INSERT guard also blocks replacement when recursive_triggers is off.
    database.run(`CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE ${duplicate}) BEGIN SELECT RAISE(ABORT,'Private calendar identity cannot be replaced'); END`);
    database.run(`CREATE TRIGGER ${table}_scope BEFORE INSERT ON ${table} WHEN NOT EXISTS(SELECT 1 FROM _calendar_owner WHERE id='application' AND scope_id=NEW.scope_id) BEGIN SELECT RAISE(ABORT,'Private calendar scope is inconsistent'); END`);
    database.run(`CREATE TRIGGER ${table}_identity BEFORE UPDATE OF id,scope_id ON ${table} WHEN OLD.id IS NOT NEW.id OR OLD.scope_id IS NOT NEW.scope_id BEGIN SELECT RAISE(ABORT,'Private calendar identity is immutable'); END`);
    if (immutable.includes(table)) {
      for (const operation of ['UPDATE', 'DELETE']) database.run(`CREATE TRIGGER ${table}_${operation.toLowerCase()} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'Private calendar evidence is immutable'); END`);
    } else database.run(`CREATE TRIGGER ${table}_retain BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Private calendar history must be retained'); END`);
  }

  // All commands share one stable request namespace, including across the 001/002 stores.
  for (const [table, other] of [['_calendar_receipts', '_calendar_block_receipts'], ['_calendar_block_receipts', '_calendar_receipts']]) {
    database.run(`CREATE TRIGGER ${table}_cross_identity BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${other} WHERE id=NEW.id OR (scope_id=NEW.scope_id AND principal=NEW.principal AND request_id=NEW.request_id)) BEGIN SELECT RAISE(ABORT,'Private calendar request identity cannot be reused'); END`);
  }

  for (const table of ['_calendar_availability_history', '_calendar_availability', '_calendar_block_reservations']) {
    database.run(`CREATE TRIGGER ${table}_resource BEFORE INSERT ON ${table} WHEN NOT EXISTS(SELECT 1 FROM calendar_resources WHERE id=NEW.resource_id AND scope_id=NEW.scope_id) BEGIN SELECT RAISE(ABORT,'Private calendar resource is inconsistent'); END`);
    database.run(`CREATE TRIGGER ${table}_resource_identity BEFORE UPDATE OF resource_id ON ${table} WHEN OLD.resource_id IS NOT NEW.resource_id BEGIN SELECT RAISE(ABORT,'Private calendar resource identity is immutable'); END`);
  }
  // Policy changes first advance the shared resource revision, then append history,
  // then move this pointer. Grant changes may create legitimate revision gaps.
  database.run(`CREATE TRIGGER calendar_availability_history_revision BEFORE INSERT ON _calendar_availability_history WHEN NOT EXISTS(SELECT 1 FROM calendar_resources WHERE id=NEW.resource_id AND scope_id=NEW.scope_id AND revision=NEW.policy_revision) BEGIN SELECT RAISE(ABORT,'Private availability revision is inconsistent'); END`);
  for (const operation of ['INSERT', 'UPDATE']) database.run(`CREATE TRIGGER calendar_availability_parent_${operation.toLowerCase()} BEFORE ${operation} ON _calendar_availability WHEN NOT EXISTS(SELECT 1 FROM _calendar_availability_history WHERE scope_id=NEW.scope_id AND resource_id=NEW.resource_id AND policy_revision=NEW.policy_revision) BEGIN SELECT RAISE(ABORT,'Private availability history is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_availability_revision BEFORE UPDATE ON _calendar_availability WHEN NEW.policy_revision<=OLD.policy_revision BEGIN SELECT RAISE(ABORT,'Private availability revision must advance'); END`);

  for (const operation of ['INSERT', 'UPDATE']) database.run(`CREATE TRIGGER calendar_block_reservation_parent_${operation.toLowerCase()} BEFORE ${operation} ON _calendar_block_reservations WHEN NOT EXISTS(SELECT 1 FROM calendar_blocks WHERE id=NEW.block_id AND scope_id=NEW.scope_id AND start_ms=NEW.occupied_start_ms AND end_ms=NEW.occupied_end_ms AND (status='active')=NEW.active) BEGIN SELECT RAISE(ABORT,'Private calendar block reservation is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_block_reservation_identity BEFORE UPDATE OF block_id ON _calendar_block_reservations WHEN OLD.block_id IS NOT NEW.block_id BEGIN SELECT RAISE(ABORT,'Private block reservation identity is immutable'); END`);
  database.run(`CREATE TRIGGER calendar_block_revision BEFORE UPDATE ON calendar_blocks WHEN NEW.revision<>OLD.revision+1 OR OLD.created_by IS NOT NEW.created_by OR OLD.status='cancelled' BEGIN SELECT RAISE(ABORT,'Private block revision is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_block_receipt_parent BEFORE INSERT ON _calendar_block_receipts WHEN NOT EXISTS(SELECT 1 FROM calendar_blocks WHERE id=NEW.target_id AND scope_id=NEW.scope_id) BEGIN SELECT RAISE(ABORT,'Private calendar block is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_block_effect_parent BEFORE INSERT ON _calendar_block_effect_intents WHEN NOT EXISTS(SELECT 1 FROM _calendar_block_receipts WHERE id=NEW.receipt_id AND scope_id=NEW.scope_id AND target_kind=NEW.target_kind AND target_id=NEW.target_id) BEGIN SELECT RAISE(ABORT,'Private calendar receipt is inconsistent'); END`);
}
