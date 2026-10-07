/** Reuses Zero's native Input and only captures draft text before the upstream formatter handles the event. */
import { forwardRef, type ComponentProps } from 'react';
import { Input } from '#zero/components/ui/input';
import { cn } from '#zero/lib/utils';
import { usePhoneInputPresentation } from './phone-input-context';

export const PhoneInputNative = forwardRef<HTMLInputElement, ComponentProps<typeof Input>>(
  function PhoneInputNative({ className, onChange, ...props }, ref) {
    const context = usePhoneInputPresentation();
    return <Input {...props} ref={ref} aria-invalid={context.invalid}
      wrapperClassName="min-w-0 flex-1 rounded-s-none"
      className={cn('rounded-s-none', context.variant === 'sm' ? 'h-7' : context.variant === 'lg' ? 'h-9' : 'h-8', context.inputClassName, className)}
      onChange={event => {
        if (context.interaction.current.readOnly || context.interaction.current.disabled) return;
        context.rawDraft.current = event.currentTarget.value;
        onChange?.(event);
      }} />;
  },
);
