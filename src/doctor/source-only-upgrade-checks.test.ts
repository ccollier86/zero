/** Pure migration applicability fixtures: no application imports, services, environment or filesystem reads. */
import { expect, test } from 'bun:test';
import { checkSourceOnlyUpgradeUsage } from './source-only-upgrade-checks';
import type { SourceOnlyFile } from './source-only-types';
import type { SourceOnlyUpgradeTargetInspection, UpgradeEvidenceStatus, UpgradeExportKind } from './source-only-upgrade-types';

function target(status: UpgradeEvidenceStatus = 'available', exports: Record<string, UpgradeEvidenceStatus> = {}) {
  const inspected: Array<[string, string, UpgradeExportKind]> = [];
  const inspection: SourceOnlyUpgradeTargetInspection = {
    summary: { status: 'explicit', version: '2.6.0', fingerprint: { algorithm: 'sha256', scope: 'bounded-public-source', value: 'synthetic', complete: true, files: 1 },
      capabilities: { modalShow: status, dropdownInnerViewport: status, popoverViewport: status, contentCard: status, selectRichSlots: status } }, findings: [],
    async inspectNamedExport(specifier, name, kind = 'value') { inspected.push([specifier, name, kind]); return { status: exports[`${name}:${kind}`] ?? exports[name] ?? 'available' }; },
  };
  return { inspection, inspected };
}
const source = (text: string): SourceOnlyFile => ({ path: 'app/page.tsx', source: text });
async function check(text: string, status: UpgradeEvidenceStatus = 'available', exports: Record<string, UpgradeEvidenceStatus> = {}, extra: SourceOnlyFile[] = []) {
  const inspected = target(status, exports);
  return { ...await checkSourceOnlyUpgradeUsage([source(text), ...extra], inspected.inspection), inspected: inspected.inspected };
}

test('aliased and namespaced Zero Content bindings identify native scrolling with stable source locations', async () => {
  const result = await check(`import { DropdownMenuContent as Menu } from '@zero/framework/react';
import * as Zero from '@zero/framework/components/dropdown-menu';
const one=<Menu onScroll={readScroll}><p/></Menu>;
const two=<Zero.DropdownMenuSubContent onScroll={readScroll}/>;`);
  expect(result.findings.map(finding => [finding.code, finding.line])).toEqual([['upgrade.dropdown_scroll_owner', 3], ['upgrade.dropdown_scroll_owner', 4]]);
  expect(result.findings[0]).toMatchObject({ severity: 'warning', category: 'manual-review', confidence: 'high', path: 'app/page.tsx:3' });
  expect(result.stats.behaviorReviews).toBe(2);
  expect(result.inspected).toContainEqual(['@zero/framework/components/dropdown-menu', 'DropdownMenuSubContent', 'value']);
});

test('bounded admitted aliases, local imports/reexports and exported namespaces preserve their original public origin', async () => {
  const result = await check(`import { Surface, Library } from './parts';
const a=<Surface onScroll={read}/>;
const b=<Library.DropdownMenuContent onScroll={read}/>;`, 'available', {}, [
    { path: 'app/parts.ts', source: `export { Renamed as Surface } from '../components/menu'; export * as Library from '@zero/framework/react';` },
    { path: 'components/menu.ts', source: `import { DropdownMenuContent as Renamed } from '@zero/framework/react'; export {Renamed};` },
  ]);
  expect(result.findings.filter(finding => finding.code === 'upgrade.dropdown_scroll_owner')).toHaveLength(2);
  expect(result.stats.unresolvedLocalBindings).toBe(0);
  expect(result.inspected.every(([specifier]) => specifier === '@zero/framework/react')).toBe(true);
});

test('single star reexports and extension-mapped local chains are admitted without evaluating modules', async () => {
  const result = await check(`import { DropdownMenuContent as Menu } from './parts.js'; const view=<Menu onScroll={read}/>;`, 'available', {}, [
    { path: 'app/parts.ts', source: `export * from './public';` },
    { path: 'app/public/index.ts', source: `export * from '@zero/framework/react'; throw new Error('DO_NOT_EXECUTE');` },
  ]);
  expect(result.findings.map(finding => finding.code)).toEqual(['upgrade.dropdown_scroll_owner']);
});

