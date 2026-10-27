/** One pure copy manifest for native and installed-package publishing qualification. Importing it performs no setup. */
export const PUBLISHING_FIXTURE_FILES = [
  ['zero.config.ts', 'zero.config.ts'], ['logging-actor.ts', 'server/logging-actor.ts'], ['app/server.ts', 'app/server.ts'],
  ['audit-heartbeat.ts', 'audit-heartbeat.ts'], ['prepare.ts', 'prepare.ts'], ['qualify.ts', 'qualify.ts'],
] as const;
