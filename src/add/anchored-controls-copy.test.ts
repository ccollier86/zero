/** Source-owned picker/menu motion and sidecar CSS closure; no app/config/environment execution. */
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { addZeroSource } from './copy';
import { listStaticAddableTargets } from './registry';

const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';
const items = ['components/ui/select', 'components/ui/command', 'components/ui/scroll-area', 'components/ui/card', 'components/ui/content-card', 'components/popover', 'components/dropdown-menu'];
test('anchored controls plan includes owned CSS/helper closure and no test or app assets', async () => {
  for (const id of ['components/popover', 'components/dropdown-menu']) expect(listStaticAddableTargets().some(target => target.id === id)).toBe(true);
  const result = await addZeroSource({ targetDir: join(scratch, 'anchored-controls-plan'), items, dryRun: true });
  for (const file of ['components/ui/select-morph.css', 'components/overlays/anchored-surface.css', 'components/overlays/menu-active-highlight.css',
    'components/overlays/scroll-viewport.css', 'components/ui/content-card.css', 'components/overlays/use-scroll-viewport.ts', 'components/overlays/menu-active-highlight.tsx']) expect(result.filesPlanned).toContain(file);
  expect(result.filesPlanned.some(file => /\.(?:test|browser-fixture|package-fixture)\./u.test(file))).toBe(false);
  expect(result.filesPlanned).not.toContain('frontend/styles/globals.css'); expect(result.filesWritten).toHaveLength(0);
});
test('actual copied Select/Popover/menu/Command/ScrollArea composes and emits its component CSS without booting configuration', async () => {
  await mkdir(scratch, { recursive: true }); const consumer = await mkdtemp(join(scratch, 'anchored-controls-consumer-'));
  try {
    const root = new URL('../../', import.meta.url).pathname, installed = join(root, 'node_modules'), modules = join(consumer, 'node_modules');
    await mkdir(join(modules, '@zero'), { recursive: true });
    await Promise.all((await readdir(installed)).filter(name => name !== '@zero').map(name => symlink(join(installed, name), join(modules, name))));
    await symlink(root, join(modules, '@zero/framework'), 'dir');
    await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', jsx: 'react-jsx', moduleResolution: 'Bundler', paths: { '@/*': ['./*'] } } }));
    await writeFile(join(consumer, 'zero.config.ts'), "throw new Error('ANCHORED_COPY_MUST_NOT_BOOT');\n");
    const result = await addZeroSource({ targetDir: consumer, items });
    expect(result.filesWritten).toContain('components/overlays/anchored-surface.css');
    await writeFile(join(consumer, 'entry.tsx'), [
      "import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from './components/ui/select';",
      "import {Command,CommandInput,CommandList,CommandItem} from './components/ui/command';",
      "import {ScrollArea} from './components/ui/scroll-area';",
      "import {ContentCard} from './components/ui/content-card';",
      "import {CardMedia,CardAction} from './components/ui/card';",
      "import {Popover,PopoverTrigger,PopoverContent,PopoverViewport} from './components/popover';",
      "import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from './components/dropdown-menu';",
      'export const content=<><Select name="choice"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="one" description="Detail" trailing="Metadata">One</SelectItem></SelectContent></Select>',
      '<Popover><PopoverTrigger>Open</PopoverTrigger><PopoverContent><PopoverViewport>Body</PopoverViewport></PopoverContent></Popover>',
      '<DropdownMenu><DropdownMenuTrigger>Actions</DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem>Action</DropdownMenuItem></DropdownMenuContent></DropdownMenu>',
      '<Command><CommandInput /><CommandList><CommandItem value="one">One</CommandItem></CommandList></Command>',
      '<ScrollArea orientation="both" fadeEdges style={{height:100}}>Content</ScrollArea>',
      '<ContentCard title="Project" status="Updated" media={<CardMedia>Visual</CardMedia>} action={<CardAction>Action</CardAction>} details="Details" /></>;',
    ].join('\n'));
    const child = Bun.spawn([process.execPath, '--no-env-file', 'build', 'entry.tsx', '--target', 'browser', '--outdir', 'build'],
      { cwd: consumer, stdout: 'pipe', stderr: 'pipe', timeout: 30_000 });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) throw new Error(`Copied anchored controls failed: ${stdout}\n${stderr}`);
    expect(code).toBe(0); expect(await Bun.file(join(consumer, 'build/entry.js')).exists()).toBe(true);
    const css = await Bun.file(join(consumer, 'build/entry.css')).text();
    for (const selector of ['zero-select-highlight', 'data-zero-anchored-motion', 'zero-menu-active-highlight', 'zero-scroll-decoration', 'zero-content-card']) expect(css).toContain(selector);
    expect(await Bun.file(join(consumer, 'zero.config.ts')).text()).toContain('ANCHORED_COPY_MUST_NOT_BOOT');
    expect((await addZeroSource({ targetDir: consumer, items })).filesWritten).toHaveLength(0);
  } finally { await rm(consumer, { recursive: true, force: true }); }
}, 40_000);
