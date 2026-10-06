/** Coordinates nested reader modal lifecycles without timers or focus beneath an active drawer. */
import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react';
import { useSidebar } from '@zero/framework/react';

interface DocsNavigationLifecycle {
  navigate(afterClose: () => void): void;
  release(event: Event): boolean;
}
const Context = createContext<DocsNavigationLifecycle | null>(null);
/** For custom reader compositions, wrap navigation/search together inside Zero's SidebarProvider. */
export function DocsNavigationScope({ children }: { readonly children: ReactNode }) {
  const { openMobile, setOpenMobile } = useSidebar();
  const drawerOpen = useRef(openMobile), pending = useRef<(() => void) | null>(null);
  drawerOpen.current = openMobile;
  const value = useMemo<DocsNavigationLifecycle>(() => ({
    navigate(afterClose) {
      if (drawerOpen.current) { pending.current = afterClose; setOpenMobile(false); }
      else afterClose();
    },
    release(event) {
      const callback = pending.current;
      if (!callback) return false;
      pending.current = null; event.preventDefault(); callback(); return true;
    },
  }), [setOpenMobile]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useDocsNavigationLifecycle() { return useContext(Context); }
