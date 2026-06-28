import * as React from "react"

import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"
import { getStrictContext } from "@/lib/get-strict-context"

// ─── Context ────────────────────────────────────────────────────────────────

interface FormFieldContextValue {
  id: string
  name: string
  error?: string
  description?: string
}

const [FormFieldProvider, useFormFieldContext] =
  getStrictContext<FormFieldContextValue>("FormField")

// ─── FormField ──────────────────────────────────────────────────────────────

interface FormFieldProps {
  name: string
  error?: string
  description?: string
  className?: string
  children: React.ReactNode
}

function FormField({ name, error, description, className, children }: FormFieldProps) {
  const id = React.useId()
  return (
    <FormFieldProvider value={{ id, name, error, description }}>
      <div data-slot="form-field" className={cn("space-y-2", className)}>
        {children}
      </div>
    </FormFieldProvider>
  )
}

// ─── FormLabel ──────────────────────────────────────────────────────────────

function FormLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label>) {
  const { id, error } = useFormFieldContext()
  return (
    <Label
      data-slot="form-label"
      htmlFor={id}
      className={cn(error && "text-destructive", className)}
      {...props}
    />
  )
}

// ─── FormControl ────────────────────────────────────────────────────────────

function FormControl({
  children,
  ...props
}: React.ComponentProps<"div"> & { children: React.ReactElement }) {
  const { id, name, error, description } = useFormFieldContext()
  return React.cloneElement(children, {
    id,
    name,
    "aria-describedby": error
      ? `${id}-error`
      : description
        ? `${id}-description`
        : undefined,
    "aria-invalid": error ? true : undefined,
    ...props,
  } as Record<string, unknown>)
}

// ─── FormDescription ────────────────────────────────────────────────────────

function FormDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  const { id } = useFormFieldContext()
  return (
    <p
      data-slot="form-description"
      id={`${id}-description`}
      className={cn("text-[0.8rem] text-muted-foreground", className)}
      {...props}
    />
  )
}

// ─── FormMessage ────────────────────────────────────────────────────────────

function FormMessage({
  className,
  children,
  ...props
}: React.ComponentProps<"p">) {
  const { id, error } = useFormFieldContext()
  const body = error ?? children
  if (!body) return null

  return (
    <p
      data-slot="form-message"
      id={`${id}-error`}
      role="alert"
      className={cn("text-[0.8rem] font-medium text-destructive", className)}
      {...props}
    >
      {body}
    </p>
  )
}

export {
  FormField,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  useFormFieldContext,
}
