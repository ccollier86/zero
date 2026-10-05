/** Logical validator inference helpers; stored-row phantom types remain in FieldDef. */

import type * as v from 'valibot';

export type RequiredOption<Options, Default extends boolean> = Options extends undefined
  ? Default
  : 'required' extends keyof Options
    ? Options extends { required?: infer Required }
      ? Exclude<Required, undefined> | (undefined extends Required ? Default : never)
      : Default
    : Default;

/** Dynamic required options retain the possible omission path. */
export type FieldInput<Value, Options, Default extends boolean = false> =
  RequiredOption<Options, Default> extends true ? Value : Value | undefined;

/** Defaults fill omitted ordinary fields; optional Guardian anchors deliberately do not. */
type FilledDefault<Value> = Exclude<v.Default<v.GenericSchema<Value, Value>, undefined>, undefined | ((...args: never[]) => unknown)>;

export type FieldSchema<Value, Options, Default extends boolean = false, FillsOmitted extends boolean = true> =
  RequiredOption<Options, Default> extends true
    ? v.GenericSchema<Value, Value>
    : RequiredOption<Options, Default> extends false
      ? v.OptionalSchema<v.GenericSchema<Value, Value>, FillsOmitted extends true ? FilledDefault<Value> : undefined>
      : v.GenericSchema<Value | undefined, FillsOmitted extends true ? Value : Value | undefined>;

/** Optional choice controls include their explicit empty presentation value. */
export type ChoiceValue<Value extends string, Options> = RequiredOption<Options, false> extends true
  ? Value
  : Value | '' | null;

export type ChoiceSchema<Value extends string, Options> = FieldSchema<ChoiceValue<Value, Options>, Options>;

type MultipleOption<Options> = Options extends undefined ? false
  : 'multiple' extends keyof Options
    ? Options extends { multiple?: infer Multiple } ? Exclude<Multiple, undefined> | (undefined extends Multiple ? false : never) : false
    : false;

/** A literal multiple flag narrows the value; dynamic flags keep both valid shapes. */
export type ComboboxValue<Value extends string, Options> = MultipleOption<Options> extends true
  ? Value[]
  : MultipleOption<Options> extends false
    ? ChoiceValue<Value, Options>
    : ChoiceValue<Value, Options> | Value[];

export type ComboboxSchema<Value extends string, Options> = FieldSchema<ComboboxValue<Value, Options>, Options>;

/** Nullable SQL scalars retain physical null instead of inventing an empty value. */
export type NullableValue<Value, Options, Default extends boolean = false> =
  RequiredOption<Options, Default> extends true ? Value : Value | null;

export type NullableFieldSchema<Value, Options, Default extends boolean = false, FillsOmitted extends boolean = true> =
  FieldSchema<NullableValue<Value, Options, Default>, Options, Default, FillsOmitted>;

type NumberOutput<Options> = NullableValue<number, Options> | (RequiredOption<Options, false> extends true
  ? never
  : Options extends { defaultValue: number | null } ? never
    : 'min' extends keyof Options ? undefined : 'max' extends keyof Options ? undefined : never);

/** Constraints can make implicit zero invalid; omission then remains undefined. */
export type NumberFieldSchema<Options> = RequiredOption<Options, false> extends true
  ? v.GenericSchema<number, number>
  : RequiredOption<Options, false> extends false
    ? v.OptionalSchema<v.GenericSchema<number | null, number | null>, undefined extends NumberOutput<Options>
        ? v.Default<v.GenericSchema<number | null, number | null>, undefined>
        : FilledDefault<number | null>>
    : v.GenericSchema<FieldInput<NullableValue<number, Options>, Options>, NumberOutput<Options>>;
