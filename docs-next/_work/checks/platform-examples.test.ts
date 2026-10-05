/** Typechecks selected actual platform Markdown examples without executing app configuration. */

import { expect, test } from 'bun:test';
import ts from 'typescript';

const root = new URL('../../', import.meta.url);

async function blocks(page: string, language: 'ts' | 'tsx' = 'ts'): Promise<string[]> {
  const source = await Bun.file(new URL(page, root)).text();
  const pattern = new RegExp('^```' + language + '\\n([\\s\\S]*?)^```', 'gm');
  return [...source.matchAll(pattern)].map(match => match[1]!);
}

test('Schema, runtime and configuration Markdown examples use valid public source APIs', async () => {
  const fixtures = new Map<string, string>();
  const add = (name: string, source: string) => {
    fixtures.set(new URL(name, root).pathname, source);
  };
  const selected: Record<string, number[]> = {
    'backend/schema/tables.md': [0, 1],
    'backend/schema/natural-identity.md': [0, 1],
    'backend/runtime/endpoints.md': [0],
    'backend/runtime/routers.md': [0],
    'backend/runtime/middleware.md': [0],
    'backend/runtime/plugins.md': [0],
    'backend/runtime/server-services.md': [0],
    'backend/runtime/machine-services.md': [0],
    'backend/reactive-db/schema-admission.md': [0],
    'backend/reactive-db/transactions.md': [0],
    'backend/reactive-db/snapshots.md': [0],
    'backend/reactive-db/subscriptions.md': [0],
    'backend/reactive-db/conditional-writes.md': [0],
    'backend/reactive-db/scoped-operations.md': [0],
    'backend/reactive-db/natural-identity.md': [0],
    'backend/reactive-db/post-commit.md': [0],
    'backend/persistence/sqlite-service.md': [0],
    'backend/fabric/database-identities.md': [0],
    'backend/fabric/realms.md': [0],
    'backend/fabric/realm-composition.md': [0],
    'backend/fabric/operations.md': [0, 1],
    'backend/fabric/idempotency.md': [0],
    'backend/fabric/placement.md': [0],
    'backend/fabric/operations-diagnostics.md': [0],
    'backend/resources/definitions.md': [0, 1],
    'backend/resources/realms.md': [0],
    'backend/resources/policies.md': [0, 1],
    'backend/resources/guardian-integration.md': [0],
    'backend/resources/policy-composition.md': [0],
    'backend/resources/field-access.md': [0],
    'backend/migrations/declarations.md': [0],
    'backend/migrations/registries.md': [0],
    'backend/migrations/apply.md': [0],
    'backend/storage/permissions.md': [0],
    'backend/storage/upload-grants.md': [0],
    'backend/storage/studio-installation.md': [0],
    'backend/storage/studio-provisioning.md': [0],
    'backend/storage/studio-editing.md': [0],
    'backend/storage/client-integration.md': [0],
    'backend/data-studio/installation.md': [0, 1],
    'backend/data-studio/schemas.md': [0],
    'backend/data-studio/values.md': [0],
    'backend/data-studio/rows.md': [0],
    'backend/data-studio/queries.md': [0],
    'backend/sync/mutations.md': [0],
    'backend/sync/policies.md': [0],
    'backend/sync/clients.md': [0],
    'backend/vector/configuration.md': [0],
    'backend/vector/composition.md': [0],
    'backend/vector/records.md': [0],
    'backend/vector/queries.md': [0],
    'backend/vector/filters.md': [0],
    'backend/vector/scopes.md': [0],
    'backend/vector/deletes.md': [0],
    'backend/vector/ai-integration.md': [0],
  };
  for (const [page, indices] of Object.entries(selected)) {
    const examples = await blocks(page);
    for (const index of indices) {
      expect(examples[index], `${page}:${index}`).toBeDefined();
      add(`${page.replace('.md', '')}_${index}.example.ts`, examples[index]!);
    }
  }
  const organization = await Bun.file(new URL('guides/organization-assembly.md', root)).text();
  const modules = [...organization.matchAll(/^```(ts|tsx)\n\/\/ ([a-z][a-z0-9./-]+\.(?:ts|tsx))\n([\s\S]*?)^```/gm)];
  expect(modules).toHaveLength(12);
  for (const module of modules) {
    expect(module[3], module[2]).toBeDefined();
    add(`guides/__organization__/${module[2]}`, module[3]!);
  }
  const ownedDeclarations = await blocks('guides/user-owned-records.md');
  const ownedPage = await blocks('guides/user-owned-records.md', 'tsx');
  expect(ownedDeclarations[0]).toBeDefined();
  expect(ownedDeclarations[1]).toBeDefined();
  expect(ownedPage[0]).toBeDefined();
  add('guides/__user_owned__/db/schema.ts', ownedDeclarations[0]!);
  add('guides/__user_owned__/zero.config.ts', ownedDeclarations[1]!);
  add('guides/__user_owned__/app/notes/page.tsx', ownedPage[0]!);
  for (const page of ['descriptors', 'guardian-references']) {
    add(`backend/schema/${page}.example.ts`, (await blocks(`backend/schema/${page}.md`)).join('\n'));
  }
  const declaration = await blocks('backend/configuration/declaration.md');
  add('backend/configuration/zero.config.ts', declaration[0]!);
  add('backend/configuration/declaration.entry.ts', declaration[1]!);
  add('backend/zero.config.ts', declaration[0]!);
  add('backend/runtime/composition.entry.ts', (await blocks('backend/runtime/composition.md'))[0]!);
  for (const page of ['app-identity', 'routing', 'sitemap', 'diagnostics']) {
    const fragment = (await blocks(`backend/configuration/${page}.md`))[0]!;
    add(`backend/configuration/${page}.example.ts`,
      `import type { AppConfig } from '@zero/framework/server';\n`
      + `const config = { db: { mode: 'ephemeral' }, tables: {},\n${fragment}\n} satisfies AppConfig;\n`);
  }
  const realmExample = (await blocks('backend/fabric/realms.md'))[0]!;
  for (const page of ['actors', 'configuration']) {
    add(`backend/fabric/${page}.example.ts`, realmExample
      + '\nasync function startApplication(): Promise<void> {}\n'
      + (await blocks(`backend/fabric/${page}.md`))[0]!);
  }
  add('backend/fabric/consistency.example.ts',
    `import type { AsyncDatabaseClient } from '@zero/framework/server';\n`
    + `async function check(data: AsyncDatabaseClient, id: string, title: string, idempotencyKey: string) {\n`
    + (await blocks('backend/fabric/consistency.md'))[0]! + '\n}\n');
  const repo = new URL('../', root).pathname;
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
    strict: true, skipLibCheck: true, noEmit: true, types: ['bun'],
    paths: {
      '@zero/framework/server': [`${repo}src/frontend/server.ts`],
      '@zero/framework/schema': [`${repo}src/schema/index.ts`],
      '@zero/framework/sync/identity': [`${repo}src/sync/identity.ts`],
      '@zero/framework/sync': [`${repo}src/sync/index.ts`],
      '@zero/framework/sync/client': [`${repo}src/sync/client/index.ts`],
      '@zero/framework/persistence': [`${repo}src/persistence/index.ts`],
      '@zero/framework/resources': [`${repo}src/resources/index.ts`],
      '@zero/framework/migrations': [`${repo}src/migrations/index.ts`],
      '@zero/framework/storage': [`${repo}src/storage/index.ts`],
      '@zero/framework/data-studio': [`${repo}src/data-studio/index.ts`],
      '@zero/framework/data-studio/server': [`${repo}src/data-studio/server.ts`],
      '@zero/framework/vector': [`${repo}src/vector/index.ts`],
      '@zero/framework/ai': [`${repo}src/ai/index.ts`],
      '@zero/framework': [`${repo}src/frontend/index.ts`],
      '@zero/framework/react': [`${repo}src/frontend/index.ts`],
      '@zero/framework/components/auth': [`${repo}src/components/auth/index.ts`],
      '@zero/framework/components/storage': [`${repo}src/components/storage/index.ts`],
      '@zero/framework/components/ui/theme-provider': [`${repo}src/components/ui/theme-provider.tsx`],
      '@zero/framework/components/ui/sonner': [`${repo}src/components/ui/sonner.tsx`],
    },
  };
  const host = ts.createCompilerHost(options);
  const readSource = host.getSourceFile.bind(host);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const directoryExists = host.directoryExists?.bind(host);
  const virtualDirectories = new Set<string>();
  for (const filename of fixtures.keys()) {
    let parent = filename.slice(0, filename.lastIndexOf('/'));
    while (parent) {
      virtualDirectories.add(parent);
      parent = parent.slice(0, parent.lastIndexOf('/'));
    }
  }
  host.readFile = filename => fixtures.get(filename) ?? readFile(filename);
  host.fileExists = filename => fixtures.has(filename) || fileExists(filename);
  host.directoryExists = directory => virtualDirectories.has(directory) || (directoryExists?.(directory) ?? false);
  host.getSourceFile = (filename, version, onError, createNew) => fixtures.has(filename)
    ? ts.createSourceFile(filename, fixtures.get(filename)!, version, true,
      filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    : readSource(filename, version, onError, createNew);
  const program = ts.createProgram([...fixtures.keys()], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).map(diagnostic => {
    const line = diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1 : undefined;
    const file = diagnostic.file?.fileName.split('/').at(-1) ?? 'compiler';
    return `${file}${line ? `:${line}` : ''} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`;
  });
  expect(diagnostics).toEqual([]);
}, 30_000);
