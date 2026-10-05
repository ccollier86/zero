/**
 * Declares schema field validation, storage encodings and presentation metadata.
 * These builders do not persist rows or authorize users. SQL default values are
 * emitted as literals; caller-provided text is never treated as SQL syntax.
 */

import * as v from 'valibot';
import type { FieldSchema, NullableFieldSchema, NullableValue, NumberFieldSchema, ChoiceSchema, ComboboxSchema } from './field-schema-types';
import { assertFieldDefault, scalarFieldSchema } from './field-schema-validation';
import { SchemaConfigurationError } from './schema-configuration-error';
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
  defaultValue?: string | null;
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
  defaultValue?: number | null;
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
  defaultValue?: string | null;
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
  defaultValue?: string | null;
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

function text(opts?: undefined): FieldDef<NullableFieldSchema<string, undefined>, NullableValue<string, undefined>>;
function text<const Options extends TextOptions | undefined>(opts: Options): FieldDef<NullableFieldSchema<string, Options>, NullableValue<string, Options>>;
function text(opts: TextOptions = {}): FieldDef<NullableFieldSchema<string, TextOptions>, NullableValue<string, TextOptions>> {
  const { required = false, minLength, maxLength } = opts;
  const pipes: v.PipeItem<string, string, v.BaseIssue<unknown>>[] = [];
  if (required || minLength) {
    pipes.push(v.minLength(minLength ?? 1));
  }
  if (maxLength != null) {
    pipes.push(v.maxLength(maxLength));
  }
  const base = v.pipe(v.string(), ...pipes);
  const schema = scalarFieldSchema('text', base, opts);
  const sqlDefault = opts.defaultValue != null
    ? ` default '${opts.defaultValue.replaceAll("'", "''")}'`
    : '';
  return {
    _schema: schema,
    _meta: baseMeta('text', { ...opts, required }),
    _sqlType: required ? 'text not null' : `text${sqlDefault}`,
    _clientType: 'text',
  };
}

function email(opts?: undefined): FieldDef<NullableFieldSchema<string, undefined>, NullableValue<string, undefined>>;
function email<const Options extends TextOptions | undefined>(opts: Options): FieldDef<NullableFieldSchema<string, Options>, NullableValue<string, Options>>;
function email(opts: TextOptions = {}): FieldDef<NullableFieldSchema<string, TextOptions>, NullableValue<string, TextOptions>> {
  const { required = false } = opts;
  const base = v.pipe(v.string(), v.email());
  const schema = scalarFieldSchema('email', base, opts);
  return {
    _schema: schema,
    _meta: baseMeta('email', { ...opts, required }),
    _sqlType: required ? 'text not null' : 'text',
    _clientType: 'text',
  };
}

function url(opts?: undefined): FieldDef<NullableFieldSchema<string, undefined>, NullableValue<string, undefined>>;
function url<const Options extends TextOptions | undefined>(opts: Options): FieldDef<NullableFieldSchema<string, Options>, NullableValue<string, Options>>;
function url(opts: TextOptions = {}): FieldDef<NullableFieldSchema<string, TextOptions>, NullableValue<string, TextOptions>> {
  const { required = false } = opts;
  const base = v.pipe(v.string(), v.url());
  const schema = scalarFieldSchema('url', base, opts);
  return {
    _schema: schema,
    _meta: baseMeta('url', { ...opts, required }),
    _sqlType: required ? 'text not null' : 'text',
    _clientType: 'text',
  };
}

function password(opts?: undefined): FieldDef<NullableFieldSchema<string, undefined>, NullableValue<string, undefined>>;
function password<const Options extends TextOptions | undefined>(opts: Options): FieldDef<NullableFieldSchema<string, Options>, NullableValue<string, Options>>;
function password(opts: TextOptions = {}): FieldDef<NullableFieldSchema<string, TextOptions>, NullableValue<string, TextOptions>> {
  const { required = false, minLength = 8, maxLength } = opts;
  const pipes: v.PipeItem<string, string, v.BaseIssue<unknown>>[] = [v.minLength(minLength)];
  if (maxLength != null) pipes.push(v.maxLength(maxLength));
  const base = v.pipe(v.string(), ...pipes);
  const schema = scalarFieldSchema('password', base, opts);
  return {
    _schema: schema,
    _meta: baseMeta('password', { ...opts, required, minLength, maxLength, tableVisible: false }),
    _sqlType: required ? 'text not null' : 'text',
    _clientType: 'text',
  };
}

