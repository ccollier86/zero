'use client';

import * as React from 'react';
import { CheckIcon, ChevronsUpDownIcon, XIcon } from 'lucide-react';
import { AnimatePresence, motion, type Transition } from 'motion/react';

import { cn } from '#zero/lib/utils';
import { Button } from '#zero/components/ui/button';
import { Badge } from '#zero/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#zero/components/animate-ui/components/radix/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '#zero/components/ui/command';

// ─── Types ───────────────────────────────────────────────────────────────

export interface ComboboxOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
  description?: string;
  group?: string;
  disabled?: boolean;
}

export interface ComboboxProps {
  value?: string | string[];
  onChange?: (value: string | string[]) => void;
  options: ComboboxOption[];
  multiple?: boolean;
  searchable?: boolean;
  placeholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
  transition?: Transition;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function groupOptions(options: ComboboxOption[]): Map<string | undefined, ComboboxOption[]> {
  const groups = new Map<string | undefined, ComboboxOption[]>();
  for (const opt of options) {
    const key = opt.group;
    const list = groups.get(key);
    if (list) {
      list.push(opt);
    } else {
      groups.set(key, [opt]);
    }
  }
  return groups;
}

// ─── Component ───────────────────────────────────────────────────────────

function Combobox({
  value,
  onChange,
  options,
  multiple = false,
  searchable = true,
  placeholder = 'Select...',
  emptyMessage = 'No results found.',
  disabled = false,
  className,
  transition,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);

  const selectedValues = React.useMemo<string[]>(() => {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
  }, [value]);

  const selectedLabels = React.useMemo(() => {
    return selectedValues
      .map((v) => options.find((o) => o.value === v))
      .filter(Boolean) as ComboboxOption[];
  }, [selectedValues, options]);

  const handleSelect = React.useCallback(
    (optionValue: string) => {
      if (multiple) {
        const current = Array.isArray(value) ? value : [];
        const next = current.includes(optionValue)
          ? current.filter((v) => v !== optionValue)
          : [...current, optionValue];
        onChange?.(next);
      } else {
        onChange?.(optionValue === (value as string) ? '' : optionValue);
        setOpen(false);
      }
    },
    [value, onChange, multiple],
  );

  const handleRemoveTag = React.useCallback(
    (optionValue: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!multiple || !Array.isArray(value)) return;
      onChange?.(value.filter((v) => v !== optionValue));
    },
    [value, onChange, multiple],
  );

  const grouped = React.useMemo(() => groupOptions(options), [options]);

  // ─── Trigger Content ────────────────────────────────────────────────

  function renderTriggerContent() {
    if (multiple && selectedLabels.length > 0) {
      return (
        <div className="flex flex-wrap gap-1">
          <AnimatePresence mode="popLayout">
            {selectedLabels.map((opt) => (
              <motion.div
                key={opt.value}
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.5 }}
                transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              >
                <Badge variant="secondary" className="gap-1 pr-1">
                  {opt.icon && <span className="shrink-0">{opt.icon}</span>}
                  {opt.label}
                  <button
                    type="button"
                    className="ml-0.5 rounded-full p-0.5 hover:bg-accent"
                    onClick={(e) => handleRemoveTag(opt.value, e)}
                  >
                    <XIcon className="size-3" />
                  </button>
                </Badge>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      );
    }

    if (!multiple && selectedLabels.length === 1) {
      const opt = selectedLabels[0];
      return (
        <span className="flex items-center gap-2 truncate">
          {opt.icon && <span className="shrink-0">{opt.icon}</span>}
          {opt.label}
        </span>
      );
    }

    return <span className="text-muted-foreground">{placeholder}</span>;
  }

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          data-slot="combobox-trigger"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'w-full justify-between font-normal h-auto min-h-9',
            className,
          )}
        >
          {renderTriggerContent()}
          <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" transition={transition}>
        <Command>
          {searchable && <CommandInput placeholder="Search..." />}
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            {Array.from(grouped.entries()).map(([group, groupOptions]) => {
              const content = groupOptions.map((opt) => (
                <CommandItem
                  key={opt.value}
                  value={opt.value}
                  keywords={[opt.label, opt.description ?? ''].filter(Boolean)}
                  disabled={opt.disabled}
                  onSelect={handleSelect}
                >
                  <span
                    className={cn(
                      'mr-2 flex size-4 shrink-0 items-center justify-center',
                      selectedValues.includes(opt.value) ? 'opacity-100' : 'opacity-0',
                    )}
                  >
                    <CheckIcon className="size-4" />
                  </span>
                  {opt.icon && <span className="shrink-0">{opt.icon}</span>}
                  <div className="flex flex-col">
                    <span>{opt.label}</span>
                    {opt.description && (
                      <span className="text-muted-foreground text-xs">
                        {opt.description}
                      </span>
                    )}
                  </div>
                </CommandItem>
              ));

              if (group) {
                return (
                  <CommandGroup key={group} heading={group}>
                    {content}
                  </CommandGroup>
                );
              }
              return <React.Fragment key="__ungrouped">{content}</React.Fragment>;
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export { Combobox };
