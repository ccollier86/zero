/** Native field-label presentation with optional type-role tokens; Radix retains association and disabled semantics. */
import * as React from "react"
import { Label as LabelPrimitive } from "radix-ui"

import { cn } from "#zero/lib/utils"

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-[length:var(--zero-type-label-size,var(--text-sm,.875rem))] font-[family-name:var(--zero-theme-font-body,inherit)] font-[number:var(--zero-type-label-weight,var(--font-weight-medium,500))] leading-[var(--zero-type-label-leading,1)] tracking-[var(--zero-type-label-tracking,inherit)] select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
