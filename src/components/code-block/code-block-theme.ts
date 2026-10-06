/** One CSS-variable syntax theme, shared across light/dark and SSR/client rendering. */
import { createCssVariablesTheme } from 'shiki/core';

/** All syntax colors resolve through Zero tokens instead of a fixed vendor palette. */
export const zeroCodeBlockTheme = createCssVariablesTheme({
  name: 'zero-tokens', variablePrefix: '--zero-code-', fontStyle: true,
});
