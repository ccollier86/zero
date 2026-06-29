# User Store

SQLite operations for auth data. Prepared statements pattern from `src/persistence/sqlite-hot-store.ts` — all statements prepared once on construction, reused per call.

## SQLite Schema

### Public/Core Tables

```sql
-- Core user record — safe to broadcast (no sensitive fields)
CREATE TABLE IF NOT EXISTS users (
  user_id    TEXT PRIMARY KEY,
  username   TEXT UNIQUE NOT NULL,
  email      TEXT UNIQUE NOT NULL,
  first_name TEXT,
  last_name  TEXT,
  role       TEXT NOT NULL DEFAULT 'user',
  status     TEXT NOT NULL DEFAULT 'active',
  password_change_required INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Extensible public/user metadata projection per user
CREATE TABLE IF NOT EXISTS user_properties (
  user_id  TEXT NOT NULL,
  key      TEXT NOT NULL,
  value    TEXT,
  PRIMARY KEY (user_id, key),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
```

### Internal Tables (`_` prefix — never broadcast, never subscribable)

```sql
-- Password hashes — isolated from the public users table
CREATE TABLE IF NOT EXISTS _credentials (
  user_id       TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Refresh tokens — hashed, revocable
CREATE TABLE IF NOT EXISTS _refresh_tokens (
  token_id    TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  token_hash  TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  revoked_at  INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON _refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON _refresh_tokens(user_id);

-- Legacy one-time setup/reset tokens — retained for old outstanding links.
-- New auth reset/setup links use _zero_action_tokens via PlatformTokenService.
CREATE TABLE IF NOT EXISTS _auth_action_tokens (...);

-- Signing keypair + auth configuration
CREATE TABLE IF NOT EXISTS _auth_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

### Schema Design Decisions

**Why `user_id TEXT` not `INTEGER`:** Consistent with the rest of the codebase — session IDs, document IDs, and all primary keys in the sync engine use text UUIDs. Generated via `crypto.randomUUID()`.

**Why separate `_credentials`:** The `users` table is broadcast to subscribed clients via the sync engine. Keeping `password_hash` in a separate internal (`_` prefix) table means the public `users` table is structurally safe — no field stripping needed, no risk of accidental exposure.

**Why `user_properties` KV:** Avoids schema migrations when adding safe user
metadata such as notification preferences, theme, timezone, and display
preferences. This table is the public/user-writable projection of user
metadata, not the source of truth for permissions, tenancy, or other
authorization decisions. Because it uses a composite primary key, current
writes use prepared statements directly and do not emit ReactiveDB change
events.

**Why `_refresh_tokens` stores hashes:** Same principle as passwords — if the database is compromised, raw tokens are not exposed. `SHA-256(token)` is stored; the raw token exists only on the client side.

**Why action token tables store hashes:** Setup/reset links and app action
links are bearer credentials. Zero generates opaque random tokens, stores only
`SHA-256(token)`, and consumes the action token once the action succeeds. New
auth links are stored in `_zero_action_tokens`; `_auth_action_tokens` remains a
legacy compatibility table for previously issued auth links.

## Prepared Statements

All statements prepared in the constructor, stored in a map, reused per call:

```ts
class UserStore {
  private stmts: {
    // Users (public table — go through ReactiveDB for reactivity)
    getUserById: Statement;
    getUserByUsername: Statement;
    getUserByEmail: Statement;
    listUsers: Statement;

    // Credentials (internal table — direct db.exec, no reactivity needed)
    insertCredential: Statement;
    getCredential: Statement;
    updateCredential: Statement;

    // Properties (public metadata projection — direct SQL because composite PK)
    setProperty: Statement;
    getProperty: Statement;
    getProperties: Statement;
    deleteProperty: Statement;

    // Refresh tokens (internal table — direct db.exec)
    insertRefreshToken: Statement;
    getRefreshTokenByHash: Statement;
    revokeRefreshToken: Statement;
    revokeAllUserTokens: Statement;
    deleteExpiredTokens: Statement;

    // Action tokens (internal table — direct db.exec)
    insertActionToken: Statement;
    getActionTokenByHash: Statement;
    consumeActionToken: Statement;
    deleteExpiredActionTokens: Statement;

    // Auth config (internal table — direct db.exec)
    getConfig: Statement;
    setConfig: Statement;
  };

