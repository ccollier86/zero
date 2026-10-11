/** Bounded section extraction: metadata/links/fences and public syntax only; no app or TS program. */
import { expect, test } from 'bun:test';
import * as ts from 'typescript';
import { parseDocumentationPage } from './markdown';

const root = new URL('../../', import.meta.url);
const repository = new URL('../../../', import.meta.url);
const families = [
  {
    old: 'frontend/components/primitives/choices.md', canonical: 'frontend/components/controls/select.md',
    index: 'frontend/components/controls/index.md', oldId: 'zero.frontend.components.primitives.choices',
    id: 'zero.frontend.components.controls.select',
    extracted: ['select-family', 'morph-presentation-and-rich-options'],
    retained: ['select-combobox-checkbox-and-radiogroup', 'combobox', 'checkbox-and-radiogroup',
      'switch-unreleased-public-facade-addition', 'related-guides-and-next-steps'],
    siblings: {
      'Combobox': 'a0207a5bfc916169640e5756c443cedc07317bd8835dcb21a55363ec01ee4442',
      'Checkbox And RadioGroup': '9ec6580dcd9781922cbb18ebcdf470676e7cd52a141f6a95006b4bea8edfdfb0',
      'Switch (Unreleased Public Facade Addition)': '6a1a96c63b3ba1a76a6a7d40b6d29110ca6d936f2c51ef54065eb0ae2affb122',
    },
    examples: ['5291c3621d90800c5bbb571873b9f91d599a79fa40bbf902f0217abb25783cc6',
      'd4eda2d01e73ed2eaba39ec84ba83aedda4a2dae216ff07aa0d7e2c3d7657e91'],
    symbols: ['Select', 'SelectContent', 'SelectGroup', 'SelectItem', 'SelectLabel', 'SelectScrollDownButton',
      'SelectScrollUpButton', 'SelectSeparator', 'SelectTrigger', 'SelectValue'],
  },
  {
    old: 'frontend/components/primitives/surfaces.md', canonical: 'frontend/components/surfaces/card.md',
    index: 'frontend/components/surfaces/index.md', oldId: 'zero.frontend.components.primitives.surfaces',
    id: 'zero.frontend.components.surfaces.card',
    extracted: ['standard-card-parts', 'contentcard-and-managed-quick-look'],
    retained: ['cards-badges-avatars-and-separators', 'badge', 'avatar', 'separator-and-skeleton',
      'related-guides-and-next-steps'],
    siblings: {
      'Badge': '84353bb083f4cf9d307bf20b7bea91fc5db4c08ea7f48dd9b1079fdc068da0ec',
      'Avatar': 'a5904ce8c52a48a6ff0160c874ddd71e1c6923ea41eb47a17e962989b48e163e',
      'Separator And Skeleton': 'a596b37135bfe4a47ac0f498e14bef6d56231b73a6dbd2d2dfc8d1a3eb5160ff',
    },
    examples: ['fcc21f016e8a74590e37cc8f4b045ad45a34118f3942c9ce132abcdd2eaba2a1',
      '8093bff911f6c441b4d54555fde8f8077aa74de4a0e1f4f2ab11e780bc1d596b'],
    symbols: ['Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardContent', 'CardFooter'],
  },
] as const;

const exampleDigests = (text: string) => [...text.matchAll(/^```tsx?\n([\s\S]*?)^```/gm)]
  .map(match => new Bun.CryptoHasher('sha256').update(match[1]!).digest('hex'));
const read = (path: string) => Bun.file(new URL(path, root)).text();
const pointsTo = (links: readonly string[], from: string, target: string) =>
  links.some(link => new URL(link, new URL(from, root)).href === new URL(target, root).href);

