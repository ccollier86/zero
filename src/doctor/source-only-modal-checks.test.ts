/** AST migration evidence avoids strings/comments, aliases, unknown spreads and shadowed imports. */
import { expect, test } from 'bun:test';
import { checkSourceOnlyModals } from './source-only-modal-checks';
import type { SourceOnlyPackageInfo } from './source-only-package';

const installed: SourceOnlyPackageInfo = { status: 'installed', version: '2.6.0', modalShow: true,
  publicExports: ['.', './react', './modals', './components/*'], deniedExports: ['./components/private'], ownImports: {} };
const check = (source: string, packageInfo = installed) => checkSourceOnlyModals({ path: 'app/page.tsx', source }, packageInfo);

test('literal aliases/namespace and multiline calls are located; strings/comments are not calls', () => {
  const findings = check([
    'import { modals as dialogs } from "@zero/framework/modals";',
    'import * as Zero from "@zero/framework/react";',
    '// dialogs.show({});',
    'const text = "dialogs.show({})";',
    'dialogs.open(', '  { content: <p>Hello</p> }', ');',
    'Zero.modals.show({ title: "Valid", body: <div /> });',
    'dialogs.show({ body: <p>Missing title</p> });',
  ].join('\n'));
  expect(findings.map(f => [f.code, f.line])).toEqual([['usage.modal.legacy_open', 5], ['usage.modal.title_required', 9]]);
  expect(findings[0]).toMatchObject({ severity: 'warning', category: 'recommended', confidence: 'high', path: 'app/page.tsx:5' });
});

test('shadowed function parameters and block variables are not mistaken for imported APIs', () => {
  const findings = check(`import { modals } from '@zero/framework';
    function wrapper(modals: any) { modals.show({}); }
    function local() { const modals = custom(); modals.show({}); }
    modals.show({title:'Actual'});`);
  expect(findings).toEqual([]);
});

test('supported exact-owner focus and managed test slots are not treated as copied frame options', () => {
  const findings = check(`import { modals } from '@zero/framework/modals';
    modals.show({title:'Managed', dataSlot:'editor', onCloseAutoFocus:event=>event.preventDefault()});`);
  expect(findings).toEqual([]);
});

test('dynamic descriptor/spreads receive manual review, not a false missing-title error', () => {
  const findings = check(`import { modals } from '@zero/framework';
    modals.show(props);
    modals.show({...props, body:<p/>});
    modals.show({title:'Known', ...props});
    modals.show({...props, title:''});`);
  expect(findings.filter(f => f.category === 'manual-review')).toHaveLength(3);
  expect(findings.filter(f => f.code === 'usage.modal.title_required')).toHaveLength(1);
  expect(findings.at(-1)?.line).toBe(5);
});

test('an overriding spread or later literal does not turn an earlier invalid option into a false required error', () => {
  const findings = check(`import { modals } from '@zero/framework';
    modals.show({size:'giant', ...props, title:'Known'});
    modals.show({title:'Known', motion:{entrance:'bad', ...overrides}});
    modals.show({title:'Known', size:'giant', size:'md'});`);
  expect(findings.filter(f => f.severity === 'error')).toEqual([]);
  expect(findings.filter(f => f.code === 'usage.modal.dynamic_option')).toHaveLength(2);
});

test('motion/config known invalid values and incompatible layouts are required findings', () => {
  const findings = check(`import { modals as modal } from '@zero/framework/modals';
    modal.show({title:'Test', content:<div/>, size:'giant', layout:'tabs', body:<p/>,
      motion:{entrance:'flip', exit:'rotate', backdrop:'none', speed:1.5, durationMultiplier:Infinity, pageRecedes:1}});`);
  expect(new Set(findings.map(f => f.code))).toEqual(new Set(['usage.modal.unsupported_option', 'usage.modal.invalid_option', 'usage.modal.motion_value',
    'usage.modal.motion_option', 'usage.modal.motion_pace', 'usage.modal.mixed_layout', 'usage.modal.sections_required']));
  expect(findings.every(f => f.severity === 'error' && f.confidence === 'high')).toBe(true);
});

test('older or missing installed capabilities never recommend an unavailable show migration', () => {
  const source = "import { modals } from '@zero/framework'; modals.open({content:'x'});";
  for (const modalShow of [false, null]) {
    const findings = check(source, { ...installed, version: '2.5.0', modalShow });
    expect(findings[0]).toMatchObject({ severity: 'info', category: 'manual-review' });
    expect(findings[0]?.hint).not.toContain('installed modals.show descriptor');
  }
  expect(check("import { modals } from '@zero/framework'; modals.show({title:'x'});", { ...installed, modalShow: false })[0]?.code).toBe('usage.modal.unavailable_show');
});

test('private aliases, package export deny overrides, app-owned aliases and direct primitives are distinct', () => {
  const findings = check(`import { X } from '#zero/components/animate-ui/dialog';
    import { Z } from '@zero/framework/components/private';
    import { Public } from '@zero/framework/components/button';
    import * as Dialog from '@radix-ui/react-dialog';`);
  expect(findings.map(f => f.code)).toEqual(['usage.import.private_zero', 'usage.import.missing_export', 'usage.modal.direct_primitive']);
  expect(check("import X from '#zero/own';", { ...installed, ownImports: { '#zero/*': './src/*.ts' } })).toEqual([]);
});

test('literal reexports and dynamic import targets are inspected without executing them', () => {
  const findings = check(`export { Thing } from '#zero/hidden';
    const module=await import('@zero/framework/not-exported');
    const fake="import('#zero/fake')";`);
  expect(findings.map(f => [f.code, f.line])).toEqual([['usage.import.private_zero', 1], ['usage.import.missing_export', 2]]);
});

test('known native nested controls warn but a semantic list row with trailing controls does not', () => {
  const findings = check(`const list=<ul><li><span>Name</span><select /></li></ul>;
    const bad=<button><span><input /></span></button>;
    const other=<a href='/x'><button>Go</button></a>;`);
  expect(findings.map(f => [f.code, f.line])).toEqual([['usage.modal.nested_interactive', 2], ['usage.modal.nested_interactive', 3]]);
});

test('syntax failure is coverage error with no source/diagnostic payload leak', () => {
  const findings = check("import { modals } from '@zero/framework'; modals.show({ title: SECRET_PRIVATE };");
  expect(findings).toHaveLength(1); expect(findings[0]?.code).toBe('usage.source.parse_failed');
  expect(JSON.stringify(findings)).not.toContain('SECRET_PRIVATE');
});