function number(opts?: undefined): FieldDef<NumberFieldSchema<undefined>, NullableValue<number, undefined>>;
function number<const Options extends NumberOptions | undefined>(opts: Options): FieldDef<NumberFieldSchema<Options>, NullableValue<number, Options>>;
function number(opts: NumberOptions = {}): FieldDef<NumberFieldSchema<NumberOptions>, NullableValue<number, NumberOptions>> {
  const { required = false, min, max, integer = false } = opts;
  const pipes: v.PipeItem<number, number, v.BaseIssue<unknown>>[] = [];
  if (integer) pipes.push(v.integer());
  if (min != null) pipes.push(v.minValue(min));
  if (max != null) pipes.push(v.maxValue(max));
  const base = pipes.length > 0 ? v.pipe(v.number(), ...pipes) : v.number();
  const optional = v.nullable(base);
  assertFieldDefault('number', required ? base : optional, opts.defaultValue);
  const implicitDefault = v.safeParse(base, 0).success ? 0 : undefined;
  const defaultValue = opts.defaultValue === undefined ? implicitDefault : opts.defaultValue;
  const schema = required ? base : v.optional(optional, defaultValue);
  const sqlType = integer ? 'integer' : 'real';
  const sqlDefault = opts.defaultValue != null ? ` default ${opts.defaultValue}` : '';
  return {
    _schema: schema,
    _meta: baseMeta('number', { ...opts, defaultValue, required, min, max }),
    _sqlType: required ? `${sqlType} not null` : `${sqlType}${sqlDefault}`,
    _clientType: integer ? 'integer' : 'real',
  };
}

function boolean(opts?: undefined): FieldDef<FieldSchema<boolean, undefined>, boolean>;
function boolean<const Options extends BooleanOptions | undefined>(opts: Options): FieldDef<FieldSchema<boolean, Options>, boolean>;
function boolean(opts: BooleanOptions = {}): FieldDef<FieldSchema<boolean, BooleanOptions>, boolean> {
  const required = opts.required ?? false;
  const defaultVal = opts.defaultValue ?? false;
  assertFieldDefault('boolean', v.boolean(), opts.defaultValue);
  const schema = required ? v.boolean() : v.optional(v.boolean(), defaultVal);
  return {
    _schema: schema,
    _meta: baseMeta('boolean', { ...opts, required, defaultValue: defaultVal }),
    _sqlType: `integer${required ? ' not null' : ''} default ${defaultVal ? 1 : 0}`,
    _clientType: 'integer',
  };
}

function select<const Choices extends readonly { label: string; value: string }[]>(options: Choices, opts?: undefined): FieldDef<ChoiceSchema<Choices[number]['value'], undefined>, NullableValue<string, undefined>>;
function select<const Choices extends readonly { label: string; value: string }[], const Options extends SelectOptions | undefined>(options: Choices, opts: Options): FieldDef<ChoiceSchema<Choices[number]['value'], Options>, NullableValue<string, Options>>;
function select(
  options: ReadonlyArray<{ label: string; value: string }>,
  opts: SelectOptions = {},
): FieldDef<ChoiceSchema<string, SelectOptions>, NullableValue<string, SelectOptions>> {
  const { required = false } = opts;
  const values = options.map((o) => o.value);
  const base = v.picklist(values);
  const schema = scalarFieldSchema('select', base, opts);
  return {
    _schema: schema,
    _meta: baseMeta('select', { ...opts, required, options: [...options] }),
    _sqlType: required ? 'text not null' : 'text',
    _clientType: 'text',
  };
}

