/** Frozen v2.7.0 schema/migration/name contract for disposable retained-upgrade tests, never application bootstrap. */
import { defineDatabaseRealm } from '../../databases/database-realm';
import { LOGGING_TABLES } from '../logging-schema';
import { loggingRealm } from '../logging-realm';

// Existing implementations operate on synthetic v1 envelopes. The golden
// fingerprint test ensures this declaration cannot silently adopt newer names,
// tables, migrations or a different former release identity.
export const loggingV6Realm = defineDatabaseRealm({
  name: 'zero-logging', version: '6', tables: LOGGING_TABLES,
  migrations: loggingRealm.migrations.slice(0, 5),
  commands: Object.fromEntries(['logging.append', 'logging.hold', 'logging.review', 'logging.prune', 'logging.export.reserve', 'logging.export.transition', 'logging.checkpoint.append']
    .map(name => [name, loggingRealm.commands[name as keyof typeof loggingRealm.commands]])),
  queries: Object.fromEntries(['logging.page', 'logging.changes', 'logging.verify', 'logging.prune-candidates', 'logging.evidence', 'logging.export', 'logging.exports.pending', 'logging.checkpoint.read']
    .map(name => [name, loggingRealm.queries[name as keyof typeof loggingRealm.queries]])),
});
