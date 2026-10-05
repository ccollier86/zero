import { createRoot } from 'react-dom/client';
import { SidebarProvider, Sidebar, SidebarContent, SidebarMenu,
  SidebarMenuItem, SidebarMenuButton } from './sidebar';

const root = document.getElementById('root')!;
createRoot(root).render(<SidebarProvider><Sidebar animateOnHover={false}>
  <SidebarContent><SidebarMenu><SidebarMenuItem>
    <SidebarMenuButton variant="outline">Synthetic outline</SidebarMenuButton>
  </SidebarMenuItem></SidebarMenu></SidebarContent>
</Sidebar></SidebarProvider>);
