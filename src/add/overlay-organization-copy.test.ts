/** Structural overlay migration: exact former copy closure, frozen bodies with explicit approved enhancements, and shared identities. */
import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { addZeroSource } from './copy';
import { buildSourceCopyBrowserFixture } from './test-support/build-source-copy-fixture';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable } from '../test-support/playwright-test-browser';

const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';
const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const cases = [
  {
    "item": "components/popover",
    "files": [
      "components/animate-ui/components/radix/popover.tsx",
      "components/animate-ui/primitives/radix/popover.tsx",
      "components/overlays/anchored-surface-motion.ts",
      "components/overlays/anchored-surface.css",
      "components/overlays/overlay-scope.tsx",
      "components/overlays/scroll-viewport-decoration.tsx",
      "components/overlays/scroll-viewport-metrics.ts",
      "components/overlays/scroll-viewport.css",
      "components/overlays/use-scroll-viewport.ts",
      "components/popover/index.ts",
      "hooks/use-controlled-state.tsx",
      "lib/get-strict-context.tsx",
      "lib/observe-presentation-theme.ts",
      "lib/utils.ts"
    ],
    "canonical": [
      "components/_internal/anchored-surface/anchored-surface-motion.ts",
      "components/_internal/anchored-surface/anchored-surface.css",
      "components/_internal/overlay-scope/overlay-scope.tsx",
      "components/_internal/scroll-viewport/scroll-viewport-decoration.tsx",
      "components/_internal/scroll-viewport/scroll-viewport-metrics.ts",
      "components/_internal/scroll-viewport/scroll-viewport.css",
      "components/_internal/scroll-viewport/use-scroll-viewport.ts",
      "components/surfaces/popover/index.ts",
      "components/surfaces/popover/popover-primitive.tsx",
      "components/surfaces/popover/popover.tsx"
    ]
  },
  {
    "item": "components/dropdown-menu",
    "files": [
      "components/animate-ui/components/radix/dropdown-menu.tsx",
      "components/animate-ui/primitives/effects/highlight.tsx",
      "components/animate-ui/primitives/radix/dropdown-menu.tsx",
      "components/dropdown-menu/index.ts",
      "components/overlays/anchored-surface-motion.ts",
      "components/overlays/anchored-surface.css",
      "components/overlays/overlay-scope.tsx",
      "components/overlays/scroll-viewport-decoration.tsx",
      "components/overlays/scroll-viewport-metrics.ts",
      "components/overlays/scroll-viewport.css",
      "components/overlays/use-scroll-viewport.ts",
      "hooks/use-controlled-state.tsx",
      "hooks/use-data-state.tsx",
      "lib/get-strict-context.tsx",
      "lib/observe-presentation-theme.ts",
      "lib/utils.ts"
    ],
    "canonical": [
      "components/_internal/anchored-surface/anchored-surface-motion.ts",
      "components/_internal/anchored-surface/anchored-surface.css",
      "components/_internal/overlay-scope/overlay-scope.tsx",
      "components/_internal/scroll-viewport/scroll-viewport-decoration.tsx",
      "components/_internal/scroll-viewport/scroll-viewport-metrics.ts",
      "components/_internal/scroll-viewport/scroll-viewport.css",
      "components/_internal/scroll-viewport/use-scroll-viewport.ts"
    ]
  },
  {
    "item": "components/tooltip",
    "files": [
      "components/animate-ui/components/radix/tooltip.tsx",
      "components/animate-ui/primitives/animate/slot.tsx",
      "components/animate-ui/primitives/animate/tooltip.tsx",
      "components/animate-ui/primitives/radix/tooltip.tsx",
      "components/kbd/index.ts",
      "components/kbd/kbd.tsx",
      "components/overlays/overlay-scope.tsx",
      "components/tooltip/index.ts",
      "components/tooltip/tooltip-activation.ts",
      "components/tooltip/tooltip-body.tsx",
      "components/tooltip/tooltip-group.tsx",
      "components/tooltip/tooltip-motion-runtime.ts",
      "components/tooltip/tooltip-motion-types.ts",
      "components/tooltip/tooltip-motion.ts",
      "components/tooltip/tooltip-placement.ts",
      "hooks/use-controlled-state.tsx",
      "hooks/use-data-state.tsx",
      "hooks/use-media-query.ts",
      "lib/get-strict-context.tsx",
      "lib/observe-presentation-theme.ts",
      "lib/utils.ts"
    ],
    "canonical": [
      "components/_internal/overlay-scope/overlay-scope.tsx"
    ]
  },
  {
    "item": "components/ui/scroll-area",
    "files": [
      "components/overlays/overlay-scope.tsx",
      "components/overlays/scroll-viewport-decoration.tsx",
      "components/overlays/scroll-viewport-metrics.ts",
      "components/overlays/scroll-viewport.css",
      "components/overlays/use-scroll-viewport.ts",
      "components/ui/scroll-area.tsx",
      "lib/observe-presentation-theme.ts",
      "lib/utils.ts"
    ],
    "canonical": [
      "components/_internal/overlay-scope/overlay-scope.tsx",
      "components/_internal/scroll-viewport/scroll-viewport-decoration.tsx",
      "components/_internal/scroll-viewport/scroll-viewport-metrics.ts",
      "components/_internal/scroll-viewport/scroll-viewport.css",
      "components/_internal/scroll-viewport/use-scroll-viewport.ts"
    ]
  }
] as const;
const bodies = [
  {
    "legacy": "components/animate-ui/components/radix/popover.tsx",
    "canonical": "components/surfaces/popover/popover.tsx",
    "sha256": "1b70f669f2cc3cf9846f4de7c4089c7a8e2a44c4d5b94e75abe1d13a4063c269"
  },
  {
    "legacy": "components/animate-ui/primitives/radix/popover.tsx",
    "canonical": "components/surfaces/popover/popover-primitive.tsx",
    "sha256": "24958f4b5721606f0799bcffe16ca425287f3538fd5d0d95cf000661f1d4a959"
  },
  {
    "legacy": "components/overlays/overlay-scope.tsx",
    "canonical": "components/_internal/overlay-scope/overlay-scope.tsx",
    "sha256": "1f5fe01016e7692a55753b4c1a3f47050b54c607d740d2ff3a6778cb1d86a07b"
  },
  {
    "legacy": "components/overlays/anchored-surface-motion.ts",
    "canonical": "components/_internal/anchored-surface/anchored-surface-motion.ts",
    "sha256": "f5b93e553c33b0bd2e70ffd60b5327255b98a6c4c13c45a47c644201d60c9dc7"
  },
  {
    "legacy": "components/overlays/anchored-surface.css",
    "canonical": "components/_internal/anchored-surface/anchored-surface.css",
    "sha256": "4a0e08e90d9a0a24ecbe2b0b81b3497b40477a6ab0a0aeb76e1ad3f168cd42ae"
  },
  {
    "legacy": "components/overlays/scroll-viewport-decoration.tsx",
    "canonical": "components/_internal/scroll-viewport/scroll-viewport-decoration.tsx",
    "sha256": "bb3372e2e7f20a1ad2986fc75aa49ca951913c0519b7a8af99346c113bce5a77"
  },
  {
    "legacy": "components/overlays/scroll-viewport-metrics.ts",
    "canonical": "components/_internal/scroll-viewport/scroll-viewport-metrics.ts",
    "sha256": "91905390b084f6e915846bb87bd71e807f91b1791fa7159e8b4e3252650107c8"
  },
  {
    "legacy": "components/overlays/use-scroll-viewport.ts",
    "canonical": "components/_internal/scroll-viewport/use-scroll-viewport.ts",
    "sha256": "a3226abc19c919d65282952a6750fc92af4938103423145d34640c46dba930ec"
  },
  {
    "legacy": "components/overlays/scroll-viewport.css",
    "canonical": "components/_internal/scroll-viewport/scroll-viewport.css",
    "sha256": "0d86e30e45f58b776d8f63ab056eb32de5f005ce9decabb544138d37bb5000e5"
  },
  {
    "legacy": "components/overlays/menu-active-highlight.tsx",
    "canonical": "components/_internal/magnetic-highlight/menu-active-highlight.tsx",
    "sha256": "a3ba1415fd30c2316aef76ef7cb61e990a3a4704702aa97c646ba4b322cdc6bf"
  },
  {
    "legacy": "components/overlays/menu-active-highlight.css",
    "canonical": "components/_internal/magnetic-highlight/menu-active-highlight.css",
    "sha256": "dc4468a521bdccb83ac25d496942e43e94f490458e685b1921054e3f37458464"
  }
] as const;

