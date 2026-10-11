/** Synthetic presentation fixtures: no client, app config, persistence or live data. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { ModalManager } from './modal-manager';
import { modals } from './modal-events';
import { Button } from '../components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../components/animate-ui/components/radix/popover';
import type { ModalDescriptor } from './modal-system.types';
import type { ModalMotionEntrance } from './modal-motion-types';

declare global {
  interface Window {
    __modalPresentation: {
      theme(lane: 'platform' | 'public', dark: boolean): void;
      programmatic(): void;
    };
  }
}
const longContent = <div>{Array.from({ length: 60 }, (_, index) => <p key={index}>Synthetic row {index + 1}</p>)}</div>;

function Demo() {
  const [theme, setTheme] = React.useState({ lane: 'platform', dark: false });
  const display = (title: string, extra: Partial<ModalDescriptor> = {}, trigger?: Element) => modals.show({
    title, trigger, height: 'fixed', body: longContent, ...extra,
    actions: [{ id: 'done', label: 'Done', variant: 'primary', value: true }],
  } as ModalDescriptor);
  React.useLayoutEffect(() => {
    window.__modalPresentation = {
      theme: (lane, dark) => setTheme({ lane, dark }),
      programmatic: () => display('Programmatic'),
    };
  });
  return <ModalManager portalContainer={document.getElementById('presentation-portals')}>
    <main data-testid="theme-source" className={theme.dark ? 'dark' : ''}
      data-zero-surface={theme.lane === 'public' ? 'public' : undefined} style={{ padding: 24, minHeight: 700 }}>
      <h1>Modal presentation fixture</h1>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Button onClick={event => display('Custom left', { placement: 'left', customSize: { width: '360px', height: '520px' } }, event.currentTarget)}>Custom left</Button>
        <Button onClick={event => display('Custom right', { placement: 'right', customSize: { width: '360px', height: '520px' } }, event.currentTarget)}>Custom right</Button>
        <Button onClick={event => display('Clamped custom', { customSize: { width: '2000px', maxWidth: '700px', height: '2000px', maxHeight: '520px' } }, event.currentTarget)}>Clamped custom</Button>
        <Button onClick={event => display('Full frame', { size: 'full' }, event.currentTarget)}>Full frame</Button>
        {/* Retained native-skin qualification; default Arc rails have their own dedicated browser contracts. */}
        <Button onClick={event => display('Hidden scroll', { scrollbar: 'hidden', scrollTreatment: 'native' }, event.currentTarget)}>Hidden scroll</Button>
        <Button onClick={event => display('Thin scroll', { scrollbar: 'thin', scrollTreatment: 'native' }, event.currentTarget)}>Thin scroll</Button>
        <Button onClick={event => display('Theme detail', { body: <Popover><PopoverTrigger asChild><Button>Theme popup</Button></PopoverTrigger>
          <PopoverContent><p>Owned popup</p></PopoverContent></Popover> }, event.currentTarget)}>Theme detail</Button>
        {(['rise', 'grow', 'origin', 'spring', 'focus', 'drop'] as const).map((entrance: ModalMotionEntrance) =>
          <Button key={entrance} onClick={event => display('Motion ' + entrance, {
            motion: { entrance, durationMultiplier: 1.5 },
          }, event.currentTarget)}>Motion {entrance}</Button>)}
      </div>
    </main>
  </ModalManager>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Demo /></React.StrictMode>);
