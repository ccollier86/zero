/** Synthetic AppShell-like workspace for managed inspectors, forms, pickers and nested decisions. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { DrawerWorkspace, useDrawers, type DrawerHandle } from '../drawers';
import { ModalManager } from './modal-manager';
import { modals } from './modal-events';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../components/animate-ui/components/radix/popover';

function Canvas() {
  const api = useDrawers(), handle = React.useRef<DrawerHandle | null>(null);
  const [count, setCount] = React.useState(0);
  const open = (guarded = false) => {
    handle.current = api.show({ title: 'Node inspector', description: 'Configure the pinned native function.', reserveSpace: true, width: '340px',
      beforeClose: guarded ? () => modals.confirm({ title: 'Replace inspector?', description: 'Discard this synthetic draft?', confirmLabel: 'Discard', cancelLabel: 'Keep editing' }) : undefined,
      body: context => <>
        <label>Node name<Input aria-label="Node name" defaultValue="Pinned function A" /></label>
        <div style={{ display: 'flex', gap: 8, marginBlock: 12 }}>
          <Popover><PopoverTrigger asChild><Button>Inspector options</Button></PopoverTrigger><PopoverContent><p>Owned picker content</p></PopoverContent></Popover>
          <Button onClick={() => context.show({ title: 'Nested decision', body: <Input aria-label="Decision reason" />, actions: [{ id: 'done', label: 'Done', value: true }] })}>Open decision</Button>
        </div>
        <Button onClick={() => { void handle.current?.replace({ title: 'Replacement inspector', body: 'The replacement passed its guard.' }); }}>Replace node</Button>
        <div>{Array.from({ length: 60 }, (_, i) => <p key={i}>Input field {i + 1}: synthetic mapping configuration.</p>)}</div>
      </>, actions: [{ id: 'apply', label: 'Apply', value: true, variant: 'primary' }],
    });
  };
  return <div style={{ padding: 20 }}>
    <h1>Workflow drawer fixture</h1>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <Button onClick={() => open()}>Inspect node</Button>
      <Button onClick={() => open(true)}>Guarded inspector</Button>
      <Button onClick={() => setCount(value => value + 1)}>Canvas action</Button>
      <Button onClick={() => modals.discardAll()}>Retire scope</Button>
    </div>
    <output data-testid="canvas-count">Canvas actions: {count}</output>
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, marginTop: 24, padding: 24, minHeight: 360 }}>
      When → Do → Then. The canvas remains interactive beside a nonmodal inspector.
    </div>
  </div>;
}

function Fixture() {
  const [mounted, setMounted] = React.useState(true);
  return <ModalManager><div style={{ minHeight: '100vh', background: 'var(--background)', color: 'var(--foreground)' }}>
    <header style={{ height: 56, padding: 12, borderBottom: '1px solid var(--border)' }}>
      <Button onClick={() => setMounted(value => !value)}>Toggle workspace</Button>
    </header>
    <div style={{ display: 'grid', gridTemplateColumns: '140px minmax(0,1fr)', height: 'calc(100vh - 56px)' }}>
      <aside style={{ padding: 12, borderRight: '1px solid var(--border)' }}>App navigation</aside>
      {mounted && <DrawerWorkspace><Canvas /></DrawerWorkspace>}
    </div>
  </div></ModalManager>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
