/**
 * navbar/index.ts
 *
 * Public Zero export for reusable navigation bars. This file owns the stable
 * package path; individual components own rendering and behavior.
 */

export { ResizableNavbar } from './resizable-navbar';
export type {
  ResizableNavbarAction,
  ResizableNavbarBrand,
  ResizableNavbarItem,
  ResizableNavbarProps,
} from './resizable-navbar.types';
