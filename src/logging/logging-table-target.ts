/** Exact legacy-compatible target identity shared by capture and the display catalog. Never a SQL identifier. */
import { loggingDigest } from './logging-hash';
export function loggingTableTarget(table: string): string {
  const name = table.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return 'table.' + (name && name.length <= 110 ? name : loggingDigest(table));
}
