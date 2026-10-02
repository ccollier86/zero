/**
 * copy.test.ts
 *
 * Verifies the source-copy engine behind `zero add`. These tests focus on
 * generated file layout, import rewriting, and package-mode buildability.
 */

import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import { addZeroSource } from './copy';

async function createTempApp(): Promise<string> {
  const baseDir = join(process.cwd(), '.zero');
  await mkdir(baseDir, { recursive: true });
  const targetDir = await mkdtemp(join(baseDir, 'test-zero-add-'));
  await writeTestTsConfig(targetDir);
  await linkFrameworkPackage(targetDir);
  return targetDir;
}

describe('addZeroSource', () => {
  test('copies an individual UI primitive with alias dependencies', async () => {
    const targetDir = await createTempApp();

    try {
      const result = await addZeroSource({
        targetDir,
        items: ['components/ui/button'],
      });

      expect(result.filesWritten).toContain('components/ui/button.tsx');
      expect(result.filesWritten).toContain('lib/utils.ts');
      expect(result.filesPlanned).not.toContain('components/ui/button.test.tsx');

      const button = await readFile(join(targetDir, 'components/ui/button.tsx'), 'utf8');
      expect(button).toMatch(/from ['"]@\/lib\/utils['"]/);

      const second = await addZeroSource({
        targetDir,
        items: ['components/ui/button'],
      });
      expect(second.filesSkipped).toContain('components/ui/button.tsx');
    } finally {
      await rm(targetDir, { recursive: true, force: true });
    }
  });

  test('copies data table source with public framework import rewrites', async () => {
    const targetDir = await createTempApp();

    try {
      const result = await addZeroSource({
        targetDir,
        items: ['components/data-table'],
      });

      expect(result.filesWritten).toContain('components/data-table/data-table.tsx');
      expect(result.filesWritten).toContain('components/data-table/data-table-search.tsx');
      expect(result.filesWritten).toContain('components/data-table/data-table-column-filter.tsx');
      expect(result.filesWritten).toContain('components/data-table/data-table-export.ts');
      expect(result.filesWritten).toContain('components/data-table/row-identity.ts');
      expect(result.filesWritten).toContain('components/ui/table.tsx');
      expect(result.filesWritten).toContain('components/animate-ui/components/radix/checkbox.tsx');
      expect(result.filesWritten).toContain('components/animate-ui/icons/search.tsx');
      expect(result.rewrites.length).toBeGreaterThan(0);

      const rowIdentity = await readFile(join(targetDir, 'components/data-table/row-identity.ts'), 'utf8');
      expect(rowIdentity).toContain("from '@zero/framework/schema'");
      expect(rowIdentity).toContain("from '@zero/framework/sync/types'");
      expect(rowIdentity).toContain("from '@zero/framework/sync/identity'");

      await writeFile(
        join(targetDir, 'entry.tsx'),
        [
          "import { DataTable, DataTableSearch, DataTableToolbar } from './components/data-table';",
          "import type { DataTableSearchOptions, DataTableToolbarSlots } from './components/data-table';",
          "const search: DataTableSearchOptions = { placeholder: 'Find records…' };",
          'const slots: DataTableToolbarSlots<Record<string, unknown>> = {',
          "  controls: ({ activeFilterCount }) => <span>{activeFilterCount}</span>,",
          '};',
          'export { DataTable, DataTableSearch, DataTableToolbar, search, slots };',
          '',
        ].join('\n'),
      );

      const build = await Bun.build({
        entrypoints: [join(targetDir, 'entry.tsx')],
        outdir: join(targetDir, 'dist'),
        target: 'browser',
      });
      expect(build.success).toBe(true);
    } finally {
      await rm(targetDir, { recursive: true, force: true });
    }
  });

  test('copies kanban source with its app-owned dependencies', async () => {
    const targetDir = await createTempApp();

    try {
      const result = await addZeroSource({
        targetDir,
        items: ['components/kanban'],
      });

      expect(result.filesWritten).toContain('components/kanban/kanban-board.tsx');
      expect(result.filesWritten).toContain('components/kanban/kanban-utils.ts');
      expect(result.filesWritten).toContain('components/ui/avatar.tsx');
      expect(result.filesWritten).toContain('components/ui/badge.tsx');
      expect(result.filesWritten).toContain('components/ui/scroll-area.tsx');
      expect(result.filesWritten).toContain('lib/utils.ts');

      await writeFile(
        join(targetDir, 'entry.tsx'),
        "import { KanbanBoard } from './components/kanban';\nexport { KanbanBoard };\n"
      );

      const build = await Bun.build({
        entrypoints: [join(targetDir, 'entry.tsx')],
        outdir: join(targetDir, 'dist-kanban'),
        target: 'browser',
      });
      expect(build.success).toBe(true);
    } finally {
      await rm(targetDir, { recursive: true, force: true });
    }
  });

  test('copies hero source with background and action dependencies', async () => {
    const targetDir = await createTempApp();

    try {
      const result = await addZeroSource({
        targetDir,
        items: ['components/hero'],
      });

      expect(result.filesWritten).toContain('components/hero/hero.tsx');
      expect(result.filesWritten).toContain('components/hero/hero-background.tsx');
      expect(result.filesWritten).toContain('components/hero/hero-actions.tsx');
      expect(result.filesWritten).toContain('components/hero/hero.types.ts');
      expect(result.filesWritten).toContain('components/hero/wavy-background.tsx');
      expect(result.filesWritten).toContain('components/ui/button.tsx');
      expect(result.filesWritten).toContain('components/animate-ui/components/backgrounds/gradient.tsx');
      expect(result.filesWritten).toContain('components/animate-ui/components/backgrounds/stars.tsx');
      expect(result.filesWritten).toContain('lib/utils.ts');

      await writeFile(
        join(targetDir, 'entry.tsx'),
        "import { Hero } from './components/hero';\nexport { Hero };\n"
      );

      const build = await Bun.build({
        entrypoints: [join(targetDir, 'entry.tsx')],
        outdir: join(targetDir, 'dist-hero'),
        target: 'browser',
      });
      expect(build.success).toBe(true);
    } finally {
      await rm(targetDir, { recursive: true, force: true });
    }
  });

  test('copies public text effects source with motion dependencies', async () => {
    const targetDir = await createTempApp();

    try {
      const result = await addZeroSource({
        targetDir,
        items: ['components/text-effects'],
      });

      expect(result.filesWritten).toContain('components/text-effects/text-generate-effect.tsx');
      expect(result.filesWritten).toContain('components/text-effects/typewriter-effect.tsx');
      expect(result.filesWritten).toContain('components/text-effects/flip-words.tsx');
      expect(result.filesWritten).toContain('components/text-effects/index.ts');
      expect(result.filesWritten).toContain('lib/utils.ts');
    } finally {
      await rm(targetDir, { recursive: true, force: true });
    }
  });

  test('copies accessible streaming text with its class-name helper', async () => {
    const targetDir = await createTempApp();

    try {
      const result = await addZeroSource({
        targetDir,
        items: ['components/streaming-text'],
      });

      expect(result.filesWritten).toContain('components/streaming-text/streaming-text.tsx');
      expect(result.filesWritten).toContain('components/streaming-text/index.ts');
      expect(result.filesWritten).toContain('lib/utils.ts');
      expect(result.filesPlanned).not.toContain('components/streaming-text/streaming-text.test.tsx');

      await writeFile(
        join(targetDir, 'entry.tsx'),
        "import { StreamingText } from './components/streaming-text';\nexport { StreamingText };\n"
      );

      const build = await Bun.build({
        entrypoints: [join(targetDir, 'entry.tsx')],
        outdir: join(targetDir, 'dist-streaming-text'),
        target: 'browser',
      });
      expect(build.success).toBe(true);
    } finally {
      await rm(targetDir, { recursive: true, force: true });
    }
  });

  test('copies public landing components with shared dependencies', async () => {
    const targetDir = await createTempApp();

    try {
      const result = await addZeroSource({
        targetDir,
        items: [
          'components/faq',
          'components/expandable-card',
          'components/bento-grid',
          'components/animated-list',
        ],
      });

      expect(result.filesWritten).toContain('components/faq/faq.tsx');
      expect(result.filesWritten).toContain('components/expandable-card/expandable-card.tsx');
      expect(result.filesWritten).toContain('components/bento-grid/bento-grid.tsx');
      expect(result.filesWritten).toContain('components/animated-list/animated-list.tsx');
      expect(result.filesWritten).toContain('components/text-effects/text-generate-effect.tsx');
      expect(result.filesWritten).toContain('components/animate-ui/icons/zero-icon.tsx');
      expect(result.filesWritten).toContain('hooks/use-click-away.ts');
      expect(result.filesWritten).toContain('lib/utils.ts');
    } finally {
      await rm(targetDir, { recursive: true, force: true });
    }
  });

  test('copies public feature, CTA, footer, and code block sections with shared dependencies', async () => {
    const targetDir = await createTempApp();

    try {
      const result = await addZeroSource({
        targetDir,
        items: ['components/features', 'components/cta', 'components/footer', 'components/code-block'],
      });

      expect(result.filesWritten).toContain('components/features/features-section.tsx');
      expect(result.filesWritten).toContain('components/features/features-section.types.ts');
      expect(result.filesWritten).toContain('components/cta/cta-section.tsx');
      expect(result.filesWritten).toContain('components/cta/cta-section.types.ts');
      expect(result.filesWritten).toContain('components/footer/footer-section.tsx');
      expect(result.filesWritten).toContain('components/footer/footer-section.types.ts');
      expect(result.filesWritten).toContain('components/hero/hero-actions.tsx');
      expect(result.filesWritten).toContain('components/code-block/code-block.tsx');
      expect(result.filesWritten).toContain('components/code-block/code-block-highlight.ts');
      expect(result.filesWritten).toContain('components/ui/button.tsx');
      expect(result.filesWritten).toContain('hooks/use-copy-to-clipboard.ts');
      expect(result.filesWritten).toContain('components/animate-ui/icons/zero-icon.tsx');
      expect(result.filesWritten).toContain('lib/utils.ts');

      await writeFile(
        join(targetDir, 'entry.tsx'),
        "import { CodeBlock } from './components/code-block';\nimport { CtaSection } from './components/cta';\nimport { FeaturesSection } from './components/features';\nimport { FooterSection } from './components/footer';\nexport { CodeBlock, CtaSection, FeaturesSection, FooterSection };\n"
      );

      const build = await Bun.build({
        entrypoints: [join(targetDir, 'entry.tsx')],
        outdir: join(targetDir, 'dist-public-feature'),
        target: 'browser',
      });
      expect(build.success).toBe(true);
    } finally {
      await rm(targetDir, { recursive: true, force: true });
    }
  });

  test('copies resizable navbar source with its animated icon dependencies', async () => {
    const targetDir = await createTempApp();

    try {
      const result = await addZeroSource({
        targetDir,
        items: ['components/navbar'],
      });

      expect(result.filesWritten).toContain('components/navbar/resizable-navbar.tsx');
      expect(result.filesWritten).toContain('components/navbar/resizable-navbar.types.ts');
      expect(result.filesWritten).toContain('components/ui/button.tsx');
      expect(result.filesWritten).toContain('components/animate-ui/icons/menu.tsx');
      expect(result.filesWritten).toContain('components/animate-ui/icons/x.tsx');
      expect(result.filesWritten).toContain('components/animate-ui/icons/icon.tsx');
      expect(result.filesWritten).toContain('lib/utils.ts');

      await writeFile(
        join(targetDir, 'entry.tsx'),
        "import { ResizableNavbar } from './components/navbar';\nexport { ResizableNavbar };\n"
      );

      const build = await Bun.build({
        entrypoints: [join(targetDir, 'entry.tsx')],
        outdir: join(targetDir, 'dist-navbar'),
        target: 'browser',
      });
      expect(build.success).toBe(true);
    } finally {
      await rm(targetDir, { recursive: true, force: true });
    }
  });
});

async function writeTestTsConfig(targetDir: string): Promise<void> {
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      types: ['bun'],
      strict: true,
      skipLibCheck: true,
      esModuleInterop: true,
      jsx: 'react-jsx',
      jsxImportSource: 'react',
      baseUrl: '.',
      paths: {
        '@/*': ['./*'],
        '@/components/*': ['./components/*'],
        '@/hooks/*': ['./hooks/*'],
        '@/lib/*': ['./lib/*'],
      },
    },
    include: ['**/*.ts', '**/*.tsx'],
  };

  await writeFile(join(targetDir, 'tsconfig.json'), `${JSON.stringify(tsconfig, null, 2)}\n`);
}

async function linkFrameworkPackage(targetDir: string): Promise<void> {
  const scopeDir = join(targetDir, 'node_modules/@zero');
  await mkdir(scopeDir, { recursive: true });
  await symlink(process.cwd(), join(scopeDir, 'framework'), 'dir');
}