for (const entry of cases) test(`${entry.item} retains its complete pre-move destinations and exact canonical closure`, async () => {
  const plan = await addZeroSource({ targetDir: join(scratch, 'overlay-organization-plan-only'), items: [entry.item], dryRun: true });
  for (const path of entry.files) expect(plan.filesPlanned).toContain(path);
  expect(plan.filesPlanned.filter(path => path.startsWith('components/_internal/') || path.startsWith('components/surfaces/popover/')))
    .toEqual([...entry.canonical]);
  expect(plan.filesPlanned.some(path => /\.(?:test|spec|browser-fixture|test-fixture|package-fixture)\./u.test(path))).toBe(false);
  expect(plan.filesPlanned.some(path => /^(?:frontend\/server\/|databases\/|components\/(?:charts|data-table|auth|storage)\/)/u.test(path))).toBe(false);
  expect(plan.filesPlanned).not.toContain('frontend/styles/globals.css');
  expect(plan.filesWritten).toEqual([]);
});

// The original relocation hashes above remain the historical baseline. The
// approved blog UI introduced a real input anchor in 68ed0ba. Managed drawers
// (376a13c) and scroll chaining/decoration fixes (645295d) also deliberately
// changed their runtime owners. Keep every exception exact and attributable.
const approvedRuntimeBodies: Readonly<Record<string, string>> = {
  'components/surfaces/popover/popover.tsx': 'd9e20e1821be71f117cb5042a85142459072d2246fa791cd94edd843412357c6',
  'components/surfaces/popover/popover-primitive.tsx': 'c644617a72d0492345337a7f214921821236aa799cf5dd278c60119af0af7936',
  'components/_internal/overlay-scope/overlay-scope.tsx': 'b524af4a167265aefd00d9b5d6e30217533b2015f019bed7228162409a94cb68',
  'components/_internal/scroll-viewport/scroll-viewport-decoration.tsx': '11c9391274c9413f50ba7e3b4b38f1c33f3936c54cead157f6c13f6a1c86c2e0',
  'components/_internal/scroll-viewport/scroll-viewport-metrics.ts': '61b7f54169444167a7d5a6142fea0eb1035f23641646918cd605a5ee465ffe7a',
  'components/_internal/scroll-viewport/use-scroll-viewport.ts': 'd20e25b3107219f8de99e4bf98571f981a3d2d8661a78d84791a873619d2ff70',
};

