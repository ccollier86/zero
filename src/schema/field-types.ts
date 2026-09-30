import * as v from 'valibot';
import {
  GUARDIAN_MEMBERSHIP_REFERENCE,
  GUARDIAN_USER_REFERENCE,
  type GuardianReferenceDefinition,
} from './guardian-references';

// ─── Field Type Definitions ─────────────────────────────────────────────────

export type FieldType =
  | 'text'
  | 'email'
  | 'url'
  | 'password'
  | 'number'
  | 'boolean'
  | 'select'
  | 'multiSelect'
  | 'textarea'
  | 'date'
  | 'datetime'
  | 'hidden'
  | 'json'
  | 'enum'
  | 'tags'
  | 'combobox'
  | 'dateRange';

export interface FieldMeta {
  type: FieldType;
  label?: string;
  placeholder?: string;
  description?: string;
  required: boolean;
  defaultValue?: unknown;
  options?: Array<{ label: string; value: string }>;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  tableVisible?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  columnWidth?: number;
  // Tags-specific
  maxTags?: number;
  // Combobox-specific
  searchable?: boolean;
  multiple?: boolean;
  optionIcon?: boolean;
  optionDescription?: boolean;
}

export interface FieldDef<
  TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>> = v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
  /** Phantom type representing the TypeScript type for this field in client-side rows. */
  TOutput = unknown,
> {
  readonly _schema: TSchema;
  readonly _meta: FieldMeta;
  readonly _sqlType: string;
  readonly _clientType: string;
  /** @internal Server-side identity projection metadata. Never an auth claim. */
  readonly _guardianReference?: GuardianReferenceDefinition;
  /** @internal Phantom — not used at runtime. Carries the TS type for InferRow. */
  readonly _output?: TOutput;
}

// ─── Options for each builder ───────────────────────────────────────────────

interface TextOptions {
  label?: string;
  placeholder?: string;
  description?: string;
  required?: boolean;
  defaultValue?: string;
  minLength?: number;
  maxLength?: number;
  tableVisible?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  columnWidth?: number;
}

interface NumberOptions {
  label?: string;
  placeholder?: string;
  description?: string;
  required?: boolean;
  defaultValue?: number;
  min?: number;
  max?: number;
  integer?: boolean;
  tableVisible?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  columnWidth?: number;
}

interface BooleanOptions {
  label?: string;
  description?: string;
  required?: boolean;
  defaultValue?: boolean;
  tableVisible?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  columnWidth?: number;
}

interface SelectOptions {
  label?: string;
  placeholder?: string;
  description?: string;
  required?: boolean;
  defaultValue?: string;
  tableVisible?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  columnWidth?: number;
}

interface MultiSelectOptions {
  label?: string;
  description?: string;
  required?: boolean;
  defaultValue?: string[];
  tableVisible?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  columnWidth?: number;
}

interface DateOptions {
  label?: string;
  placeholder?: string;
  description?: string;
  required?: boolean;
  defaultValue?: string;
  tableVisible?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  columnWidth?: number;
}

interface HiddenOptions {
  defaultValue?: unknown;
}

/** Options for a server-owned Guardian identity reference. */
export interface GuardianReferenceOptions {
  label?: string;
  description?: string;
  required?: boolean;
  tableVisible?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  columnWidth?: number;
}

// ─── Helper: build meta from common options ─────────────────────────────────

function baseMeta(
  type: FieldType,
  opts: {
    label?: string;
    placeholder?: string;
    description?: string;
    required?: boolean;
    defaultValue?: unknown;
    options?: Array<{ label: string; value: string }>;
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    tableVisible?: boolean;
    sortable?: boolean;
    filterable?: boolean;
    columnWidth?: number;
    maxTags?: number;
    searchable?: boolean;
    multiple?: boolean;
    optionIcon?: boolean;
    optionDescription?: boolean;
  },
): FieldMeta {
  return {
    type,
    label: opts.label,
    placeholder: opts.placeholder,
    description: opts.description,
    required: opts.required ?? false,
    defaultValue: opts.defaultValue,
    options: opts.options,
    min: opts.min,
    max: opts.max,
    minLength: opts.minLength,
    maxLength: opts.maxLength,
    tableVisible: opts.tableVisible,
    sortable: opts.sortable,
    filterable: opts.filterable,
    columnWidth: opts.columnWidth,
    maxTags: opts.maxTags,
    searchable: opts.searchable,
    multiple: opts.multiple,
    optionIcon: opts.optionIcon,
    optionDescription: opts.optionDescription,
  };
}