  constructor(db: ReactiveDB) {
    // Prepare all statements once
    this.stmts = {
      getUserById: db.prepare('SELECT * FROM users WHERE user_id = ?'),
      getUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
      // ... all others
    };
  }
}
```

**Why two paths:**
- Public `users` table writes go through `db.insert()` / `db.update()` /
  `db.delete()` so ReactiveDB emits change events and the sync engine can
  broadcast them.
- `user_properties` writes use prepared statements because the table has a
  composite primary key. They are not a trusted authorization source and do not
  currently emit ReactiveDB broadcasts.
- Internal tables (`_credentials`, `_refresh_tokens`, `_auth_config`) — writes use prepared statements directly (`stmt.run(...)`) since these tables should never broadcast.

## Operations

When the user domain is already obvious from context, app-owned backend code
can use the Phase 4 aliases:

| Canonical | Explicit compatibility method |
| --- | --- |
| `create(params)` | `createUser(params)` |
| `get(userId)` | `getUserById(userId)` |
| `list(options?)` | `listUsers(options?)` |
| `update(userId, partial)` | `updateUser(userId, partial)` |
| `delete(userId)` | `deleteUser(userId)` |

### createUser

```ts
async createUser(params: {
  username: string;
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  status?: 'active' | 'suspended';
  passwordChangeRequired?: boolean;
  properties?: Record<string, string>;
}): Promise<UserRecord>
```

**Steps:**
1. Generate `userId` via `crypto.randomUUID()` (prefixed: `u_${uuid}`)
2. Hash password: `await Bun.password.hash(params.password)` (Argon2id, automatic)
3. Wrap in `db.transaction()`:
   - `db.insert('users', { user_id, username, email, first_name, last_name, role, created_at })` — emits change, broadcast
   - lifecycle fields default to `status = 'active'` and `password_change_required = 0` unless provided
   - `this.stmts.insertCredential.run(user_id, passwordHash)` — internal, no broadcast
   - configured initial properties are inserted into `user_properties` when provided
4. Return `UserRecord` (no password_hash)

**Transaction ensures atomicity** — if credential insert fails, the user row is rolled back. Since this runs inside `db.transaction()`, the `users` change event is deferred until commit (see [ReactiveDB transactions](../realtime-sync/reactive-db.md#transactions)).

### getUserById / getUserByUsername / getUserByEmail

```ts
getUserById(userId: string): UserRecord | null
getUserByUsername(username: string): UserRecord | null
getUserByEmail(email: string): UserRecord | null
```

Pure reads — no change emission. Returns the user row joined with properties:

```ts
getUserById(userId: string): UserRecord | null {
  const row = this.stmts.getUserById.get(userId);
  if (!row) return null;

  const props = this.stmts.getProperties.all(userId);
  return {
    ...row,
    properties: Object.fromEntries(props.map(p => [p.key, p.value])),
  } as UserRecord;
}
```

### listUsers / countUsers / countUsersByRole

```ts
listUsers(): UserRecord[]
countUsers(): number
countUsersByRole(role: string): number
```

`listUsers()` returns newest users first with joined properties. Count helpers
are used by first-user bootstrap and last-admin safety checks.

### updateUser

```ts
updateUser(userId: string, partial: Partial<{
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: 'active' | 'suspended';
  passwordChangeRequired: boolean;
}>): UserRecord | null
```

Uses `db.update('users', userId, { ...mapped, updated_at: Date.now() })`. The ReactiveDB `update()` method reads the current row, merges the partial, writes the full row, and emits a change event. The sync engine broadcasts the updated row to all subscribers.

### deleteUser

```ts
deleteUser(userId: string): boolean
```

Uses `db.delete('users', userId)`. SQLite `ON DELETE CASCADE` removes
`_credentials`, `user_properties`, `_refresh_tokens`, and
`_auth_action_tokens` rows automatically. The `db.delete()` call emits a
change event for the `users` table — subscribers see the user disappear.

### verifyPassword

```ts
async verifyPassword(userId: string, password: string): Promise<boolean>
```

```ts
async verifyPassword(userId: string, password: string): Promise<boolean> {
  const cred = this.stmts.getCredential.get(userId);
  if (!cred) return false;
  return Bun.password.verify(password, cred.password_hash);
}
```

`Bun.password.verify()` handles Argon2id verification automatically — detects the algorithm from the hash prefix. Returns `true`/`false`, never throws for wrong passwords.

### updatePassword

```ts
async updatePassword(userId: string, currentPassword: string, newPassword: string): Promise<boolean>
```

**Steps:**
1. Verify current password via `verifyPassword()`
2. If valid: `await Bun.password.hash(newPassword)`, `this.stmts.updateCredential.run(newHash, userId)`
3. Revoke all refresh tokens for user (force re-login on all devices)
4. Return success boolean

### resetPassword

```ts
async resetPassword(userId: string, newPassword: string): Promise<boolean>
```

Admin reset flow. It does not require the current password, but it does verify
the user exists. On success it hashes the new password and revokes all refresh
tokens so existing sessions must re-authenticate.

### Properties KV

```ts
setProperty(userId: string, key: string, value: string): void
setProperties(userId: string, properties: Record<string, string>): void
getProperty(userId: string, key: string): string | null
getProperties(userId: string): Record<string, string>
deleteProperty(userId: string, key: string): void
```

`setProperty` uses a prepared `INSERT OR REPLACE` statement. `deleteProperty`
uses a prepared `DELETE` statement. These methods are low-level store methods;
HTTP routes should enforce configured metadata policy before calling them.
`setProperties` wraps multiple property upserts in one transaction.

`createUser()` also accepts an optional `properties` map so registration and
admin creation can store configured defaults atomically with the user and
credential rows.

**Use cases:**
- Notification preferences: `setProperty(userId, 'notifications_enabled', 'true')`
- Theme: `setProperty(userId, 'theme', 'dark')`
- Timezone: `setProperty(userId, 'timezone', 'America/New_York')`
- Safe app preferences that do not grant access

Reserved system keys such as `groups`, `permissions`, `tenantId`,
`tenantIds`, `clearance`, and storage-backed `avatarFileId` should be written
through dedicated admin/system routes, not the generic current-user properties
route.

### Refresh Token Operations

```ts
storeRefreshToken(tokenId: string, userId: string, tokenHash: string, expiresAt: number): void
getRefreshTokenByHash(tokenHash: string): RefreshTokenRecord | null
revokeRefreshToken(tokenId: string): void
revokeAllUserTokens(userId: string): void
deleteExpiredTokens(): number
```

All operate on `_refresh_tokens` (internal table) — use prepared statements directly, no ReactiveDB change emission.

**`getRefreshTokenByHash` returns ALL matching rows, including revoked tokens.** The query is `SELECT * FROM _refresh_tokens WHERE token_hash = ?` with no `WHERE revoked_at IS NULL` filter. Callers (TokenService) check `revoked_at` and `expires_at` in application code after the query returns. This is deliberate — replay detection needs to see revoked tokens. If a revoked token is reused, TokenService revokes ALL tokens for that user (family rotation). Filtering out revoked rows at the SQL level would make replay attacks invisible.

```ts
getRefreshTokenByHash(tokenHash: string): RefreshTokenRecord | null {
  // Returns the token record even if revoked — caller handles revocation logic
  const row = this.stmts.getRefreshTokenByHash.get(tokenHash);
  if (!row) return null;
  return {
    tokenId: row.token_id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,  // may be non-null — caller checks
  } as RefreshTokenRecord;
}
```

### legacy auth action tokens

```ts
storeActionToken(params): AuthActionTokenRecord
getActionTokenByHash(tokenHash: string): AuthActionTokenRecord | null
consumeActionToken(tokenId: string): boolean
countRecentActionTokens(params): number
deleteExpiredActionTokens(): number
```

These methods operate on `_auth_action_tokens` for legacy compatibility and
never store raw reset/setup tokens. Current reset/setup flows use
`PlatformTokenService` and `_zero_action_tokens`; `AuthActionTokenService`
wraps the platform service while falling back to this legacy table for old
outstanding links.

`deleteExpiredTokens()` is a cleanup operation — called periodically (cron or on refresh) to purge expired/revoked tokens:

```ts
deleteExpiredTokens(): number {
  const result = this.stmts.deleteExpiredTokens.run(Date.now());
  return result.changes;  // Number of deleted rows
}
```

### Auth Config Operations

```ts
getConfig(key: string): string | null
setConfig(key: string, value: string): void
```

Used by TokenService to persist the signing keypair:

```ts
// Store keypair on first start
setConfig('signing_key_private', JSON.stringify(jwk));
setConfig('signing_key_id', keyId);

