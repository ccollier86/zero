/** Public navbar and Hero sections. Curated client-safe re-exports only; implementation/context ownership stays with the existing modules. */

// ─── Public Page Components ────────────────────────────────────────────
export { ResizableNavbar } from '../../../components/navbar';
export type {
  ResizableNavbarAction,
  ResizableNavbarBrand,
  ResizableNavbarItem,
  ResizableNavbarProps,
} from '../../../components/navbar';
export {
  Hero,
  HeroActions,
  HeroBackground,
  HeroImageBackground,
  WavyBackground,
} from '../../../components/hero';
export type {
  HeroAction,
  HeroBackgroundOptions,
  HeroBackgroundPreset,
  HeroImageBackgroundProps,
  HeroProps,
  WavyBackgroundProps,
} from '../../../components/hero';
