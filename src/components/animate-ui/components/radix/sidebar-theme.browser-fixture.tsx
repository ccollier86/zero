/** Synthetic scoped sidebar fixture; no application configuration, services or font acquisition. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '../../../ui/button';
import { SidebarProvider, Sidebar, SidebarContent, SidebarInset, SidebarTrigger,
  SidebarMenu, SidebarMenuItem, SidebarMenuButton } from './sidebar';

let updateStyle!: React.Dispatch<React.SetStateAction<React.CSSProperties | undefined>>;
let provider: HTMLDivElement | null = null;
let mounts = 0, cleanups = 0, closes = 0;
const providerRef: React.RefCallback<HTMLDivElement> = element => {
  provider = element;
  if (!element) return;
  mounts++;
  return () => { provider = null; cleanups++; };
};
const root = createRoot(document.getElementById('root')!);

function Fixture() {
  const [style, setStyle] = React.useState<React.CSSProperties>();
  updateStyle = setStyle;
  return <section id="source" data-zero-theme="next" data-zero-mode="light"
    style={{ '--zero-theme-font-body': 'monospace', '--zero-type-control-size': '19px',
      '--sidebar': '#112233', '--sidebar-foreground': '#ddeeff' } as React.CSSProperties}>
    <SidebarProvider ref={providerRef} data-testid="sidebar-wrapper">
      <Sidebar style={style} mobileTransition={{ duration: 0 }} mobileOverlayTransition={{ duration: 0 }}
        onMobileCloseAutoFocus={event => {
          closes++;
          event.preventDefault();
          provider?.querySelector<HTMLButtonElement>('[data-testid="toggle"]')?.focus();
        }}>
        <SidebarContent>
          <p data-testid="body">Scoped body</p>
          <Button data-testid="action" animateIcon={false}>Scoped action</Button>
          <input data-testid="draft" aria-label="Draft" defaultValue="preserved" />
          <SidebarMenu><SidebarMenuItem><SidebarMenuButton>Scoped navigation</SidebarMenuButton></SidebarMenuItem></SidebarMenu>
        </SidebarContent>
      </Sidebar>
      <SidebarInset><SidebarTrigger data-testid="toggle" /></SidebarInset>
    </SidebarProvider>
  </section>;
}

root.render(<Fixture />);
Object.assign(window, { __sidebarTheme: {
  setStyle: (style: React.CSSProperties) => updateStyle(style),
  refs: () => ({ matches: provider !== null && provider === document.querySelector('[data-testid="sidebar-wrapper"]'), mounts, cleanups, closes }),
  unmount: () => root.unmount(),
} });
