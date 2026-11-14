import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = join(import.meta.dir, '..');
function files(dir: string): string[] { return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]); }
test('calendar anatomy has no independent palette or UI-library color tokens', () => {
  for (const file of files(join(root, 'styles')).filter(file => !/calendar-(theme|tokens|zero)\.css$/.test(file))) {
    const source = readFileSync(file, 'utf8');
    expect(source, file).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|--mantine-/i);
    expect(source, file).not.toMatch(/var\([^{};]*\)\s*-[a-z]+\s*:/);
  }
});
test('every static calendar token reference resolves to a stored declaration', () => {
  const sources = files(root).filter(file => /\.(css|tsx?)$/.test(file) && !file.endsWith('.test.ts')).map(file => [file, readFileSync(file, 'utf8')] as const);
  const declared = new Set(sources.flatMap(([, source]) => [...source.matchAll(/(--calendar-[a-z0-9-]+)['"]?\s*:/g)].map(match => match[1])));
  for (const [file, source] of sources) for (const match of source.matchAll(/var\((--calendar-[a-z0-9-]+)(?=[,)])/g)) expect(declared.has(match[1]), `${file}: ${match[1]}`).toBe(true);
});
test('calendar UI uses actual native Zero overlays, selectors, tooltips and icons', () => {
  const surface = readFileSync(join(root, 'components/calendar-surfaces.tsx'), 'utf8');
  expect(surface).toContain("from '@zero/framework/modals'"); expect(surface).toContain("from '@zero/framework/components/popover'");
  expect(surface).not.toContain('motion: {');
  expect(readFileSync(join(root, 'components/calendar-menu-surfaces.tsx'), 'utf8')).toContain("from '@zero/framework/components/dropdown-menu'");
  expect(readFileSync(join(root, 'components/calendar-select.tsx'), 'utf8')).toContain("from '@zero/framework/components/ui/select'");
  expect(readFileSync(join(root, 'components/calendar-tooltip.tsx'), 'utf8')).toContain("from '@zero/framework/components/tooltip'");
  expect(readFileSync(join(root, 'components/calendar-icons.tsx'), 'utf8')).toContain("from '@zero/framework/icons'");
});
test('shared view and public component entry do not import the local demo controller', () => {
  const index = readFileSync(join(root, 'index.ts'), 'utf8');
  expect(index).not.toContain('preview/calendar-workspace');
  expect(readFileSync(join(root, 'components/calendar-schedule.tsx'), 'utf8')).not.toContain('demoCalendars');
});
test('reusable calendar components do not require demo data or a second UI runtime', () => {
  for (const directory of ['components', 'recovered', 'models']) for (const file of files(join(root, directory)).filter(file => /\.tsx?$/.test(file) && !file.endsWith('.test.ts'))) {
    expect(readFileSync(file, 'utf8'), file).not.toMatch(/from ['"](?:@mantine\/|@tabler\/|[^'"]*\/preview\/)/);
  }
});