test('same-spelling native, Radix, other-package and copied declarations are not classified as public Zero', async () => {
  const result = await check(`import { DropdownMenuContent } from 'other-kit';
import * as Radix from '@radix-ui/react-dropdown-menu';
function PopoverContent(props:any){return <div/>}
const a=<DropdownMenuContent onScroll={read}/>;
const b=<Radix.Content onScroll={read}/>;
const c=<PopoverContent className='overflow-y-auto'/>;
const d=<div onScroll={read}/>;
// import { Missing } from '@zero/framework';
const text="<DropdownMenuContent onScroll={read}/>";`);
  expect(result.findings).toEqual([]); expect(result.inspected).toEqual([]);
});

test('runtime shadowing by parameters, catches, blocks, for bindings and hoisted var does not flag lookalikes', async () => {
  const result = await check(`import { DropdownMenuContent as Menu } from '@zero/framework/react';
import * as Zero from '@zero/framework/react';
function a(Menu:any){return <Menu onScroll={read}/>}
function b(){const Menu=local;return <Menu onScroll={read}/>}
try{}catch(Menu){const a=<Menu onScroll={read}/>}
for(const Menu of list){const a=<Menu onScroll={read}/>}
function c(){if(test){var Menu=local;} return <Menu onScroll={read}/>}
function d(Zero:any){return <Zero.DropdownMenuContent onScroll={read}/>}
function e(){if(test){let Menu=local;const a=<Menu onScroll={read}/>};return <Menu onScroll={read}/>}`);
  expect(result.findings.filter(finding => finding.code === 'upgrade.dropdown_scroll_owner').map(finding => finding.line)).toEqual([9]);
});

test('ordinary imports used as types use any; explicit type-only bindings do not run JSX behavior checks', async () => {
  const result = await check(`import { CardProps, DropdownMenuContent as Menu } from '@zero/framework/react';
import type { DropdownMenuContent as TypeMenu } from '@zero/framework/react';
type NativeProps=CardProps;
const invalidTyped=<TypeMenu onScroll={read}/>;
const value=<Menu/>;`, 'available', { 'CardProps:value': 'missing' });
  expect(result.findings).toEqual([]);
  expect(result.inspected).toContainEqual(['@zero/framework/react', 'CardProps', 'any']);
  expect(result.inspected).not.toContainEqual(['@zero/framework/react', 'CardProps', 'value']);
});

test('type-only target exports do not satisfy a proven runtime JSX use', async () => {
  const result = await check(`import { TypeOnlyComponent } from '@zero/framework/react'; const value=<TypeOnlyComponent/>;`, 'available', { 'TypeOnlyComponent:any': 'available', 'TypeOnlyComponent:value': 'missing' });
  expect(result.findings).toMatchObject([{ code: 'upgrade.import_missing', severity: 'error', category: 'required' }]);
});

test('known missing imports are required only from complete target proof, and repeated runtime use does not duplicate the import failure', async () => {
  const result = await check(`import { NewComponent } from '@zero/framework/react'; const view=<NewComponent/>;`, 'available', { NewComponent: 'missing' });
  expect(result.findings).toHaveLength(1); expect(result.findings[0]).toMatchObject({ code: 'upgrade.import_missing', severity: 'error', line: 1 });
  const unknown = await check(`import { NewComponent } from '@zero/framework/react';`, 'unknown', { NewComponent: 'unknown' });
  expect(unknown.findings).toMatchObject([{ code: 'upgrade.export_unknown', severity: 'info', category: 'manual-review' }]);
});