// ─── Field Builders ─────────────────────────────────────────────────────────

function text(opts: TextOptions = {}): FieldDef<any, string> {
  const { required = false, minLength, maxLength } = opts;
  const pipes: v.PipeItem<string, string, v.BaseIssue<unknown>>[] = [];
  if (required || minLength) {
    pipes.push(v.minLength(minLength ?? 1));
  }
  if (maxLength) {
    pipes.push(v.maxLength(maxLength));
  }
  const base = v.pipe(v.string(), ...pipes);
  const schema = required ? base : v.optional(base, opts.defaultValue ?? '');
  const sqlDefault = opts.defaultValue != null ? ` default '${opts.defaultValue}'` : '';
  return {
    _schema: schema as any,
    _meta: baseMeta('text', { ...opts, required }),
    _sqlType: required ? 'text not null' : `text${sqlDefault}`,
    _clientType: 'text',
  };
}

function email(opts: TextOptions = {}): FieldDef<any, string> {
  const { required = false } = opts;
  const base = v.pipe(v.string(), v.email());
  const schema = required ? base : v.optional(base, opts.defaultValue ?? '');
  return {
    _schema: schema as any,
    _meta: baseMeta('email', { ...opts, required }),
    _sqlType: required ? 'text not null' : 'text',
    _clientType: 'text',
  };
}

function url(opts: TextOptions = {}): FieldDef<any, string> {
  const { required = false } = opts;
  const base = v.pipe(v.string(), v.url());
  const schema = required ? base : v.optional(base, opts.defaultValue ?? '');
  return {
    _schema: schema as any,
    _meta: baseMeta('url', { ...opts, required }),
    _sqlType: required ? 'text not null' : 'text',
    _clientType: 'text',
  };
}

function password(opts: TextOptions = {}): FieldDef<any, string> {
  const { required = false, minLength = 8, maxLength } = opts;
  const pipes: v.PipeItem<string, string, v.BaseIssue<unknown>>[] = [v.minLength(minLength)];
  if (maxLength) pipes.push(v.maxLength(maxLength));
  const base = v.pipe(v.string(), ...pipes);
  const schema = required ? base : v.optional(base, '');
  return {
    _schema: schema as any,
    _meta: baseMeta('password', { ...opts, required, minLength, maxLength, tableVisible: false }),
    _sqlType: required ? 'text not null' : 'text',
    _clientType: 'text',
  };
}

function number(opts: NumberOptions = {}): FieldDef<any, number> {
  const { required = false, min, max, integer = false } = opts;
  const pipes: v.PipeItem<number, number, v.BaseIssue<unknown>>[] = [];
  if (integer) pipes.push(v.integer());
  if (min != null) pipes.push(v.minValue(min));
  if (max != null) pipes.push(v.maxValue(max));
  const base = pipes.length > 0 ? v.pipe(v.number(), ...pipes) : v.number();
  const schema = required ? base : v.optional(base, opts.defaultValue ?? 0);
  const sqlType = integer ? 'integer' : 'real';
  const sqlDefault = opts.defaultValue != null ? ` default ${opts.defaultValue}` : '';
  return {
    _schema: schema as any,
    _meta: baseMeta('number', { ...opts, required, min, max }),
    _sqlType: required ? `${sqlType} not null` : `${sqlType}${sqlDefault}`,
    _clientType: integer ? 'integer' : 'real',
  };
}

function boolean(opts: BooleanOptions = {}): FieldDef<any, boolean> {
  const required = opts.required ?? false;
  const defaultVal = opts.defaultValue ?? false;
  const schema = required ? v.boolean() : v.optional(v.boolean(), defaultVal);
  return {
    _schema: schema as any,
    _meta: baseMeta('boolean', { ...opts, required, defaultValue: defaultVal }),
    _sqlType: `integer${required ? ' not null' : ''} default ${defaultVal ? 1 : 0}`,
    _clientType: 'integer',
  };
}

function select(
  options: Array<{ label: string; value: string }>,
  opts: SelectOptions = {},
): FieldDef<any, string> {
  const { required = false } = opts;
  const values = options.map((o) => o.value) as [string, ...string[]];
  const base = v.picklist(values);
  const schema = required ? base : v.optional(base, opts.defaultValue ?? '');
  return {
    _schema: schema as any,
    _meta: baseMeta('select', { ...opts, required, options }),
    _sqlType: required ? 'text not null' : 'text',
    _clientType: 'text',
  };
}