test('canonical overlay bodies retain the relocation baseline or exact approved runtime enhancements', async () => {
  const printer = ts.createPrinter({ removeComments: true });
  for (const entry of bodies) {
    const source = await readFile(join(sourceRoot, entry.canonical), 'utf8');
    const ast = ts.createSourceFile(entry.canonical, source, ts.ScriptTarget.Latest, true);
    const normalized = entry.canonical.endsWith('.css') ? source.trimEnd()
      : ast.statements.filter(node => !ts.isImportDeclaration(node))
        .map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast)).join('\n');
    expect(createHash('sha256').update(normalized).digest('hex')).toBe(approvedRuntimeBodies[entry.canonical] ?? entry.sha256);
    const old = await readFile(join(sourceRoot, entry.legacy), 'utf8');
    expect(old).toContain(entry.canonical.endsWith('.css') ? '@import ' : 'export * from ');
    expect(source.split('\n').length).toBeLessThanOrEqual(400);
  }
});

test('Popover canonical and retained public facades expose only the same curated values/types', async () => {
  const declarations = async (path: string) => {
    const ast = ts.createSourceFile(path, await readFile(join(sourceRoot, path), 'utf8'), ts.ScriptTarget.Latest, true);
    return ast.statements.filter(ts.isExportDeclaration).flatMap(node => node.exportClause && ts.isNamedExports(node.exportClause)
      ? node.exportClause.elements.map(element => `${node.isTypeOnly || element.isTypeOnly ? 'type' : 'value'}:${element.name.text}`) : ['UNBOUNDED_EXPORT']);
  };
  const expected = ['value:Popover', 'value:PopoverAnchor', 'value:PopoverClose', 'value:PopoverContent', 'value:PopoverTrigger', 'value:PopoverViewport',
    'type:PopoverCloseProps', 'type:PopoverContentProps', 'type:PopoverProps', 'type:PopoverAnchorProps', 'type:PopoverTriggerProps', 'type:PopoverViewportProps'];
  expect(await declarations('components/surfaces/popover/index.ts')).toEqual(expected);
  expect(await declarations('components/popover/index.ts')).toEqual(expected);
});