test('unadmitted, cyclic and ambiguous local chains remain manual unknown, never missing target exports', async () => {
  const absent = await check(`import { Menu } from './not-admitted'; const view=<Menu onScroll={read}/>;`);
  expect(absent.findings).toMatchObject([{ code: 'upgrade.binding_unknown', severity: 'info' }]);
  expect(absent.inspected).toEqual([]);
  const cycle = await check(`import { Menu } from './a'; const view=<Menu onScroll={read}/>;`, 'available', {}, [
    { path: 'app/a.ts', source: `export {Menu} from './b';` }, { path: 'app/b.ts', source: `export {Menu} from './a';` },
  ]);
  expect(cycle.stats.unresolvedLocalBindings).toBe(1); expect(cycle.findings.every(finding => finding.severity !== 'error')).toBe(true);
  const ambiguous = await check(`import { DropdownMenuContent as Menu } from './parts';const view=<Menu onScroll={read}/>;`, 'available', {}, [
    { path: 'app/parts.ts', source: `export * from '@zero/framework/react';export * from '@zero/framework/components/dropdown-menu';` },
  ]);
  expect(ambiguous.findings).toMatchObject([{ code: 'upgrade.binding_unknown' }]);
});

test('Content-ref scroll operations are scoped precisely; focus, bounding dimensions and viewportRef remain compatible', async () => {
  const result = await check(`import { DropdownMenuContent as Menu } from '@zero/framework/react';
function a(){const ref=useRef(null);ref.current?.scrollTo({top:0});ref.current!.scrollTop=10;
ref.current?.focus();ref.current?.getBoundingClientRect();const height=ref.current?.scrollHeight;
return <Menu ref={ref}/>}
function b(){const ref=useRef(null);ref.current?.scrollTop=10;return <div ref={ref}/>}
function c(){const viewport=useRef(null);viewport.current?.scrollTo({top:0});return <Menu viewportRef={viewport}/>}`);
  expect(result.findings.filter(finding => finding.code === 'upgrade.dropdown_scroll_owner')).toHaveLength(2);
  expect(result.findings.every(finding => finding.line === 2)).toBe(true);
  expect(result.findings[0]?.hint).toContain('viewportRef');
});

test('spread overrides and dynamic refs/styles are not promoted to reliable behavior failures', async () => {
  const result = await check(`import { DropdownMenuContent as Menu, PopoverContent } from '@zero/framework/react';
function a(){const ref=useRef(null);ref.current.scrollTop=10;return <Menu ref={ref} {...props}/>}
const one=<Menu onScroll={read} {...props}/>;
const two=<PopoverContent className='overflow-y-auto' {...props}><p/></PopoverContent>;
const three=<PopoverContent style={{overflowY:'auto',...style}}><p/></PopoverContent>;
const four=<PopoverContent className={dynamic}><p/></PopoverContent>;`);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]).toMatchObject({ code: 'upgrade.dropdown_scroll_owner', severity: 'info', confidence: 'low' });
});

test('changed dropdown ownership is target gated, not inferred from version age or compatible Card/Select usage', async () => {
  const text = `import { DropdownMenuContent, Card, SelectContent } from '@zero/framework/react';const a=<DropdownMenuContent onScroll={read}/>;const b=<Card/>;const c=<SelectContent transition={customMotion}/>;`;
  expect((await check(text, 'missing')).findings).toEqual([]);
  expect((await check(text, 'unknown')).findings).toMatchObject([{ code: 'upgrade.dropdown_scroll_owner', severity: 'info' }]);
  expect((await check(text)).findings).toMatchObject([{ code: 'upgrade.dropdown_scroll_owner', severity: 'warning' }]);
});

test('explicit long popover bodies get scoped composition review; native owned picker/command/cascader viewports are excluded', async () => {
  const result = await check(`import { PopoverContent as Surface, PopoverViewport, Calendar, TimePicker, Command, Cascader } from '@zero/framework/react';
const a=<Surface className='max-h-80 overflow-y-auto'><p>Authored body</p></Surface>;
const b=<Surface style={{overflowY:'scroll'}}><header/><p>Authored body</p></Surface>;
const c=<Surface className='overflow-auto'><PopoverViewport><p/></PopoverViewport></Surface>;
const d=<Surface className='overflow-auto'><Calendar/></Surface>;
const e=<Surface className='overflow-auto'><TimePicker/></Surface>;
const f=<Surface className='overflow-auto'><Command/></Surface>;
const g=<Surface className='overflow-auto'><Cascader/></Surface>;`);
  expect(result.findings.map(finding => [finding.code, finding.line])).toEqual([['upgrade.popover_scroll_body', 2], ['upgrade.popover_scroll_body', 3]]);
  expect(result.findings.every(finding => finding.category === 'recommended' && finding.severity === 'warning')).toBe(true);
});

