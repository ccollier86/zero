import type { ReactNode } from 'react';

export default function RootLayout({ children }: { children?: ReactNode }) {
  return (
    <div style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#0c0c14', color: 'rgba(255,255,255,0.92)' }}>
      {children}
    </div>
  );
}
