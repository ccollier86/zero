import * as React from 'react';
import type { FieldMeta } from '../../schema/field-types';
import type { FieldRegistration } from '../../hooks/use-form';
import { Input } from '#zero/components/ui/input';
import { Textarea } from '#zero/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#zero/components/ui/select';
import { Checkbox } from '#zero/components/animate-ui/components/radix/checkbox';
import { Switch } from '#zero/components/animate-ui/components/radix/switch';
import {
  FormField,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from '#zero/components/ui/form-field';
import { DatePicker } from '#zero/components/ui/date-picker';
import { DateRangePicker } from '#zero/components/ui/date-range-picker';
import { TagInput } from '#zero/components/ui/tag-input';
import { Combobox } from '#zero/components/ui/combobox';
import type { DateRange } from 'react-day-picker';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FieldRendererProps {
  name: string;
  meta: FieldMeta;
  registration: FieldRegistration;
  overrides?: {
    autoFocus?: boolean;
    hidden?: boolean;
    useSwitch?: boolean;
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

export function FieldRenderer({
  name,
  meta,
  registration,
  overrides,
}: FieldRendererProps) {
  if (meta.type === 'hidden' || overrides?.hidden) return null;

  const label = meta.label ?? formatLabel(name);
  const { value, onChange, onBlur, error, ref } = registration;

  return (
    <FormField name={name} error={error} description={meta.description}>
      <FormLabel>{label}</FormLabel>
      <FormControl>
        {renderInput(meta, {
          value,
          onChange,
          onBlur,
          ref,
          autoFocus: overrides?.autoFocus,
          useSwitch: overrides?.useSwitch,
        })}
      </FormControl>
      {meta.description && <FormDescription>{meta.description}</FormDescription>}
      <FormMessage />
    </FormField>
  );
}

// ─── Input Renderer ─────────────────────────────────────────────────────────

function renderInput(
  meta: FieldMeta,
  props: {
    value: unknown;
    onChange: (v: unknown) => void;
    onBlur: () => void;
    ref: (el: HTMLElement | null) => void;
    autoFocus?: boolean;
    useSwitch?: boolean;
  },
): React.ReactElement {
  const { value, onChange, onBlur, ref, autoFocus, useSwitch } = props;

  switch (meta.type) {
    case 'text':
    case 'email':
    case 'url':
    case 'password':
      return (
        <Input
          type={meta.type}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          ref={ref as any}
          placeholder={meta.placeholder}
          autoFocus={autoFocus}
          min={meta.min}
          max={meta.max}
        />
      );

    case 'number':
      return (
        <Input
          type="number"
          value={value === '' || value == null ? '' : String(value)}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === '' ? '' : Number(v));
          }}
          onBlur={onBlur}
          ref={ref as any}
          placeholder={meta.placeholder}
          autoFocus={autoFocus}
          min={meta.min}
          max={meta.max}
        />
      );

    case 'textarea':
      return (
        <Textarea
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          ref={ref as any}
          placeholder={meta.placeholder}
          autoFocus={autoFocus}
          maxLength={meta.maxLength}
        />
      );

    case 'boolean':
      if (useSwitch) {
        return (
          <div className="flex items-center gap-2 pt-1">
            <Switch
              checked={value === true}
              onCheckedChange={(checked) => onChange(checked === true)}
              onBlur={onBlur}
              ref={ref as any}
            />
          </div>
        );
      }

      return (
        <div className="flex items-center gap-2 pt-1">
          <Checkbox
            checked={value as boolean}
            onCheckedChange={(checked) => onChange(checked === true)}
            onBlur={onBlur}
            ref={ref as any}
          />
        </div>
      );

    case 'select':
      return (
        <Select
          value={(value as string) ?? ''}
          onValueChange={(v) => onChange(v)}
        >
          <SelectTrigger ref={ref as any} onBlur={onBlur} autoFocus={autoFocus}>
            <SelectValue placeholder={meta.placeholder ?? 'Select...'} />
          </SelectTrigger>
          <SelectContent>
            {meta.options?.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case 'multiSelect':
      return (
        <div className="flex flex-col gap-2 pt-1" ref={ref as any}>
          {meta.options?.map((opt) => {
            const selected = Array.isArray(value) ? (value as string[]).includes(opt.value) : false;
            return (
              <label key={opt.value} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={selected}
                  onCheckedChange={(checked) => {
                    const current = Array.isArray(value) ? (value as string[]) : [];
                    onChange(
                      checked
                        ? [...current, opt.value]
                        : current.filter((v) => v !== opt.value),
                    );
                  }}
                />
                {opt.label}
              </label>
            );
          })}
        </div>
      );

    case 'date':
      return (
        <DatePicker
          value={value ? new Date(value as string) : undefined}
          onChange={(date) => onChange(date ? date.toISOString().split('T')[0] : '')}
          placeholder={meta.placeholder}
        />
      );

    case 'datetime':
      return (
        <DatePicker
          value={value ? new Date(value as string) : undefined}
          onChange={(date) => onChange(date ? date.toISOString() : '')}
          placeholder={meta.placeholder}
        />
      );

    case 'dateRange': {
      const rangeVal = Array.isArray(value) ? value as string[] : ['', ''];
      const range: DateRange | undefined =
        rangeVal[0] && rangeVal[1]
          ? { from: new Date(rangeVal[0]), to: new Date(rangeVal[1]) }
          : undefined;
      return (
        <DateRangePicker
          value={range}
          onChange={(r) => {
            if (r?.from && r?.to) {
              onChange([r.from.toISOString().split('T')[0], r.to.toISOString().split('T')[0]]);
            } else {
              onChange(['', '']);
            }
          }}
          placeholder={meta.placeholder}
        />
      );
    }

    case 'tags':
      return (
        <TagInput
          value={Array.isArray(value) ? (value as string[]) : []}
          onChange={(tags) => onChange(tags)}
          placeholder={meta.placeholder}
          maxTags={meta.maxTags}
        />
      );

    case 'combobox':
      return (
        <Combobox
          value={value as string | string[]}
          onChange={(v) => onChange(v)}
          options={meta.options?.map((o) => ({ value: o.value, label: o.label })) ?? []}
          multiple={meta.multiple}
          searchable={meta.searchable ?? true}
          placeholder={meta.placeholder}
        />
      );

    case 'json':
      return (
        <Textarea
          value={typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? ''}
          onChange={(e) => {
            try {
              onChange(JSON.parse(e.target.value));
            } catch {
              onChange(e.target.value);
            }
          }}
          onBlur={onBlur}
          ref={ref as any}
          placeholder={meta.placeholder ?? 'JSON...'}
          autoFocus={autoFocus}
          className="font-mono text-xs"
          rows={4}
        />
      );

    case 'enum':
      return (
        <Select
          value={(value as string) ?? ''}
          onValueChange={(v) => onChange(v)}
        >
          <SelectTrigger ref={ref as any} onBlur={onBlur} autoFocus={autoFocus}>
            <SelectValue placeholder={meta.placeholder ?? 'Select...'} />
          </SelectTrigger>
          <SelectContent>
            {meta.options?.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    default:
      return (
        <Input
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          ref={ref as any}
          autoFocus={autoFocus}
        />
      );
  }
}

// ─── Utility ────────────────────────────────────────────────────────────────

/** Convert camelCase to Title Case. */
function formatLabel(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}