// Load on subsequent starts
const jwk = JSON.parse(getConfig('signing_key_private')!);
```

## Password Hashing

### Bun.password

Bun provides native password hashing — no external dependency:

```ts
// Hash (async — CPU-intensive, doesn't block event loop)
const hash = await Bun.password.hash('s3cret!');
// → "$argon2id$v=19$m=65536,t=2,p=1$..."

// Verify (async)
const valid = await Bun.password.verify('s3cret!', hash);
// → true/false
```

**Defaults (Argon2id):**
- Memory: 64 MB (`m=65536`)
- Iterations: 2 (`t=2`)
- Parallelism: 1 (`p=1`)

These are OWASP-recommended defaults. Argon2id is resistant to both side-channel and GPU attacks. The hash includes the algorithm, version, and parameters — verification is self-describing.

**Why `Bun.password` and not bcrypt/scrypt:**
- Native to Bun — zero dependencies
- Argon2id is the OWASP first choice for password hashing (2024 guidelines)
- Memory-hard — resistant to GPU/ASIC attacks unlike bcrypt
- Async — hashing doesn't block the Bun event loop

## Reactivity

### What broadcasts

| Table | Broadcasts | Why |
|-------|-----------|-----|
| `users` | Yes | Profile data (name, email, role) is safe and useful for real-time UIs |
| `user_properties` | No, not currently | Composite-key public/user metadata projection written through prepared statements |
| `_credentials` | No | Password hashes are sensitive — `_` prefix prevents broadcast |
| `_refresh_tokens` | No | Token hashes are sensitive — `_` prefix prevents broadcast |
| `_auth_config` | No | Signing keys are sensitive — `_` prefix prevents broadcast |
| audit tables | Planned optional feature | User activity audit is deferred and separate from default observability |

### Example: role change

```ts
// Admin changes user role via HTTP route
authStore.updateUser(userId, { role: 'admin' });
```

What happens:

1. `UserStore.updateUser()` calls `db.update('users', userId, { role: 'admin', updated_at: Date.now() })`
2. ReactiveDB writes the row, increments `seq`, emits change event
3. Sync plugin's `onChange` listener: `server.publish('sync:users', changeJSON)`
4. Every client subscribed to `sync:users` receives the change
5. Client-side `useRow('users', userId)` re-renders with the new role

No manual notification. No event emission. No WebSocket message crafting. The existing sync path handles it.

## Key Types

```ts
interface UserRecord {
  userId: string;
  username: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  status: 'active' | 'suspended';
  passwordChangeRequired: boolean;
  createdAt: number;
  updatedAt: number | null;
  properties: Record<string, string>;
}

