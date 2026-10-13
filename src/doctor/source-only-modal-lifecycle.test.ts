/** Close-lifecycle evidence and false-positive fences; no application modules execute. */
import { expect, test } from 'bun:test';
import { checkSourceOnlyModals } from './source-only-modal-checks';
import type { SourceOnlyPackageInfo } from './source-only-package';

const installed: SourceOnlyPackageInfo = { status: 'installed', version: '2.6.0', modalShow: true,
  publicExports: ['.', './react', './modals', './components/*'], deniedExports: [], ownImports: {} };
const check = (source: string, info = installed) => checkSourceOnlyModals({ path: 'app/editor.tsx', source }, info)
  .filter(f => f.code.startsWith('usage.modal.controlled_close') || f.code.startsWith('usage.modal.close_'));

test('controlled beforeClose calling the exact open-state callback is a located strict warning', () => {
  const findings = check(`import { ControlledModal } from '@zero/framework/modals';
    function Editor({open,onOpenChange}) {
      return <ControlledModal open={open} onOpenChange={onOpenChange} descriptor={{title:'Edit',
        beforeClose:()=>{onOpenChange(false);return false;}}}/>;
    }`);
  expect(findings.find(f=>f.code==='usage.modal.controlled_close_bypass')).toMatchObject({
    severity:'warning',category:'recommended',confidence:'high',line:4,path:'app/editor.tsx:4'});
  expect(findings[0]?.hint).toContain('scope or identity retirement');
});

test('named/namespace/immutable aliases and local delegated callbacks preserve public identity', () => {
  for (const imported of ["import {ControlledModal as Managed} from '@zero/framework/modals';",
    "import * as Zero from '@zero/framework/modals'; const Managed=Zero.ControlledModal;"]) {
    const findings = check(`${imported}
      function Editor(props) { const close=()=>props.onOpenChange(false);
        function guard(){close();return false;}
        return <Managed open={props.open} onOpenChange={props.onOpenChange} descriptor={{title:'Edit',beforeClose:guard}}/>;
      }`);
    expect(findings.some(f=>f.code==='usage.modal.controlled_close_bypass')).toBe(true);
  }
});

test('forwarding onOpenChange and action/body handlers use the actual setter, not its spelling', () => {
  const findings = check(`import {ControlledModal} from '@zero/framework/modals'; import {useState} from 'react';
    function Editor(){const [open,setOpen]=useState(false); const close=()=>setOpen(false);
      return <ControlledModal open={open} onOpenChange={next=>setOpen(next)} descriptor={{title:'Edit',
        actions:[{id:'save',label:'Save',onClick:close}],body:<button onClick={()=>setOpen(false)}>Cancel</button>}}/>;
    }`);
  expect(findings.filter(f=>f.code==='usage.modal.controlled_close_bypass')).toHaveLength(2);
});

test('a delegated always-refusing guard is review evidence, not a proven bypass', () => {
  const findings = check(`import {ControlledModal} from '@zero/framework/modals';
    function Editor(props){const state=useController(props); return <ControlledModal open={props.open} onOpenChange={props.onOpenChange}
      descriptor={{title:'Edit',beforeClose:()=>{state.requestClose();return false;}}}/>;}`);
  expect(findings).toHaveLength(1);
  expect(findings[0]).toMatchObject({code:'usage.modal.close_flow_review',severity:'info',category:'manual-review',confidence:'low'});
});

test('manager retirement inside a managed action requires review but cleanup is not ordinary dismissal', () => {
  const findings = check(`import {modals as dialogs,ControlledModal} from '@zero/framework/modals'; import {useEffect} from 'react';
    function Editor(props){useEffect(()=>()=>dialogs.disposeHost(['owner']),[props.scope]);
      return <ControlledModal open={props.open} onOpenChange={props.onOpenChange}
        descriptor={{title:'Edit',actions:[{id:'cancel',label:'Cancel',onClick:()=>dialogs.disposeHost(['owner'])}]}}/>;}`);
  expect(findings).toHaveLength(1);
  expect(findings[0]).toMatchObject({code:'usage.modal.close_retirement',severity:'warning',category:'manual-review',confidence:'medium'});
  expect(check(`import {modals} from '@zero/framework/modals';
    function leaveScope(){modals.discardAll();} modals.show({title:'Edit',actions:[{id:'cancel',role:'cancel',label:'Cancel'}]});`)).toEqual([]);
});

test('managed cancel/result notification, rejected guard and identity retirement are not bypasses', () => {
  expect(check(`import {ControlledModal,modals} from '@zero/framework/modals';
    function Editor(props){const close=()=>props.onOpenChange(false);
      return <ControlledModal open={props.open} identityKey={props.scope} onOpenChange={props.onOpenChange} onResult={close}
        descriptor={{title:'Edit',beforeClose:()=>!props.busy,actions:[{id:'cancel',role:'cancel',label:'Cancel'},
        {id:'save',label:'Save',onClick:async context=>{await props.save();context.accept('saved');}}]}}/>;}`)).toEqual([]);
});

