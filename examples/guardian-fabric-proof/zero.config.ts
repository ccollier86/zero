/** Environment adapter for the pure Guardian + Fabric + Torrent proof configuration. */

import { createGuardianFabricProofConfig } from './server/proof-config';

const port = readPort(Bun.env.PORT);
const publicUrl = readEnv('APP_PUBLIC_URL') ?? `http://localhost:${port}`;

export const config = createGuardianFabricProofConfig({
  port,
  publicUrl,
  bootstrap: {
    mode: 'secret',
    secret: readEnv('AUTH_BOOTSTRAP_SECRET'),
  },
});

export default config;

function readEnv(name: string): string | undefined {
  const value = Bun.env[name]?.trim();
  return value ? value : undefined;
}

function readPort(value: string | undefined): number {
  const parsed = Number(value ?? 3100);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`PORT must be an integer from 1 through 65535; received ${JSON.stringify(value)}.`);
  }
  return parsed;
}
