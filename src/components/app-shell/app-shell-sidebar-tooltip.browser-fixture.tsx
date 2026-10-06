/** Isolated sidebar compositions; no app provider, credentials or backend is started. */
import { createRoot } from 'react-dom/client';
import { useRef, useState } from 'react';
import { AppShell } from './app-shell';
import { Tooltip, TooltipContent, TooltipTrigger } from '#zero/components/tooltip';
import { Button } from '#zero/components/ui/button';
import {
  Sidebar, SidebarContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarProvider,
} from '#zero/components/sidebar';

export const LONG_SIDEBAR_LABEL = 'Advanced organization permissions and workflow delivery settings ' + 'x'.repeat(180);

function FixtureIcon({ className }: { className?: string }) {
  return <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M4 4h16v16H4z" /></svg>;
}

const scenario = document.body.dataset.scenario ?? 'app-shell';
function UnanimatedFixture() {
  const ref = useRef<HTMLButtonElement>(null);
  const [clicks, setClicks] = useState(0);
  const [pointers, setPointers] = useState(0);
  const [refValid, setRefValid] = useState(false);
  return <SidebarProvider defaultOpen={false}>
      <Sidebar collapsible="icon" side={scenario === 'right-edge' ? 'right' : 'left'} animateOnHover={false}>
        <SidebarContent><SidebarMenu><SidebarMenuItem>
          <SidebarMenuButton ref={ref} aria-label="Unanimated navigation"
            tooltip={scenario === 'right-edge' ? LONG_SIDEBAR_LABEL : 'Unanimated navigation'}
            onPointerDown={() => setPointers((count) => count + 1)}
            onClick={() => { setClicks((count) => count + 1); setRefValid(Boolean(ref.current?.isConnected)); }}>
            <FixtureIcon /><span>Unanimated navigation</span>
          </SidebarMenuButton>
        </SidebarMenuItem><SidebarMenuItem>
          <SidebarMenuButton aria-label="Control without hint"><FixtureIcon /><span>No hint</span></SidebarMenuButton>
        </SidebarMenuItem><SidebarMenuItem>
          <SidebarMenuButton tooltip={{ children: 'Object-form description' }}><FixtureIcon /><span>Object hint</span></SidebarMenuButton>
        </SidebarMenuItem><SidebarMenuItem>
          <SidebarMenuButton aria-label="Explicit accessible name" tooltip={{ children: 'Different description' }}><FixtureIcon /><span>Named hint</span></SidebarMenuButton>
        </SidebarMenuItem></SidebarMenu></SidebarContent>
      </Sidebar>
      <main>Isolated sidebar fixture
        <output data-testid="caller-clicks">{clicks}</output>
        <output data-testid="caller-pointers">{pointers}</output>
        <output data-testid="caller-ref">{String(refValid)}</output>
      </main>
    </SidebarProvider>;
}
const fixture = scenario === 'generic'
  ? <main className="flex gap-4 p-24">
      <Tooltip>
        <TooltipTrigger asChild><Button>Generic help</Button></TooltipTrigger>
        <TooltipContent aria-label="Accessible help description">Ordinary tooltip description</TooltipContent>
      </Tooltip>
      <Button>Next control</Button>
    </main>
  : scenario === 'static' || scenario === 'right-edge'
  ? <UnanimatedFixture />
  : <AppShell defaultSidebarOpen={false} currentPath="#dashboard" header={false}
      brand={{ name: 'Synthetic Brand', href: '#brand', icon: FixtureIcon }}
      workspaces={scenario === 'brand' ? undefined : {
        activeId: 'synthetic-workspace', items: [{ id: 'synthetic-workspace', name: 'Synthetic Workspace', icon: FixtureIcon }],
      }}
      user={{ name: 'Synthetic User', email: 'synthetic@example.test' }}
      nav={[{ label: 'Workspace', items: [
        { label: 'Dashboard', href: '#dashboard', icon: FixtureIcon },
        { label: 'Automation', icon: FixtureIcon, children: [{ label: 'Runs', href: '#runs' }] },
        { label: 'Custom label', tooltip: 'Custom descriptive help', href: '#custom', icon: FixtureIcon },
      ] }]}>
      <div>Isolated AppShell fixture</div>
    </AppShell>;

createRoot(document.getElementById('root')!).render(fixture);