interface RefreshTokenRecord {
  tokenId: string;
  userId: string;
  tokenHash: string;
  expiresAt: number;
  createdAt: number;
  revokedAt: number | null;
}

interface AuthActionTokenRecord {
  tokenId: string;
  userId: string;
  type: 'account_setup' | 'password_reset' | 'admin_password_reset' | 'email_verification';
  tokenHash: string;
  expiresAt: number;
  consumedAt: number | null;
  createdAt: number;
  createdBy: string | null;
  metadata: Record<string, unknown>;
}
```

**Column name mapping:** SQLite uses `snake_case` (`user_id`, `first_name`). TypeScript uses `camelCase` (`userId`, `firstName`). The UserStore maps between them in read methods. Write methods accept the TypeScript shape and map to SQL columns internally.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Duplicate username | SQLite UNIQUE constraint error → catch, throw `AppError('Username taken', 'DUPLICATE_USERNAME', 409)` |
| Duplicate email | SQLite UNIQUE constraint error → catch, throw `AppError('Email taken', 'DUPLICATE_EMAIL', 409)` |
| User not found (read) | Returns `null` — caller decides if this is an error |
| User not found (update/delete) | Returns `null`/`false` — no change emitted |
| Invalid password (verify) | Returns `false` — caller decides the error message |
| Expired refresh token | `getRefreshTokenByHash()` returns the record; TokenService checks `expires_at` in code and returns `null` if expired |
| Revoked refresh token | `getRefreshTokenByHash()` returns the record even if revoked; TokenService checks `revoked_at` in code — if non-null, revokes ALL tokens for that user (replay detection) |
| Foreign key violation | SQLite enforces — attempting to insert a credential for non-existent user throws |
| Database disposed | ReactiveDB throws `Error('ReactiveDB is disposed')` — same as all other operations |