test('parse failures remain owned by the existing checker and messages never include arbitrary source excerpts', async () => {
  const result = await check(`import { DropdownMenuContent } from '@zero/framework/react';const PRIVATE_SECRET=<DropdownMenuContent onScroll={;`);
  expect(result.findings).toEqual([]); expect(result.stats.inspectedFiles).toBe(0);
  expect(JSON.stringify(result)).not.toContain('PRIVATE_SECRET');
});

test('checked export counts are unique named bindings, not duplicated any/value queries', async () => {
  const result = await check(`import {Card, Missing} from '@zero/framework/react';const a=<Card/>;const b=<Missing/>;`, 'available', { Missing: 'missing' });
  expect(result.stats.checkedNamedExports).toBe(2);
  expect(result.findings).toHaveLength(1);
});

test('namespace runtime property reads are checked without treating named-facade methods as package exports', async () => {
  const result = await check(`import * as Zero from '@zero/framework/react';import {modals} from '@zero/framework/modals';
const Removed=Zero.NoLongerExported;const Other=Zero['AlsoRemoved'];modals.show({title:'Known'});
type TypeName=typeof Zero.Card;`, 'available', { NoLongerExported: 'missing', AlsoRemoved: 'missing' });
  expect(result.findings.filter(finding => finding.code === 'upgrade.import_missing')).toHaveLength(2);
  expect(result.inspected).not.toContainEqual(['@zero/framework/modals', 'show', 'value']);
  expect(result.inspected).not.toContainEqual(['@zero/framework/react', 'Card', 'value']);
});

test('recognizable application path aliases stay manual unknown while bare third-party imports remain out of scope', async () => {
  const result = await check(`import {DropdownMenuContent as Local} from '@/components/menu';
import * as App from '#app/widgets';import Card from '@/components/card';
import {DropdownMenuContent as Other} from 'third-party';
const a=<Local onScroll={read}/>;const b=<App.DropdownMenuContent onScroll={read}/>;const c=<Other onScroll={read}/>;`);
  expect(result.stats.unresolvedLocalBindings).toBe(3);
  expect(result.findings.map(finding => finding.code)).toEqual(['upgrade.binding_unknown', 'upgrade.binding_unknown', 'upgrade.binding_unknown']);
  expect(result.findings.every(finding => finding.severity === 'info')).toBe(true); expect(result.inspected).toEqual([]);
});

test('normal imported types remain legal, while actual identifier value contexts require runtime exports', async () => {
  const result = await check(`import {TypeOnlyComponent, CardProps} from '@zero/framework/react';
type Props=CardProps;interface Holder{value:CardProps}
const copied=TypeOnlyComponent;const fields={TypeOnlyComponent};const view=<div data-value={TypeOnlyComponent}/>;`, 'available', { 'TypeOnlyComponent:value': 'missing', 'CardProps:value': 'missing' });
  expect(result.findings.filter(finding => finding.code === 'upgrade.import_missing')).toHaveLength(3);
  expect(result.inspected).not.toContainEqual(['@zero/framework/react', 'CardProps', 'value']);
});

test('explicitly absent onScroll does not imply surface scrolling', async () => {
  const result = await check(`import {DropdownMenuContent as Menu} from '@zero/framework/react';const a=<Menu onScroll={undefined}/>;const b=<Menu onScroll={null}/>;const c=<Menu onScroll={void 0}/>;`);
  expect(result.findings).toEqual([]);
});

test('immutable component aliases resolve through public namespaces/imports and local reexports without interpreting wrappers', async () => {
  const result = await check(`import * as Zero from '@zero/framework/react';import {Surface as Reexported} from './parts';
const Surface=Zero.DropdownMenuContent;const Again=Surface;
function View(){const Inner=(Again as typeof Again);return <Inner onScroll={read}/>}
const a=<Reexported onScroll={read}/>;
const Wrapped=(props:any)=><Surface {...props}/>;const b=<Wrapped onScroll={read}/>;`, 'available', {}, [
    { path: 'app/parts.ts', source: `import {DropdownMenuContent as Original} from '@zero/framework/react';const Alias=Original;export {Alias as Surface};` },
  ]);
  expect(result.findings.filter(finding => finding.code === 'upgrade.dropdown_scroll_owner')).toHaveLength(2);
  expect(result.stats.unresolvedLocalBindings).toBe(0);
});

