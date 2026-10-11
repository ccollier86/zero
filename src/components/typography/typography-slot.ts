/** Enforce one actual Slot element; fragments cannot receive typography or refs. */

import * as React from 'react';

/** Validate asChild's composition boundary without transforming canonical text. */
export function assertTypographySlotChild(children: React.ReactNode): void {
  if (!React.isValidElement(children) || children.type === React.Fragment) {
    throw new TypeError('Typography asChild requires one non-Fragment React element.');
  }
}