function multiSelect<const Choices extends readonly { label: string; value: string }[]>(options: Choices, opts?: undefined): FieldDef<FieldSchema<Choices[number]['value'][], undefined>, NullableValue<string, undefined>>;
function multiSelect<const Choices extends readonly { label: string; value: string }[], const Options extends MultiSelectOptions | undefined>(options: Choices, opts: Options): FieldDef<FieldSchema<Choices[number]['value'][], Options>, NullableValue<string, Options>>;
function multiSelect(
  options: ReadonlyArray<{ label: string; value: string }>,
  opts: MultiSelectOptions = {},
): FieldDef<FieldSchema<string[], MultiSelectOptions>, NullableValue<string, MultiSelectOptions>> {
  const { required = false } = opts;
  const values = options.map((o) => o.value);
  const base = v.array(v.picklist(values));
  const requiredBase = v.pipe(base, v.minLength(1));
  assertFieldDefault('multiSelect', required ? requiredBase : base, opts.defaultValue);
  const schema = required ? requiredBase : v.optional(base, opts.defaultValue ?? []);
  return {
    _schema: schema,
    _meta: baseMeta('multiSelect', { ...opts, required, options: [...options] }),
    _sqlType: 'text',  // stored as JSON
    _clientType: 'text',
  };
}

function textarea(opts?: undefined): FieldDef<NullableFieldSchema<string, undefined>, NullableValue<string, undefined>>;
function textarea<const Options extends TextOptions | undefined>(opts: Options): FieldDef<NullableFieldSchema<string, Options>, NullableValue<string, Options>>;
function textarea(opts: TextOptions = {}): FieldDef<NullableFieldSchema<string, TextOptions>, NullableValue<string, TextOptions>> {
  const { required = false, minLength, maxLength } = opts;
  const pipes: v.PipeItem<string, string, v.BaseIssue<unknown>>[] = [];
  if (required || minLength) pipes.push(v.minLength(minLength ?? 1));
  if (maxLength != null) pipes.push(v.maxLength(maxLength));
  const base = v.pipe(v.string(), ...pipes);
  const schema = scalarFieldSchema('textarea', base, opts);
  return {
    _schema: schema,
    _meta: baseMeta('textarea', { ...opts, required, minLength, maxLength }),
    _sqlType: required ? 'text not null' : 'text',
    _clientType: 'text',
  };
}

function date(opts?: undefined): FieldDef<NullableFieldSchema<string, undefined>, NullableValue<string, undefined>>;
function date<const Options extends DateOptions | undefined>(opts: Options): FieldDef<NullableFieldSchema<string, Options>, NullableValue<string, Options>>;
function date(opts: DateOptions = {}): FieldDef<NullableFieldSchema<string, DateOptions>, NullableValue<string, DateOptions>> {
  const { required = false } = opts;
  const base = v.pipe(v.string(), v.isoDate());
  const schema = scalarFieldSchema('date', base, opts);
  return {
    _schema: schema,
    _meta: baseMeta('date', { ...opts, required }),
    _sqlType: required ? 'text not null' : 'text',
    _clientType: 'text',
  };
}

