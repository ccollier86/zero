'use client';

/** Contained inspector layout and controlled bridge over the existing manager. No transport, second focus owner or second modal store. */
import * as React from 'react';
import { ModalManager, type ModalManagerProps } from './modal-manager';
import { ControlledModal, type ControlledModalProps } from './modal-controlled';
import { drawers, drawerModalDescriptor } from './drawer-events';
import { isDrawerModal, type DrawerDescriptor, type DrawerHandle } from './drawer-types';
import { modalStore } from './modal-store';
import { modals } from './modal-events';
import { useMediaQuery } from '../hooks/use-media-query';
import { useOverlayScope } from '../components/overlays/overlay-scope';

const WorkspaceContext = React.createContext<{ container: HTMLElement | null } | null>(null);
const EMPTY = { modals: [], closingIds: [] };

/** Optional standalone host. Under AppShell it inherits the already-mounted ModalManager. */
export function DrawerManager(props: ModalManagerProps) { return <ModalManager {...props} />; }

/** The canvas stays interactive beside a contained nonmodal inspector; only the content column reserves width. */
export function DrawerWorkspace({ children, className, style, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
  const state = React.useSyncExternalStore(React.useCallback((notify: () => void) => {
    const subscription = modalStore.subscribe(notify); return () => subscription.unsubscribe();
  }, []), () => modalStore.getSnapshot().context, () => EMPTY);
  const narrow = useMediaQuery('(max-width: 640px)', { initializeWithValue: true });
  const active = state.modals.filter(item => !state.closingIds.includes(item.id) && item.descriptor?.drawer?.container === container);
  const reserved = (side: 'left' | 'right') => [...active].reverse().find(item => item.descriptor?.drawer?.reserveSpace
    && !isDrawerModal(item.descriptor.drawer, narrow) && item.descriptor.drawer.side === side)?.descriptor?.drawer?.width;
  const lifetime = React.useRef<object | null>(null);
  const currentContainer = React.useRef(container); currentContainer.current = container;
  React.useEffect(() => {
    const lease = {}; lifetime.current = lease;
    return () => { lifetime.current = null; queueMicrotask(() => {
      if (lifetime.current === null || currentContainer.current !== container) modals.disposeHost(modalStore.getSnapshot().context.modals.filter(item => container && item.descriptor?.drawer?.container === container).map(item => item.id));
    }); };
  }, [container]);
  return <WorkspaceContext.Provider value={React.useMemo(() => ({ container }), [container])}>
    <ModalManager recedeSurface={false}>
      <div {...rest} className={className} data-slot="drawer-workspace" style={{ position: 'relative', minHeight: 0, height: '100%', ...style }}>
        <div data-slot="drawer-workspace-content" style={{ minWidth: 0, minHeight: 0, height: '100%',
          paddingLeft: reserved('left') ? `min(${reserved('left')},100%)` : undefined,
          paddingRight: reserved('right') ? `min(${reserved('right')},100%)` : undefined }}>{children}</div>
        <div ref={setContainer} data-slot="drawer-workspace-portals" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
      </div>
    </ModalManager>
  </WorkspaceContext.Provider>;
}

/** Bind imperative drawers to the current workspace without app-owned portal plumbing. */
export function useDrawers() {
  const workspace = React.useContext(WorkspaceContext);
  const owner = useOverlayScope();
  return React.useMemo(() => ({ ...drawers,
    show<T>(descriptor: DrawerDescriptor<T>): DrawerHandle<T> {
      if (workspace && !workspace.container) throw new Error('DrawerWorkspace has not mounted yet');
      return drawers.show({ ...descriptor, container: descriptor.container === undefined ? workspace?.container : descriptor.container,
        parentId: descriptor.parentId ?? owner?.id });
    },
  }), [workspace, owner?.id]);
}

export type ControlledDrawerProps<T = unknown> = Omit<ControlledModalProps<T>, 'descriptor'> & { descriptor: DrawerDescriptor<T> };

/** Live body/action updates retain a generation; identityKey is reserved for authoritative target retirement. */
export function ControlledDrawer<T>(props: ControlledDrawerProps<T>) {
  const workspace = React.useContext(WorkspaceContext);
  const descriptor = drawerModalDescriptor({ ...props.descriptor,
    container: props.descriptor.container === undefined ? workspace?.container : props.descriptor.container });
  return <ControlledModal {...props} open={props.open && (!workspace || Boolean(workspace.container))} descriptor={descriptor} />;
}
