'use client';

import * as React from 'react';
import { XIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

// ─── Types ───────────────────────────────────────────────────────────────

export interface TagInputProps {
  value?: string[];
  onChange?: (tags: string[]) => void;
  placeholder?: string;
  maxTags?: number;
  allowDuplicates?: boolean;
  delimiter?: string;
  disabled?: boolean;
  className?: string;
  tagClassName?: string;
  suggestions?: string[];
  onSearch?: (query: string) => void;
}

// ─── Component ───────────────────────────────────────────────────────────

function TagInput({
  value = [],
  onChange,
  placeholder = 'Add tag...',
  maxTags,
  allowDuplicates = false,
  delimiter = ',',
  disabled = false,
  className,
  tagClassName,
  suggestions,
  onSearch,
}: TagInputProps) {
  const [inputValue, setInputValue] = React.useState('');
  const [showSuggestions, setShowSuggestions] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const tags = value;

  const addTag = React.useCallback(
    (tag: string) => {
      const trimmed = tag.trim();
      if (!trimmed) return;
      if (!allowDuplicates && tags.includes(trimmed)) return;
      if (maxTags != null && tags.length >= maxTags) return;
      onChange?.([...tags, trimmed]);
      setInputValue('');
      setShowSuggestions(false);
    },
    [tags, onChange, allowDuplicates, maxTags],
  );

  const removeTag = React.useCallback(
    (index: number) => {
      const next = [...tags];
      next.splice(index, 1);
      onChange?.(next);
      inputRef.current?.focus();
    },
    [tags, onChange],
  );

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addTag(inputValue);
      } else if (e.key === 'Backspace' && inputValue === '' && tags.length > 0) {
        removeTag(tags.length - 1);
      }
    },
    [inputValue, addTag, removeTag, tags.length],
  );

  const handleInputChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;

      // Check for delimiter
      if (delimiter && val.includes(delimiter)) {
        const parts = val.split(delimiter);
        for (const part of parts) {
          addTag(part);
        }
        return;
      }

      setInputValue(val);
      onSearch?.(val);
      // Don't gate on current suggestions length — async onSearch may populate them later
      setShowSuggestions(val.length > 0);
    },
    [delimiter, addTag, onSearch],
  );

  const filteredSuggestions = React.useMemo(() => {
    if (!suggestions || !inputValue) return [];
    const lower = inputValue.toLowerCase();
    return suggestions.filter(
      (s) =>
        s.toLowerCase().includes(lower) &&
        (allowDuplicates || !tags.includes(s)),
    );
  }, [suggestions, inputValue, tags, allowDuplicates]);

  // Close suggestions on outside click
  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const atLimit = maxTags != null && tags.length >= maxTags;

  return (
    <div ref={containerRef} className="relative" data-slot="tag-input">
      <div
        className={cn(
          'flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 shadow-xs transition-[border-color,box-shadow,color]',
          'hover:border-border-strong focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-bg-inset/45',
          disabled && 'cursor-not-allowed opacity-50',
          className,
        )}
        onClick={() => inputRef.current?.focus()}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {tags.map((tag, index) => (
            <motion.div
              key={allowDuplicates ? `${tag}-${index}` : tag}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              layout
            >
              <Badge
                variant="secondary"
                className={cn('gap-1 pr-1', tagClassName)}
              >
                {tag}
                {!disabled && (
                  <button
                    type="button"
                    className="rounded-full p-0.5 hover:bg-accent"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeTag(index);
                    }}
                  >
                    <XIcon className="size-3" />
                  </button>
                )}
              </Badge>
            </motion.div>
          ))}
        </AnimatePresence>

        {!atLimit && (
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={tags.length === 0 ? placeholder : ''}
            disabled={disabled}
            className="min-w-[80px] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        )}
      </div>

      {/* Suggestions dropdown */}
      {showSuggestions && filteredSuggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border/85 bg-popover text-popover-foreground shadow-lg dark:shadow-none">
          {filteredSuggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="flex w-full items-center px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
              onClick={() => addTag(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export { TagInput };