test('immutable alias cycles remain bounded manual unknown; shadowed/mutable aliases are not proven Zero consumers', async () => {
  const result = await check(`import * as Zero from '@zero/framework/react';
const Surface=Other;const Other=Surface;const view=<Surface onScroll={read}/>;
function a(Zero:any){const Native=Zero.DropdownMenuContent;return <Native onScroll={read}/>}
let Mutable=Zero.DropdownMenuContent;Mutable=custom;const b=<Mutable onScroll={read}/>;`);
  expect(result.findings).toMatchObject([{ code: 'upgrade.binding_unknown', severity: 'info' }]);
  expect(result.stats.unresolvedLocalBindings).toBe(1);
});

test('pathological parser nesting stays per-file unknown and cannot abort or prove missing exports', async () => {
  const inspected = target('available', { Missing: 'missing' });
  const deeplyNested = `import {Missing} from '@zero/framework/react';const value=${'('.repeat(4000)}0${')'.repeat(4000)};`;
  const result = await checkSourceOnlyUpgradeUsage([source(deeplyNested), { path: 'app/good.tsx', source: `import {Card} from '@zero/framework/react';const value=<Card/>;` }], inspected.inspection);
  expect(result.findings).toMatchObject([{ code: 'upgrade.binding_unknown', severity: 'info', category: 'manual-review', path: 'app/page.tsx:1' }]);
  expect(result.stats.inspectedFiles).toBe(1);
  expect(result.stats.checkedNamedExports).toBe(1);
  expect(inspected.inspected.some(([, name]) => name === 'Missing')).toBe(false);
});

test('a successfully parsed but excessively deep AST is fenced before recursive usage or binding walks', async () => {
  const deeplyNested = `import {Missing} from '@zero/framework/react';const value=${'{nested:'.repeat(350)}0${'}'.repeat(350)};`;
  const result = await check(deeplyNested, 'available', { Missing: 'missing' });
  expect(result.findings).toMatchObject([{ code: 'upgrade.binding_unknown', severity: 'info', category: 'manual-review' }]);
  expect(result.stats.inspectedFiles).toBe(0); expect(result.inspected).toEqual([]);
});

test('an admitted source alias resolves physical re-export siblings while findings retain its lexical location', async () => {
  const inspected = target();
  const result = await checkSourceOnlyUpgradeUsage([
    { path: 'app/entry.tsx', resolutionPath: 'shared/entry.tsx', source: `import {Surface} from './parts';\nconst view=<Surface onScroll={read}/>;` },
    { path: 'app/parts.ts', source: `export {PopoverContent as Surface} from '@zero/framework/react';` },
    { path: 'shared/parts.ts', source: `export {DropdownMenuContent as Surface} from '@zero/framework/react';` },
  ], inspected.inspection);
  expect(result.findings).toMatchObject([{ code: 'upgrade.dropdown_scroll_owner', path: 'app/entry.tsx:2', line: 2 }]);
  expect(result.stats.inspectedFiles).toBe(3);
  expect(result.stats.unresolvedLocalBindings).toBe(0);
  expect(inspected.inspected).toContainEqual(['@zero/framework/react', 'DropdownMenuContent', 'value']);
});

test('literal backslash module specifiers remain unknown instead of being reinterpreted as filesystem separators', async () => {
  const result = await check(String.raw`import {Surface} from './parts\\more';const view=<Surface onScroll={read}/>;`, 'available', {}, [
    { path: 'app/parts/more.ts', source: `export {DropdownMenuContent as Surface} from '@zero/framework/react';` },
  ]);
  expect(result.findings).toMatchObject([{ code: 'upgrade.binding_unknown', severity: 'info', path: 'app/page.tsx:1' }]);
  expect(result.stats.unresolvedLocalBindings).toBe(1);
  expect(result.inspected).not.toContainEqual(['@zero/framework/react', 'DropdownMenuContent', 'value']);
});