function multiSelect(
  options: Array<{ label: string; value: string }>,
  opts: MultiSelectOptions = {},
): FieldDef<any, string> {
  const { required = false } = opts;
  const values = options.map((o) => o.value) as [string, ...string[]];
  const base = v.array(v.picklist(values));
  const schema = required ? v.pipe(base, v.minLength(1)) : v.optional(base, opts.defaultValue ?? []);
  return {
    _schema: schema as any,
    _meta: baseMeta('multiSelect', { ...opts, required, options }),
    _sqlType: 'text',  // stored as JSON
    _clientType: 'text',
  };
}

function textarea(opts: TextOptions = {}): FieldDef<any, string> {
  const { required = false, minLength, maxLength } = opts;
  const pipes: v.PipeItem<string, string, v.BaseIssue<unknown>>[] = [];
  if (required || minLength) pipes.push(v.minLength(minLength ?? 1));
  if (maxLength) pipes.push(v.maxLength(maxLength));
  const base = v.pipe(v.string(), ...pipes);
  const schema = required ? base : v.optional(base, opts.defaultValue ?? '');
  return {
    _schema: schema as any,
    _meta: baseMeta('textarea', { ...opts, required, minLength, maxLength }),
    _sqlType: required ? 'text not null' : 'text',
    _clientType: 'text',
  };
}

function date(opts: DateOptions = {}): FieldDef<any, string> {
  const { required = false } = opts;
  const base = v.pipe(v.string(), v.isoDate());
  const schema = required ? base : v.optional(base, opts.defaultValue ?? '');
  return {
    _schema: schema as any,
    _meta: baseMeta('date', { ...opts, required }),
    _sqlType: required ? 'text not null' : 'text',
    _clientType: 'text',
  };
}

function datetime(opts: DateOptions = {}): FieldDef<any, string> {
  const { required = false } = opts;
  const base = v.pipe(v.string(), v.isoTimestamp());
  const schema = required ? base : v.optional(base, opts.defaultValue ?? '');
  return {
    _schema: schema as any,
    _meta: baseMeta('datetime', { ...opts, required }),
    _sqlType: required ? 'text not null' : 'text',
    _clientType: 'text',
  };
}

interface JsonOptions {
  label?: string;
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
  tableVisible?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  columnWidth?: number;
}

interface EnumOptions {
  label?: string;
  placeholder?: string;
  description?: string;
  required?: boolean;
  defaultValue?: string;
  tableVisible?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  columnWidth?: number;
}

/**
 * JSON field — stored as text in SQLite, parsed/serialized automatically.
 * Renders as a textarea in forms. Use for arbitrary structured data.
 */
function json(opts: JsonOptions = {}): FieldDef<any, string> {
  const { required = false } = opts;
  const base = v.unknown();
  const schema = required
    ? v.pipe(base, v.check((val) => val != null && val !== '', 'Required'))
    : v.optional(base, opts.defaultValue ?? null);
  return {
    _schema: schema as any,
    _meta: baseMeta('json', { ...opts, required }),
    _sqlType: required ? 'text not null' : 'text',
    _clientType: 'text',
  };
}

/**
 * Enum field — like select but defined by string literal values (no label/value pairs).
 * Automatically generates options from the values array.
 */
function enumField(
  values: readonly [string, ...string[]],
  opts: EnumOptions = {},
): FieldDef<any, string> {
  const { required = false } = opts;
  const base = v.picklist(values);
  const schema = required ? base : v.optional(base, opts.defaultValue ?? '');
  const options = values.map((val) => ({
    label: val.charAt(0).toUpperCase() + val.slice(1).replace(/([A-Z])/g, ' $1'),
    value: val,
  }));
  return {
    _schema: schema as any,
    _meta: baseMeta('enum', { ...opts, required, options }),
    _sqlType: required ? 'text not null' : 'text',
    _clientType: 'text',
  };
}

interface TagsOptions {
  label?: string;
  placeholder?: string;
  description?: string;
  required?: boolean;
  defaultValue?: string[];
  maxTags?: number;
  tableVisible?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  columnWidth?: number;
}

interface ComboboxOptions {
  label?: string;
  placeholder?: string;
  description?: string;
  required?: boolean;
  defaultValue?: string | string[];
  multiple?: boolean;
  searchable?: boolean;
  optionIcon?: boolean;
  optionDescription?: boolean;
  tableVisible?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  columnWidth?: number;
}

interface DateRangeOptions {
  label?: string;
  placeholder?: string;
  description?: string;
  required?: boolean;
  tableVisible?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  columnWidth?: number;
}