function datetime(opts?: undefined): FieldDef<NullableFieldSchema<string, undefined>, NullableValue<string, undefined>>;
function datetime<const Options extends DateOptions | undefined>(opts: Options): FieldDef<NullableFieldSchema<string, Options>, NullableValue<string, Options>>;
function datetime(opts: DateOptions = {}): FieldDef<NullableFieldSchema<string, DateOptions>, NullableValue<string, DateOptions>> {
  const { required = false } = opts;
  const base = v.pipe(v.string(), v.isoTimestamp());
  const schema = scalarFieldSchema('datetime', base, opts);
  return {
    _schema: schema,
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
  defaultValue?: string | null;
  tableVisible?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  columnWidth?: number;
}

/**
 * JSON field — stored as text in SQLite, parsed/serialized automatically.
 * Renders as a textarea in forms. Use for arbitrary structured data.
 */
function json(opts?: undefined): FieldDef<FieldSchema<unknown, undefined>, NullableValue<string, undefined>>;
function json<const Options extends JsonOptions | undefined>(opts: Options): FieldDef<FieldSchema<unknown, Options>, NullableValue<string, Options>>;
function json(opts: JsonOptions = {}): FieldDef<FieldSchema<unknown, JsonOptions>, NullableValue<string, JsonOptions>> {
  const { required = false } = opts;
  const base = v.unknown();
  const requiredBase = v.pipe(base, v.check((val) => val != null && val !== '', 'Required'));
  assertFieldDefault('json', required ? requiredBase : base, opts.defaultValue);
  const schema = required
    ? requiredBase
    : v.optional(base, opts.defaultValue ?? null);
  return {
    _schema: schema,
    _meta: baseMeta('json', { ...opts, required }),
    _sqlType: required ? 'text not null' : 'text',
    _clientType: 'text',
  };
}

/**
 * Enum field — like select but defined by string literal values (no label/value pairs).
 * Automatically generates options from the values array.
 */
function enumField<const Values extends readonly [string, ...string[]]>(values: Values, opts?: undefined): FieldDef<ChoiceSchema<Values[number], undefined>, NullableValue<string, undefined>>;
function enumField<const Values extends readonly [string, ...string[]], const Options extends EnumOptions | undefined>(values: Values, opts: Options): FieldDef<ChoiceSchema<Values[number], Options>, NullableValue<string, Options>>;
function enumField(
  values: readonly [string, ...string[]],
  opts: EnumOptions = {},
): FieldDef<ChoiceSchema<string, EnumOptions>, NullableValue<string, EnumOptions>> {
  const { required = false } = opts;
  const base = v.picklist(values);
  const schema = scalarFieldSchema('enum', base, opts);
  const options = values.map((val) => ({
    label: val.charAt(0).toUpperCase() + val.slice(1).replace(/([A-Z])/g, ' $1'),
    value: val,
  }));
  return {
    _schema: schema,
    _meta: baseMeta('enum', { ...opts, required, options: [...options] }),
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
  defaultValue?: string | string[] | null;
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
function tags(opts?: undefined): FieldDef<FieldSchema<string[], undefined>, NullableValue<string, undefined>>;
function tags<const Options extends TagsOptions | undefined>(opts: Options): FieldDef<FieldSchema<string[], Options>, NullableValue<string, Options>>;
function tags(opts: TagsOptions = {}): FieldDef<FieldSchema<string[], TagsOptions>, NullableValue<string, TagsOptions>> {
  const { required = false } = opts;
  const base = v.array(v.string());
  const requiredBase = v.pipe(base, v.minLength(1));
  assertFieldDefault('tags', required ? requiredBase : base, opts.defaultValue);
  const schema = required
    ? requiredBase
    : v.optional(base, opts.defaultValue ?? []);
  return {
    _schema: schema,
    _meta: baseMeta('tags', { ...opts, required }),
    _sqlType: 'text', // stored as JSON
    _clientType: 'text',
  };
}

/**
 * Combobox field — searchable dropdown. Stored as text (single) or JSON text (multiple).
 * Renders as a Combobox in forms.
 */
function combobox<const Choices extends readonly { label: string; value: string }[]>(options: Choices, opts?: undefined): FieldDef<ComboboxSchema<Choices[number]['value'], undefined>, NullableValue<string, undefined>>;
function combobox<const Choices extends readonly { label: string; value: string }[], const Options extends ComboboxOptions | undefined>(options: Choices, opts: Options): FieldDef<ComboboxSchema<Choices[number]['value'], Options>, NullableValue<string, Options>>;
function combobox(
  options: ReadonlyArray<{ label: string; value: string }>,
  opts: ComboboxOptions = {},
): FieldDef<ComboboxSchema<string, ComboboxOptions>, NullableValue<string, ComboboxOptions>> {
  const { required = false, multiple = false } = opts;
  const values = options.map((o) => o.value);

  if (multiple) {
    const base = v.array(v.picklist(values));
    const requiredBase = v.pipe(base, v.minLength(1));
    assertFieldDefault('combobox', required ? requiredBase : base, opts.defaultValue);
    const defaultValue = opts.defaultValue ?? [];
    if (!Array.isArray(defaultValue)) {
      // The common options type permits both modes; admission must not treat
      // a single-value default as a valid multi-value field configuration.
      throw new SchemaConfigurationError('combobox');
    }
    const schema = required
      ? requiredBase
      : v.optional(base, defaultValue);
    return {
      _schema: schema,
      _meta: baseMeta('combobox', { ...opts, required, options: [...options], multiple }),
      _sqlType: 'text', // stored as JSON
      _clientType: 'text',
    };
  }

  const base = v.picklist(values);
  const schema = scalarFieldSchema('combobox', base, opts);
  return {
    _schema: schema,
    _meta: baseMeta('combobox', { ...opts, required, options: [...options], multiple }),
    _sqlType: required ? 'text not null' : 'text',
    _clientType: 'text',
  };
}

/**
 * Date range field — stored as JSON text '["start","end"]' in SQLite.
 * Renders as a DateRangePicker in forms.
 */
function dateRange(opts?: undefined): FieldDef<FieldSchema<[string, string], undefined>, NullableValue<string, undefined>>;
function dateRange<const Options extends DateRangeOptions | undefined>(opts: Options): FieldDef<FieldSchema<[string, string], Options>, NullableValue<string, Options>>;
function dateRange(opts: DateRangeOptions = {}): FieldDef<FieldSchema<[string, string], DateRangeOptions>, NullableValue<string, DateRangeOptions>> {
  const { required = false } = opts;
  const dateStr = v.union([v.pipe(v.string(), v.isoDate()), v.literal('')]);
  const base = v.tuple([dateStr, dateStr]);
  const schema = required
    ? v.pipe(base, v.check((val) => val[0] !== '' && val[1] !== '', 'Both dates required'))
    : v.optional(base, ['', '']);
  return {
    _schema: schema,
    _meta: baseMeta('dateRange', { ...opts, required }),
    _sqlType: 'text', // stored as JSON
    _clientType: 'text',
  };
}

function hidden(opts?: undefined): FieldDef<FieldSchema<unknown, undefined>, NullableValue<string, undefined>>;
function hidden<const Options extends HiddenOptions | undefined>(opts: Options): FieldDef<FieldSchema<unknown, Options>, NullableValue<string, Options>>;
function hidden(opts: HiddenOptions = {}): FieldDef<FieldSchema<unknown, HiddenOptions>, NullableValue<string, HiddenOptions>> {
  const schema = v.optional(v.unknown(), opts.defaultValue);
  return {
    _schema: schema,
    _meta: baseMeta('hidden', { tableVisible: false, defaultValue: opts.defaultValue, required: false }),
    _sqlType: 'text',
    _clientType: 'text',
  };
}

function guardianReference(
  reference: GuardianReferenceDefinition,
  opts: GuardianReferenceOptions,
): FieldDef<NullableFieldSchema<string, GuardianReferenceOptions, true, false>, NullableValue<string, GuardianReferenceOptions, true>> {
  const required = opts.required ?? true;
  const base = v.pipe(v.string(), v.minLength(1));
  const schema = required ? base : v.optional(v.nullable(base));
  return {
    _schema: schema,
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
function guardianUser(opts?: undefined): FieldDef<NullableFieldSchema<string, undefined, true, false>, NullableValue<string, undefined, true>>;
function guardianUser<const Options extends GuardianReferenceOptions | undefined>(opts: Options): FieldDef<NullableFieldSchema<string, Options, true, false>, NullableValue<string, Options, true>>;
function guardianUser(opts: GuardianReferenceOptions = {}): FieldDef<NullableFieldSchema<string, GuardianReferenceOptions, true, false>, NullableValue<string, GuardianReferenceOptions, true>> {
  return guardianReference(GUARDIAN_USER_REFERENCE, opts);
}

/**
 * Reference the canonical tenant-membership anchor in an app/tenant table.
 * Membership references imply both membership and user anchor projections.
 */
function guardianMembership(opts?: undefined): FieldDef<NullableFieldSchema<string, undefined, true, false>, NullableValue<string, undefined, true>>;
function guardianMembership<const Options extends GuardianReferenceOptions | undefined>(opts: Options): FieldDef<NullableFieldSchema<string, Options, true, false>, NullableValue<string, Options, true>>;
function guardianMembership(opts: GuardianReferenceOptions = {}): FieldDef<NullableFieldSchema<string, GuardianReferenceOptions, true, false>, NullableValue<string, GuardianReferenceOptions, true>> {
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
