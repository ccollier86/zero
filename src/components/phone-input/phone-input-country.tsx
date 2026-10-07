/** Country selection composes existing Zero Popover/Command/ScrollArea controls; upstream owns number conversion. */
import { useEffect, useState } from 'react';
import { getCountryCallingCode, type Country } from 'react-phone-number-input';
import { Button } from '#zero/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '#zero/components/ui/command';
import { ScrollArea } from '#zero/components/ui/scroll-area';
import { Check, ChevronDown } from '../../frontend/icons';
import { cn } from '#zero/lib/utils';
import { PhoneInputFlag } from './phone-input-flag';
import { usePhoneInputPresentation } from './phone-input-context';

interface CountrySelectProps {
  readonly value?: Country;
  readonly options: readonly { readonly value?: Country; readonly label: string }[];
  readonly onChange: (country: Country | undefined) => void;
  readonly onFocus?: () => void;
  readonly onBlur?: () => void;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
  readonly 'aria-label'?: string;
}
/** Read-only replaces the selector with a static country prefix, never a disabled dropdown. */
export function PhoneInputCountry({ value, options, onChange, onFocus, onBlur, disabled, readOnly, 'aria-label': label = 'Country' }: CountrySelectProps) {
  const context = usePhoneInputPresentation(), [open, setOpen] = useState(false);
  const locked = !!(readOnly || context.readOnly), unavailable = !!(disabled || context.disabled);
  const countryLabel = options.find(option => option.value === value)?.label ?? value ?? 'International';
  const prefix = value ? `+${getCountryCallingCode(value)}` : '';
  useEffect(() => { if (locked || unavailable) setOpen(false); }, [locked, unavailable]);
  const sharedClass = cn('rounded-s-md rounded-e-none border-e-0 px-2.5 shadow-none', context.variant === 'sm' ? 'h-8' : context.variant === 'lg' ? 'h-10' : 'h-9');
  if (locked) return <span role="img" data-slot="phone-input-country-readonly" aria-label={`${label}: ${countryLabel}${prefix ? ` (${prefix})` : ''}`} className={cn('inline-flex shrink-0 items-center gap-2 border border-border bg-background text-foreground', sharedClass, unavailable && 'opacity-50')}>
    <PhoneInputFlag country={value} title={countryLabel} /><span className="text-sm text-muted-foreground">{prefix}</span>
  </span>;
  return <Popover open={open && !locked && !unavailable} onOpenChange={next => {
    if (context.interaction.current.readOnly || context.interaction.current.disabled || unavailable) return;
    setOpen(next);
  }}>
    <PopoverTrigger asChild><Button type="button" variant="outline" size={context.variant} disabled={unavailable} animateIcon={false}
      data-slot="phone-input-country" aria-label={`${label}: ${countryLabel}${prefix ? ` (${prefix})` : ''}`} aria-invalid={context.invalid}
      onFocus={onFocus} onBlur={onBlur} className={cn(sharedClass, 'gap-1.5 focus-visible:z-10')}>
      <PhoneInputFlag country={value} title={countryLabel} /><ChevronDown className="size-3 text-muted-foreground" />
    </Button></PopoverTrigger>
    <PopoverContent align="start" collisionPadding={12} className={cn('w-72 max-w-[calc(100vw-var(--spacing)*6)] p-0', context.popupClassName)}>
      <Command label="Search countries">
        <CommandInput placeholder="e.g. United States" aria-label="Search countries" />
        <CommandEmpty>No country found.</CommandEmpty>
        <CommandList className="max-h-none overflow-hidden" label="Phone countries">
          <ScrollArea className={cn('h-64 max-h-[calc(var(--radix-popover-content-available-height)-var(--spacing)*14)] min-h-0 overscroll-contain [&_[data-radix-scroll-area-viewport]>div]:!block', context.scrollAreaClassName)}>
            <CommandGroup className="w-full min-w-0">{options.filter(option => option.value).map(option => <CommandItem key={option.value} value={`${option.label} ${option.value} +${getCountryCallingCode(option.value!)}`}
              onSelect={() => {
                if (context.interaction.current.readOnly || context.interaction.current.disabled || locked || unavailable) return;
                setOpen(false); onChange(option.value);
              }}>
              <PhoneInputFlag country={option.value} title={option.label} /><span className="min-w-0 flex-1 truncate">{option.label}</span>
              <span data-slot="phone-input-calling-code" className="shrink-0 text-muted-foreground">+{getCountryCallingCode(option.value!)}</span>
              <Check aria-hidden="true" className={cn('size-4', value === option.value ? 'opacity-100' : 'opacity-0')} />
            </CommandItem>)}</CommandGroup>
          </ScrollArea>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>;
}