test('unrelated components, type-only bindings, shadowed imports and close setters are not Zero misuse', () => {
  for (const source of [
    `import {ControlledModal} from 'another-library'; function Editor(p){return <ControlledModal onOpenChange={p.onOpenChange} descriptor={{beforeClose:()=>p.onOpenChange(false)}}/>;}`,
    `import type {ControlledModal} from '@zero/framework/modals'; function Editor(p){return <ControlledModal onOpenChange={p.onOpenChange} descriptor={{beforeClose:()=>p.onOpenChange(false)}}/>;}`,
    `import {ControlledModal} from '@zero/framework/modals'; function Editor(ControlledModal,p){return <ControlledModal onOpenChange={p.onOpenChange} descriptor={{beforeClose:()=>p.onOpenChange(false)}}/>;}`,
    `import {ControlledModal} from '@zero/framework/modals'; function Editor(p){const close=()=>{const p=custom();p.onOpenChange(false)};return <ControlledModal onOpenChange={p.onOpenChange} descriptor={{title:'Edit',actions:[{id:'x',onClick:close}]}}/>;}`,
  ]) expect(check(source)).toEqual([]);
});

test('overriding spreads and unresolved descriptors cannot prove a lifecycle error', () => {
  expect(check(`import {ControlledModal} from '@zero/framework/modals';
    function Editor(p){return <><ControlledModal onOpenChange={p.onOpenChange} {...p} descriptor={{title:'Edit',beforeClose:()=>p.onOpenChange(false)}}/>
      <ControlledModal onOpenChange={p.onOpenChange} descriptor={{title:'Edit',beforeClose:()=>p.onOpenChange(false),...p.descriptor}}/></>;}`)).toEqual([]);
});

test('comments/string payloads and unavailable structured capability do not invent advice or leak source', () => {
  expect(check(`const s="<ControlledModal beforeClose={()=>onOpenChange(false)}/>"; // modals.disposeHost([])`)).toEqual([]);
  const source=`import {ControlledModal} from '@zero/framework/modals'; function Editor(SECRET_PRIVATE){return <ControlledModal
    onOpenChange={SECRET_PRIVATE.onOpenChange} descriptor={{title:'PRIVATE_TITLE',beforeClose:()=>SECRET_PRIVATE.onOpenChange(false)}}/>;}`;
  expect(JSON.stringify(check(source))).not.toContain('SECRET_PRIVATE');
  expect(JSON.stringify(check(source))).not.toContain('PRIVATE_TITLE');
  for (const modalShow of [false,null]) expect(check(source,{...installed,modalShow})).toEqual([]);
});

test('useCallback and deferred callback arguments cannot conceal a local controlled close', () => {
  expect(check(`import {ControlledModal} from '@zero/framework/modals'; import {useCallback as keep} from 'react';
    function Editor(p){const close=keep(()=>p.onOpenChange(false),[]);return <ControlledModal onOpenChange={p.onOpenChange}
      descriptor={{title:'Edit',actions:[{id:'save',onClick:()=>p.save().then(close)}]}}/>;}`)
    .filter(f=>f.code==='usage.modal.controlled_close_bypass')).toHaveLength(1);
});

test('a nearer local function shadows an outer close alias without following the outer callback', () => {
  expect(check(`import {ControlledModal} from '@zero/framework/modals'; function Editor(p){const close=()=>p.onOpenChange(false);
    function guard(){function close(){} close();return false;}
    return <ControlledModal onOpenChange={p.onOpenChange} descriptor={{title:'Edit',beforeClose:guard}}/>;}`)).toEqual([]);
});

test('cyclic local callback/property aliases remain bounded source evidence rather than crashing inspection', () => {
  expect(check(`import {ControlledModal} from '@zero/framework/modals'; import {useCallback} from 'react';
    const guard=useCallback(guard,[]); function Editor(p){return <ControlledModal onOpenChange={p.onOpenChange}
      descriptor={{title:'Edit',beforeClose:guard}}/>;}`)).toEqual([]);
  expect(check(`import {ControlledModal} from '@zero/framework/modals'; const owner=owner.self;
    function Editor(){return <ControlledModal onOpenChange={owner.onOpenChange}
      descriptor={{title:'Edit',actions:[{id:'x',onClick:()=>owner.onOpenChange(false)}]}}/>;}`)).toEqual([]);
});

test('opening another modal does not qualify an opaque close guard as managed dismissal', () => {
  expect(check(`import {ControlledModal,modals} from '@zero/framework/modals'; function Editor(p){
    return <ControlledModal onOpenChange={p.onOpenChange} descriptor={{title:'Edit',
      beforeClose:()=>{p.leave(modals.show({title:'Another'}));return false;}}}/>;}`)
    .some(f=>f.code==='usage.modal.close_flow_review')).toBe(true);
});

test('the former first-party Studio refusal is reviewable, while corrected guard predicates are clean', async () => {
  for (const name of ['data-studio-table-dialog','data-studio-row-dialog']) {
    const path=`src/components/data-studio/${name}.tsx`, source=await Bun.file(new URL(`../components/data-studio/${name}.tsx`,import.meta.url)).text();
    const findings=checkSourceOnlyModals({path,source},{...installed,status:'workspace'});
    expect(findings.some(f=>f.code==='usage.modal.close_flow_review')).toBe(false);
    const former=source.replace('beforeClose: state.requestClose', 'beforeClose: () => { state.requestClose(); return false; }');
    expect(checkSourceOnlyModals({path,source:former},{...installed,status:'workspace'})
      .some(f=>f.code==='usage.modal.close_flow_review')).toBe(true);
    // An application's same-spelling private relative module is not Zero ownership.
    expect(checkSourceOnlyModals({path,source},installed).some(f=>f.code==='usage.modal.close_flow_review')).toBe(false);
  }
});