test('organized copy skips every customized former overlay destination and remains repeatable', async () => {
  await mkdir(scratch, { recursive: true });
  const consumer = await mkdtemp(join(scratch, 'overlay-organization-preservation-'));
  const legacy = [...new Set(cases.flatMap(entry => [...entry.files]))];
  try {
    for (const path of legacy) {
      await mkdir(dirname(join(consumer, path)), { recursive: true });
      await writeFile(join(consumer, path), `/* Synthetic application-owned customization: ${path}. */\n`);
    }
    const result = await addZeroSource({ targetDir: consumer, items: cases.map(entry => entry.item) });
    for (const path of legacy) {
      expect(result.filesSkipped).toContain(path);
      expect(result.filesWritten).not.toContain(path);
      expect(await readFile(join(consumer, path), 'utf8')).toBe(`/* Synthetic application-owned customization: ${path}. */\n`);
    }
    expect(result.filesWritten).toContain('components/surfaces/popover/index.ts');
    expect(result.filesWritten).toContain('components/_internal/overlay-scope/overlay-scope.tsx');
    expect((await addZeroSource({ targetDir: consumer, items: cases.map(entry => entry.item) })).filesWritten).toEqual([]);
  } finally {
    // This freshly allocated synthetic consumer is disposable; never touch real copied applications.
    await rm(consumer, { recursive: true, force: true });
  }
});