/**
 * Tags field — stored as JSON text in SQLite, validated as array of strings.
 * Renders as a TagInput in forms.
 */
function tags(opts: TagsOptions = {}): FieldDef<any, string> {
  const { required = false } = opts;
  const base = v.array(v.string());
  const schema = required
    ? v.pipe(base, v.minLength(1))
    : v.optional(base, opts.defaultValue ?? []);
  return {
    _schema: schema as any,
    _meta: baseMeta('tags', { ...opts, required }),
    _sqlType: 'text', // stored as JSON
    _clientType: 'text',
  };
}

/**
 * Combobox field — searchable dropdown. Stored as text (single) or JSON text (multiple).
 * Renders as a Combobox in forms.
 */
function combobox(
  options: Array<{ label: string; value: string }>,
  opts: ComboboxOptions = {},
): FieldDef<any, string> {
  const { required = false, multiple = false } = opts;
  const values = options.map((o) => o.value) as [string, ...string[]];

  if (multiple) {
    const base = v.array(v.picklist(values));
    const schema = required
      ? v.pipe(base, v.minLength(1))
      : v.optional(base, (opts.defaultValue as string[]) ?? []);
    return {
      _schema: schema as any,
      _meta: baseMeta('combobox', { ...opts, required, options, multiple }),
      _sqlType: 'text', // stored as JSON
      _clientType: 'text',
    };
  }

  const base = v.picklist(values);
  const schema = required ? base : v.optional(base, (opts.defaultValue as string) ?? '');
  return {
    _schema: schema as any,
    _meta: baseMeta('combobox', { ...opts, required, options, multiple }),
    _sqlType: required ? 'text not null' : 'text',
    _clientType: 'text',
  };
}

/**
 * Date range field — stored as JSON text '["start","end"]' in SQLite.
 * Renders as a DateRangePicker in forms.
 */
function dateRange(opts: DateRangeOptions = {}): FieldDef<any, string> {
  const { required = false } = opts;
  const dateStr = v.union([v.pipe(v.string(), v.isoDate()), v.literal('')]);
  const base = v.tuple([dateStr, dateStr]);
  const schema = required
    ? v.pipe(base, v.check((val) => val[0] !== '' && val[1] !== '', 'Both dates required'))
    : v.optional(base, ['', '']);
  return {
    _schema: schema as any,
    _meta: baseMeta('dateRange', { ...opts, required }),
    _sqlType: 'text', // stored as JSON
    _clientType: 'text',
  };
}

function hidden(opts: HiddenOptions = {}): FieldDef<any, string> {
  const schema = v.optional(v.unknown(), opts.defaultValue);
  return {
    _schema: schema as any,
    _meta: baseMeta('hidden', { tableVisible: false, defaultValue: opts.defaultValue, required: false }),
    _sqlType: 'text',
    _clientType: 'text',
  };
}

function guardianReference(
  reference: GuardianReferenceDefinition,
  opts: GuardianReferenceOptions,
): FieldDef<any, string> {
  const required = opts.required ?? true;
  const base = v.pipe(v.string(), v.minLength(1));
  const schema = required ? base : v.optional(base);
  return {
    _schema: schema as any,
    _meta: baseMeta('hidden', {
      ...opts,
      required,
      tableVisible: opts.tableVisible ?? false,
    }),
    _sqlType: `text references ${reference.table}(${reference.column}) on delete ${reference.onDelete}${required ? ' not null' : ''}`,
    _clientType: 'text',
    _guardianReference: reference,
  };
}

/**
 * Reference the canonical ID-only Guardian user anchor in an app table.
 * The value is storage attribution, not proof of authorization.
 */
function guardianUser(opts: GuardianReferenceOptions = {}): FieldDef<any, string> {
  return guardianReference(GUARDIAN_USER_REFERENCE, opts);
}

/**
 * Reference the canonical tenant-membership anchor in an app/tenant table.
 * Membership references imply both membership and user anchor projections.
 */
function guardianMembership(opts: GuardianReferenceOptions = {}): FieldDef<any, string> {
  return guardianReference(GUARDIAN_MEMBERSHIP_REFERENCE, opts);
}

// ─── Export namespace ───────────────────────────────────────────────────────

export const field = {
  text,
  email,
  url,
  password,
  number,
  boolean,
  select,
  multiSelect,
  textarea,
  date,
  datetime,
  json,
  enum: enumField,
  hidden,
  tags,
  combobox,
  dateRange,
  guardianUser,
  guardianMembership,
} as const;
