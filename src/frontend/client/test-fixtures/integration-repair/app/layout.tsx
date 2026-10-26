import type { ReactNode } from 'react';
import { AppProvider } from '@zero/framework/react/app-provider';

export default function Layout({ children }: { children: ReactNode }) {
  return <AppProvider url={typeof window === 'undefined' ? '' : window.location.origin} tables={{}}>{children}</AppProvider>;
}
