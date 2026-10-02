/** Internal durable coordination schema shared by migration and runtime startup. */

import type { ReactiveDB } from '../sync/reactive-db';

type RuntimeSchemaDatabase = Pick<ReactiveDB, 'exec' | 'prepare'>;

export function ensureWorkflowRuntimeSchema(db: RuntimeSchemaDatabase): void {
  const deliveryTableCreated = !tablesExist(db, ['_workflow_event_delivery']);
  db.exec(`CREATE TABLE IF NOT EXISTS _workflow_event_delivery (
    event_id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL,
    event_name TEXT NOT NULL,
    claimed_by_step_id TEXT UNIQUE,
    claimed_at TEXT,
    actor_json TEXT,
    payload_bytes INTEGER NOT NULL DEFAULT 0,
    actor_bytes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`);
  const actorColumnAdded = ensureColumn(db, '_workflow_event_delivery', 'actor_json', 'TEXT');
  const payloadBytesAdded = ensureColumn(
    db, '_workflow_event_delivery', 'payload_bytes', 'INTEGER NOT NULL DEFAULT 0',
  );
  const actorBytesAdded = ensureColumn(
    db, '_workflow_event_delivery', 'actor_bytes', 'INTEGER NOT NULL DEFAULT 0',
  );
  if (deliveryTableCreated || actorColumnAdded || payloadBytesAdded || actorBytesAdded) {
    db.exec(`UPDATE _workflow_event_delivery
      SET payload_bytes = COALESCE((
        SELECT length(CAST(event.payload AS BLOB)) FROM workflow_events AS event
        WHERE event.event_id = _workflow_event_delivery.event_id
      ), 0),
      actor_bytes = COALESCE(length(CAST(actor_json AS BLOB)), 0)`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_event_delivery_pending
    ON _workflow_event_delivery(
      instance_id, event_name, claimed_by_step_id, created_at, event_id
    )`);
  const eventUsageTableCreated = !tablesExist(db, ['_workflow_event_usage']);
  db.exec(`CREATE TABLE IF NOT EXISTS _workflow_event_usage (
    instance_id TEXT PRIMARY KEY,
    total_count INTEGER NOT NULL DEFAULT 0,
    total_bytes INTEGER NOT NULL DEFAULT 0,
    queued_count INTEGER NOT NULL DEFAULT 0,
    queued_bytes INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 0
  )`);
  const revisionAdded = ensureColumn(
    db, '_workflow_event_usage', 'revision', 'INTEGER NOT NULL DEFAULT 0',
  );
  if (eventUsageTableCreated) {
    backfillEventUsage(db);
  } else if (revisionAdded) {
    db.exec(`UPDATE _workflow_event_usage SET revision = COALESCE((
      SELECT COUNT(*)
        + COALESCE(SUM(CASE WHEN delivery.claimed_by_step_id IS NOT NULL THEN 1 ELSE 0 END), 0)
        + COALESCE(SUM(CASE WHEN delivery.claimed_by_step_id LIKE 'consumed:%' THEN 1 ELSE 0 END), 0)
      FROM _workflow_event_delivery AS delivery
      WHERE delivery.instance_id = _workflow_event_usage.instance_id
    ), 0)`);
  }
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_event_delivery_identity_insert
    BEFORE INSERT ON _workflow_event_delivery
    WHEN NOT EXISTS (
      SELECT 1 FROM workflow_events AS event
      WHERE event.event_id = NEW.event_id
        AND event.instance_id = NEW.instance_id
        AND event.event_name = NEW.event_name
    )
    BEGIN
      SELECT RAISE(ABORT, 'workflow event delivery identity mismatch');
    END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_event_delivery_identity_update
    BEFORE UPDATE OF event_id, instance_id, event_name, claimed_by_step_id
      ON _workflow_event_delivery
    WHEN NOT EXISTS (
      SELECT 1 FROM workflow_events AS event
      WHERE event.event_id = NEW.event_id
        AND event.instance_id = NEW.instance_id
        AND event.event_name = NEW.event_name
    ) OR (
      NEW.claimed_by_step_id IS NOT NULL
      AND NEW.claimed_by_step_id NOT LIKE 'consumed:%'
      AND NOT EXISTS (
        SELECT 1 FROM workflow_steps AS step
        WHERE step.step_id = NEW.claimed_by_step_id
          AND step.instance_id = NEW.instance_id
          AND (step.wait_event IS NULL OR step.wait_event = NEW.event_name)
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'workflow event delivery claim mismatch');
    END`);
  db.exec(`CREATE TABLE IF NOT EXISTS _workflow_step_attempts (
    step_id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL,
    attempt_id TEXT NOT NULL UNIQUE,
    started_at TEXT NOT NULL
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_step_attempts_instance
    ON _workflow_step_attempts(instance_id)`);
  db.exec(`CREATE TABLE IF NOT EXISTS _workflow_pauses (
    instance_id TEXT PRIMARY KEY,
    paused_at TEXT NOT NULL
  )`);
  const runtimeUsageTableCreated = !tablesExist(db, ['_workflow_runtime_usage']);
  db.exec(`CREATE TABLE IF NOT EXISTS _workflow_runtime_usage (
    instance_id TEXT PRIMARY KEY,
    runtime_bytes INTEGER NOT NULL DEFAULT 0
  )`);
  if (runtimeUsageTableCreated && tablesExist(db, [
    'workflow_instances', 'workflow_steps', '_workflow_each_items', '_workflow_memory',
    'workflow_interactions', '_workflow_interaction_responses',
    '_workflow_interaction_details',
  ])) {
    db.exec(`INSERT OR IGNORE INTO _workflow_runtime_usage (instance_id, runtime_bytes)
      SELECT instance.instance_id,
        length(CAST(COALESCE(instance.input, '') AS BLOB))
          + length(CAST(COALESCE(instance.output, '') AS BLOB))
          + COALESCE((SELECT SUM(
            length(CAST(COALESCE(step.input, '') AS BLOB))
              + length(CAST(COALESCE(step.output, '') AS BLOB))
          ) FROM workflow_steps AS step WHERE step.instance_id = instance.instance_id), 0)
          + COALESCE((SELECT SUM(
            length(CAST(COALESCE(item.input_json, '') AS BLOB))
              + length(CAST(COALESCE(item.output_json, '') AS BLOB))
          ) FROM _workflow_each_items AS item WHERE item.instance_id = instance.instance_id), 0)
          + COALESCE((SELECT SUM(length(CAST(memory.value_json AS BLOB)))
            FROM _workflow_memory AS memory
            WHERE memory.instance_id = instance.instance_id), 0)
          + COALESCE((SELECT SUM(
            length(CAST(response.payload_json AS BLOB))
              + length(CAST(COALESCE(response.accepted_value_json, '') AS BLOB))
          ) FROM _workflow_interaction_responses AS response
            INNER JOIN workflow_interactions AS interaction
              ON interaction.interaction_id = response.interaction_id
            WHERE interaction.instance_id = instance.instance_id), 0)
          + COALESCE((SELECT SUM(
            length(CAST(COALESCE(detail.responder_policy_json, '') AS BLOB))
              + length(CAST(detail.response_schema_json AS BLOB))
              + length(CAST(COALESCE(detail.request_json, '') AS BLOB))
          ) FROM _workflow_interaction_details AS detail
            INNER JOIN workflow_interactions AS interaction
              ON interaction.interaction_id = detail.interaction_id
            WHERE interaction.instance_id = instance.instance_id), 0)
      FROM workflow_instances AS instance`);
  }
}

function backfillEventUsage(db: RuntimeSchemaDatabase): void {
  db.exec(`INSERT INTO _workflow_event_usage (
      instance_id, total_count, total_bytes, queued_count, queued_bytes, revision
    ) SELECT instance.instance_id,
      COUNT(delivery.event_id), COALESCE(SUM(delivery.payload_bytes + delivery.actor_bytes), 0),
      COALESCE(SUM(CASE WHEN delivery.event_id IS NOT NULL
        AND (delivery.claimed_by_step_id IS NULL
          OR delivery.claimed_by_step_id NOT LIKE 'consumed:%') THEN 1 ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN delivery.event_id IS NOT NULL
        AND (delivery.claimed_by_step_id IS NULL
          OR delivery.claimed_by_step_id NOT LIKE 'consumed:%')
        THEN delivery.payload_bytes + delivery.actor_bytes ELSE 0 END), 0),
      COUNT(delivery.event_id)
        + COALESCE(SUM(CASE WHEN delivery.claimed_by_step_id IS NOT NULL THEN 1 ELSE 0 END), 0)
        + COALESCE(SUM(CASE WHEN delivery.claimed_by_step_id LIKE 'consumed:%' THEN 1 ELSE 0 END), 0)
    FROM workflow_instances AS instance
    LEFT JOIN _workflow_event_delivery AS delivery
      ON delivery.instance_id = instance.instance_id
    GROUP BY instance.instance_id`);
}

function tablesExist(db: RuntimeSchemaDatabase, names: readonly string[]): boolean {
  const rows = db.prepare(`SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN (${names.map(() => '?').join(', ')})`)
    .all(...names) as Array<{ name: string }>;
  return rows.length === names.length;
}

function ensureColumn(
  db: RuntimeSchemaDatabase,
  table: string,
  column: string,
  definition: string,
): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    return true;
  }
  return false;
}