(playwrightTestBrowserAvailable ? test : test.skip)('copied public/private Popover and shared mechanisms keep one identity, registry and CSS', async () => {
  await mkdir(scratch, { recursive: true });
  const consumer = await mkdtemp(join(scratch, 'overlay-organization-consumer-'));
  let lease: Awaited<ReturnType<typeof acquirePlaywrightTestBrowser>> | undefined;
  try {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const installed = join(root, 'node_modules'), modules = join(consumer, 'node_modules');
    await mkdir(join(modules, '@zero'), { recursive: true });
    await Promise.all((await readdir(installed)).filter(name => name !== '@zero').map(name => symlink(join(installed, name), join(modules, name))));
    await symlink(root, join(modules, '@zero/framework'), 'dir');
    await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
      target: 'ES2022', jsx: 'react-jsx', moduleResolution: 'Bundler', paths: { '@/*': ['./*'] },
    } }));
    await writeFile(join(consumer, 'zero.config.ts'), "throw new Error('OVERLAY_ORGANIZATION_CONFIG_MUST_NOT_EXECUTE');\n");
    await writeFile(join(consumer, '.env'), 'ZERO_OVERLAY_ORGANIZATION_ENV_TRIPWIRE=must-not-load\n');
    await addZeroSource({ targetDir: consumer, items: [...cases.map(entry => entry.item), 'components/ui/command'] });
    await writeFile(join(consumer, 'entry.tsx'), [
      "import * as React from 'react'; import {createRoot} from 'react-dom/client';",
      "import * as OldPublic from './components/popover'; import * as Public from './components/surfaces/popover';",
      "import * as OldStyled from './components/animate-ui/components/radix/popover'; import * as Styled from './components/surfaces/popover/popover';",
      "import * as OldPrimitive from './components/animate-ui/primitives/radix/popover'; import * as Primitive from './components/surfaces/popover/popover-primitive';",
      "import * as OldScope from './components/overlays/overlay-scope'; import * as Scope from './components/_internal/overlay-scope/overlay-scope';",
      "import * as OldMotion from './components/overlays/anchored-surface-motion'; import * as Motion from './components/_internal/anchored-surface/anchored-surface-motion';",
      "import * as OldScroll from './components/overlays/scroll-viewport-decoration'; import * as Scroll from './components/_internal/scroll-viewport/scroll-viewport-decoration';",
      "import * as OldMetrics from './components/overlays/scroll-viewport-metrics'; import * as Metrics from './components/_internal/scroll-viewport/scroll-viewport-metrics';",
      "import * as OldViewport from './components/overlays/use-scroll-viewport'; import * as Viewport from './components/_internal/scroll-viewport/use-scroll-viewport';",
      "import * as OldMagnetic from './components/overlays/menu-active-highlight'; import * as Magnetic from './components/_internal/magnetic-highlight/menu-active-highlight';",
      "import './components/overlays/anchored-surface.css'; import './components/overlays/scroll-viewport.css'; import './components/overlays/menu-active-highlight.css';",
      'const same=(a:Record<string,unknown>,b:Record<string,unknown>)=>Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(key=>a[key]===b[key]);',
      'Object.assign(window,{__overlayIdentity:{public:same(OldPublic,Public),styled:same(OldStyled,Styled),primitive:same(OldPrimitive,Primitive),',
      'scope:same(OldScope,Scope),motion:same(OldMotion,Motion),scroll:same(OldScroll,Scroll),metrics:same(OldMetrics,Metrics),viewport:same(OldViewport,Viewport),magnetic:same(OldMagnetic,Magnetic)}});',
      'function Fixture(){const [open,setOpen]=React.useState(false),[active,setActive]=React.useState(true),[viewport,setViewport]=React.useState<HTMLDivElement|null>(null);',
      'Object.assign(window,{__overlayControl:{close:()=>setOpen(false),active:setActive,registered:()=>({old:OldScope.hasOwnedFloatingOverlay("mixed"),current:Scope.hasOwnedFloatingOverlay("mixed")})}});',
      'return <OldScope.OverlayScopeProvider value={{id:"mixed",zIndex:1500,active}}><OldPrimitive.Popover open={open} onOpenChange={setOpen}>',
      '<Public.PopoverTrigger>Mixed Popover</Public.PopoverTrigger><OldPublic.PopoverContent data-testid="mixed-surface" style={{width:180,padding:10}}>',
      '<OldPublic.PopoverViewport data-testid="mixed-viewport" style={{maxHeight:70,overflowY:"auto"}}>{Array.from({length:20},(_,i)=><p key={i}>Row {i}</p>)}</OldPublic.PopoverViewport>',
      '</OldPublic.PopoverContent></OldPrimitive.Popover><div style={{position:"relative",height:100,width:200}}>',
      '<div data-testid="raw-viewport" ref={setViewport} style={{height:100,overflowY:"auto"}}><div style={{height:600}}>Measured content</div></div>',
      '<Scroll.ScrollViewportDecoration viewport={viewport} scrollbars="always"/></div></OldScope.OverlayScopeProvider>;}',
      'createRoot(document.getElementById("root")!).render(<Fixture/>);',
    ].join('\n'));
    await buildSourceCopyBrowserFixture(join(consumer, 'entry.tsx'), join(consumer, 'build'), consumer);
    const script = await readFile(join(consumer, 'build/entry.js'), 'utf8'), css = await readFile(join(consumer, 'build/entry.css'), 'utf8');
    for (const marker of ['data-zero-anchored-motion', 'zero-scroll-decoration', 'zero-menu-active-highlight']) expect(css).toContain(marker);
    expect(script).not.toContain('OVERLAY_ORGANIZATION_CONFIG_MUST_NOT_EXECUTE');
    expect(script).not.toContain('ZERO_OVERLAY_ORGANIZATION_ENV_TRIPWIRE');
    lease = await acquirePlaywrightTestBrowser();
    const page = await lease.browser.newPage({ reducedMotion: 'reduce' });
    try {
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.abort());
      await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
      await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
      await page.getByRole('button', { name: 'Mixed Popover', exact: true }).waitFor();
      expect(await page.evaluate(() => (window as unknown as { __overlayIdentity: Record<string, boolean> }).__overlayIdentity))
        .toEqual({ public: true, styled: true, primitive: true, scope: true, motion: true, scroll: true, metrics: true, viewport: true, magnetic: true });
      await page.getByRole('button', { name: 'Mixed Popover', exact: true }).click();
      const surface = page.getByTestId('mixed-surface'); await surface.waitFor();
      await page.waitForFunction(() => (window as any).__overlayControl.registered().old && (window as any).__overlayControl.registered().current);
      expect(await surface.getAttribute('data-zero-overlay-owner')).toBe('mixed');
      expect(await surface.evaluate(element => getComputedStyle(element).zIndex)).toBe('1502');
      expect(await page.getByTestId('mixed-viewport').evaluate(element => getComputedStyle(element).scrollbarWidth)).toBe('none');
      expect(await page.getByTestId('raw-viewport').evaluate(element => getComputedStyle(element).scrollbarWidth)).toBe('none');
      await page.evaluate(() => (window as any).__overlayControl.active(false));
      await page.waitForFunction(() => document.querySelector('[data-testid="mixed-surface"]')?.hasAttribute('inert'));
      expect(await surface.evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none');
      await page.evaluate(() => (window as any).__overlayControl.close());
      await surface.waitFor({ state: 'detached' });
      expect(await page.evaluate(() => (window as any).__overlayControl.registered())).toEqual({ old: false, current: false });
      expect(errors).toEqual([]);
    } finally { await page.close(); }
    expect(await readFile(join(consumer, 'zero.config.ts'), 'utf8')).toContain('OVERLAY_ORGANIZATION_CONFIG_MUST_NOT_EXECUTE');
    expect(await readFile(join(consumer, '.env'), 'utf8')).toContain('must-not-load');
    expect((await addZeroSource({ targetDir: consumer, items: [...cases.map(entry => entry.item), 'components/ui/command'] })).filesWritten).toEqual([]);
  } finally {
    lease?.release();
    await rm(consumer, { recursive: true, force: true });
  }
}, 120_000);
