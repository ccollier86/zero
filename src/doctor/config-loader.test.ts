import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadDoctorConfig } from './config-loader';

describe('doctor config loader resources', () => {
  test('loads conventional server resources relative to a config/ project root', async () => {
    const base = join(process.cwd(), '.zero');
    await mkdir(base, { recursive: true });
    const root = await mkdtemp(join(base, 'doctor-resources-'));
    const configDir = join(root, 'config');
    const resourcesDir = join(root, 'server', 'resources');
    const resourceImport = pathToFileURL(
      join(process.cwd(), 'src', 'resources', 'index.ts'),
    ).href;

    try {
      await mkdir(configDir, { recursive: true });
      await mkdir(resourcesDir, { recursive: true });
      await writeFile(join(configDir, 'zero.config.ts'), `
        export default {
          db: { mode: 'memory' },
          tables: {
            documents: {
              id: 'text primary key',
              tenant_id: 'text not null',
              title: 'text not null',
            },
          },
        };
      `);
      await writeFile(join(resourcesDir, 'documents.ts'), `
        import {
          authenticatedOnly,
          defineResource,
          tenantRealm,
        } from '${resourceImport}';
        export default defineResource({
          table: 'documents',
          realm: tenantRealm(),
          policy: authenticatedOnly(),
        });
      `);

      const config = await loadDoctorConfig(join(configDir, 'zero.config.ts'));
      expect(config.resources).toHaveLength(1);
      expect(config.resources?.[0]).toMatchObject({
        table: 'documents',
        realm: { kind: 'tenant', field: 'tenant_id' },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('does not discover resources when the config disables the directory', async () => {
    const base = join(process.cwd(), '.zero');
    await mkdir(base, { recursive: true });
    const root = await mkdtemp(join(base, 'doctor-resources-disabled-'));
    const configPath = join(root, 'zero.config.ts');

    try {
      await writeFile(configPath, `
        export default {
          db: { mode: 'memory' },
          tables: {},
          serverResourcesDir: false,
        };
      `);
      const config = await loadDoctorConfig(configPath);
      expect(config.resources).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
