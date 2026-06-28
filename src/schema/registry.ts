import type { Row } from '../sync/types';

// ─── Register Pattern ───────────────────────────────────────────────────────

/**
 * Global type registry for the platform SDK.
 *
 * Apps augment this interface via `declare module` to register their
 * table types. Once registered, hooks like `useCollection()` and
 * `useQuery()` automatically infer the correct row type from the
 * table name — no manual generics needed.
 *
 * @example
 * ```ts
 * // In your app's schema file:
 * export interface Tables {
 *   todos: { id: string; title: string; done: number };
 *   users: { id: string; name: string; email: string };
 * }
 *
 * declare module '@platform/frontend' {
 *   interface Register {
 *     tables: Tables;
 *   }
 * }
 * ```
 */
export interface Register {}

/**
 * Resolve registered table names.
 * Falls back to `string` if no schema has been registered.
 */
export type TableNames = Register extends { tables: infer T }
  ? Extract<keyof T, string>
  : string;

/**
 * Resolve the row type for a given table name.
 * Falls back to `Row` (Record<string, unknown>) if no schema is registered
 * or if the table name is not in the registry.
 */
export type TableRow<K extends string> = Register extends { tables: infer T }
  ? K extends keyof T
    ? T[K] & Row
    : Row
  : Row;
