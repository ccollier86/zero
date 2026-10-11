/** Public consumer fixture for the pure foundation; no DOM, frontend providers or backend configuration. */
import { createThemeAttributes, createThemeDeclarations, createThemeTokens, getThemeTokenCatalog, renderThemeFoundationCss, resolveThemeMotion,
  getTypographyRecipe, TYPOGRAPHY_SCALE } from '@zero/framework/design-system';

export const attributes = createThemeAttributes({ mode: 'system', density: 'compact' });
export const tokens = createThemeTokens({ mode: 'dark' });
export const declarations = createThemeDeclarations({ mode: 'dark', density: 'touch' });
export const catalog = getThemeTokenCatalog();
export const stylesheet = renderThemeFoundationCss();
export const motion = resolveThemeMotion({ reducedMotion: true });
export const typography = getTypographyRecipe('page');
export const typeScale = TYPOGRAPHY_SCALE;
