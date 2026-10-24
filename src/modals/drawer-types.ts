/** Managed drawer presentation contracts; lifecycle, guards and outcomes remain owned by the shared modal system. */
import type { ModalDescriptor, ModalHandle, ModalResult } from './modal-system.types';
import type { ModalMotionOptions } from './modal-motion-types';

export type DrawerSide = 'left' | 'right' | 'top' | 'bottom';
/** Internal renderer projection, snapshotted with each descriptor generation. */
export interface ModalDrawerPresentation {
  readonly side: DrawerSide;
  readonly mode: 'modal' | 'nonmodal';
  readonly mobile: 'bottom-sheet' | 'modal' | 'same';
  readonly container?: HTMLElement | null;
  readonly reserveSpace: boolean;
  readonly width: string;
  readonly sheetHeight: string;
  /** Responsive modality is admitted per opening so resizing cannot remount an editor's draft. */
  readonly narrow?: boolean;
}
export interface DrawerOptions {
  readonly side?: DrawerSide;
  readonly mode?: 'modal' | 'nonmodal';
  /** Bottom sheet is modal on small screens. 'same' deliberately retains desktop modality. */
  readonly mobile?: 'bottom-sheet' | 'modal' | 'same';
  /** Nonmodal desktop rendering is contained here; modal/narrow rendering uses the host's global portal. */
  readonly container?: HTMLElement | null;
  readonly reserveSpace?: boolean;
  readonly width?: string;
  readonly sheetHeight?: string;
  readonly motion?: Omit<ModalMotionOptions, 'entrance'>;
}
type DrawerBase<T> = T extends unknown ? Omit<T, 'placement' | 'drawer' | 'motion'> : never;
export type DrawerDescriptor<T = unknown> = DrawerBase<ModalDescriptor<T>> & DrawerOptions;
export type DrawerResult<T = unknown> = ModalResult<T>;
/** Replacement first obtains guarded dismissal; stale or rejected admission never opens the replacement. */
export interface DrawerHandle<T = unknown> extends Omit<ModalHandle<T>, 'update'> {
  update(updates: Partial<DrawerDescriptor<T>>): void;
  replace<U>(descriptor: DrawerDescriptor<U>): Promise<DrawerHandle<U> | null>;
}

/** Shared responsive modality policy used by the host, renderer and workspace reservation. */
export function isDrawerModal(drawer: ModalDrawerPresentation | undefined, narrow: boolean): boolean {
  return !drawer || drawer.mode === 'modal' || (drawer.narrow ?? narrow) && drawer.mobile !== 'same';
}
