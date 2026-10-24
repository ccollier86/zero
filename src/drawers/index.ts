/** Public drawer facade; every surface shares Zero's existing modal owner, guards, tokens and scroll anatomy. */
export { drawers } from '../modals/drawer-events';
export { DrawerManager, DrawerWorkspace, ControlledDrawer, useDrawers } from '../modals/drawer-workspace';
export type { ControlledDrawerProps } from '../modals/drawer-workspace';
export type { DrawerDescriptor, DrawerHandle, DrawerOptions, DrawerResult, DrawerSide } from '../modals/drawer-types';