for (const family of families) {
  test(`${family.id}: extracted manual, old sibling identity, anchors and exact examples`, async () => {
    const oldText = await read(family.old), canonicalText = await read(family.canonical);
    const old = parseDocumentationPage(oldText), canonical = parseDocumentationPage(canonicalText);
    expect(old.metadata.id).toBe(family.oldId);
    expect(canonical.metadata.id).toBe(family.id);
    expect(canonical.metadata.type).toBe('reference');
    expect(canonical.metadata.maturity).toBe('supported');
    expect(canonical.metadata.reviewed_against).toMatchObject({ version: '2.6.0', snapshot: 'dirty' });
    expect(old.metadata.id).not.toBe(canonical.metadata.id);
    for (const anchor of family.extracted) {
      expect(old.anchors.has(anchor), `${family.old}#${anchor}`).toBe(true);
      expect(canonical.anchors.has(anchor), `${family.canonical}#${anchor}`).toBe(true);
      expect(pointsTo(old.links, family.old, `${family.canonical}#${anchor}`)).toBe(true);
    }
    for (const anchor of family.retained) expect(old.anchors.has(anchor), anchor).toBe(true);
    const sections = oldText.split(/^## /m).slice(1);
    for (const [heading, expected] of Object.entries(family.siblings)) {
      const section = sections.find(body => body.startsWith(`${heading}\n`));
      expect(section, heading).toBeDefined();
      const body = section!.slice(heading.length + 1);
      expect(new Bun.CryptoHasher('sha256').update(body).digest('hex'), heading).toBe(expected);
    }
    expect(exampleDigests(canonicalText)).toEqual([...family.examples]);
    expect(exampleDigests(oldText)).toHaveLength(0);
    const index = parseDocumentationPage(await read(family.index));
    expect(index.metadata.type).toBe('index');
    expect(index.links.some(link => new URL(link, new URL(family.index, root)).pathname
      === new URL(family.canonical, root).pathname)).toBe(true);
    expect(pointsTo(canonical.links, family.canonical, family.index)).toBe(true);
    const componentIndex = parseDocumentationPage(await read('frontend/components/index.md'));
    expect(pointsTo(componentIndex.links, 'frontend/components/index.md', family.index)).toBe(true);
  });
}

test('canonical routing and example compilation read the extracted manuals, not duplicate contracts', async () => {
  const compiler = await Bun.file(new URL('docs-next/_work/checks/frontend-ui-examples.test.ts', repository)).text();
  const uiPath = 'frontend/ui-reference.md', ui = parseDocumentationPage(await read(uiPath));
  for (const family of families) {
    expect(compiler).toContain(`'${family.canonical}': [0, 1]`);
    expect(compiler).not.toContain(`'${family.old}': [0, 1]`);
    expect(ui.links.some(link => new URL(link, new URL(uiPath, root)).pathname === new URL(family.canonical, root).pathname)).toBe(true);
  }
  const catalog = await read('_work/audits/catalogs/frontend-components.md');
  for (const family of families) for (const name of family.symbols) {
    const rows = catalog.split('\n').filter(row => row.startsWith(`| \`${name}\` |`));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain(family.canonical);
  }
  expect(parseDocumentationPage(catalog).metadata.reviewed_against)
    .toMatchObject({ version: '2.1.1', snapshot: 'clean' });
});

function namedValues(text: string) {
  const file = ts.createSourceFile('facade.ts', text, ts.ScriptTarget.Latest, false);
  return file.statements.flatMap(statement => ts.isExportDeclaration(statement) && !statement.isTypeOnly
    && statement.exportClause && ts.isNamedExports(statement.exportClause)
    ? statement.exportClause.elements.filter(item => !item.isTypeOnly).map(item => item.name.text) : []);
}

test('seven additional Card values have exact public routes, current owners and manual homes', async () => {
  const catalog = await read('_work/audits/catalogs/frontend-components.md');
  const body = catalog.split('### Card Family Working Source — 2026-10-10\n')[1]?.split('### Review Boundaries')[0];
  expect(body).toBeDefined();
  expect(body).toContain('335b27372b0b8ef57a1e92cf93cec378923fe50b');
  const names = ['CardAction', 'CardMedia', 'CardByline', 'CardMeta', 'CardStatus', 'CardSection', 'ContentCard'];
  const facade = namedValues(await Bun.file(new URL('src/frontend/exports/controls/primitives.ts', repository)).text());
  const manual = parseDocumentationPage(await read('frontend/components/surfaces/card.md'));
  for (const name of names) {
    expect(facade).toContain(name);
    const rows = body!.split('\n').filter(row => row.startsWith(`| \`${name}\` |`));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    const path = name === 'ContentCard' ? 'content-card' : 'card';
    expect(row).toContain('`@zero/framework`');
    expect(row).toContain('`@zero/framework/react`');
    expect(row).toContain(`\`@zero/framework/components/ui/${path}\``);
    if (name === 'CardStatus') expect(row).toContain('`@zero/framework/components/ui/card-status`');
    const declaration = name === 'CardStatus' ? 'card-status.tsx' : name === 'ContentCard' ? 'content-card.tsx' : 'card.tsx';
    expect(row).toContain(`src/components/surfaces/card/${declaration}`);
    const source = await Bun.file(new URL(`src/components/surfaces/card/${declaration}`, repository)).text();
    expect(source).toContain(`function ${name}(`);
    expect(row).toContain('frontend/components/surfaces/card.md#');
    const anchor = name === 'ContentCard' ? 'contentcard-and-managed-quick-look' : 'standard-card-parts';
    expect(manual.anchors.has(anchor)).toBe(true);
  }
  const publicCard = namedValues(await Bun.file(new URL('src/components/ui/card.tsx', repository)).text());
  for (const name of names.filter(name => name !== 'ContentCard')) expect(publicCard).toContain(name);
  const packageJSON = await Bun.file(new URL('package.json', repository)).json();
  expect(packageJSON.exports['./components/ui/*']).toEqual({ types: './src/components/ui/*.tsx', import: './src/components/ui/*.tsx' });
});
