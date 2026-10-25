/** Private system-artifact metadata. Never registered for Sync or exposed through drive/object HTTP APIs. */
export const STORAGE_PRIVATE_OBJECTS_DDL = `CREATE TABLE IF NOT EXISTS _storage_private_objects (
  namespace TEXT NOT NULL, id TEXT NOT NULL, checksum TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes>=0), mime_type TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY(namespace,id)
)`;
