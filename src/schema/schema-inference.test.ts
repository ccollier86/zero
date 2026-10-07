/** Statically compiles public schema contracts without executing app declarations or writing fixtures. */

import { describe, expect, test } from 'bun:test';
import ts from 'typescript';

const contract = `
import * as v from 'valibot';
import {field,defineSchema,defineTable,schema,type InferSchemaType,type InferSchemaInput,type InferRow,type InferInsert,type TableNames,type TableRow,type PrimaryKeyOf} from '@zero/framework/schema';
type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
type Check<T extends true>=T;
type IsAny<T>=0 extends 1&T?true:false;
const requiredText=field.text({required:true});
const optionalText=field.text();
const requiredBoolean=field.boolean({required:true,defaultValue:false});
const optionalBoolean=field.boolean();
const optionalEmail=field.email();
const optionalPhone=field.phone();
const requiredPhone=field.phone({required:true,defaultCountry:'GB',validation:'valid'});
const optionalDate=field.date();
const optionalPassword=field.password();
const optionalUrl=field.url();
const optionalArea=field.textarea();
const optionalTimestamp=field.datetime();
const optionalNumber=field.number();
const constrainedNumber=field.number({min:1});
const defaultedNumber=field.number({min:1,defaultValue:2});
const requiredNumber=field.number({required:true});
const nullableNumber=field.number({defaultValue:null});
const tags=field.tags();
const json=field.json();
const hidden=field.hidden();
const choice=field.enum(['low','high'],{required:true});
const optionalChoice=field.enum(['low','high']);
const multi=field.multiSelect([{label:'Low',value:'low'}]);
const singleCombo=field.combobox([{label:'Low',value:'low'}]);
const multiCombo=field.combobox([{label:'Low',value:'low'}],{multiple:true});
const range=field.dateRange();
const anchor=field.guardianUser();
const optionalAnchor=field.guardianUser({required:false});
declare const dynamicRequired:boolean;
declare const dynamicMultiple:boolean;
const dynamicText=field.text({required:dynamicRequired});
const dynamicPhone=field.phone({required:dynamicRequired});
const dynamicNumber=field.number({required:dynamicRequired});
const dynamicAnchor=field.guardianUser({required:dynamicRequired});
const dynamicCombo=field.combobox([{label:'Low',value:'low'}],{multiple:dynamicMultiple,required:dynamicRequired});
type RequiredTextInput=Check<Equal<v.InferInput<typeof requiredText._schema>,string>>;
type OptionalTextInput=Check<Equal<v.InferInput<typeof optionalText._schema>,string|null|undefined>>;
type OptionalTextOutput=Check<Equal<v.InferOutput<typeof optionalText._schema>,string|null>>;
type RequiredBooleanInput=Check<Equal<v.InferInput<typeof requiredBoolean._schema>,boolean>>;
type OptionalBooleanInput=Check<Equal<v.InferInput<typeof optionalBoolean._schema>,boolean|undefined>>;
type OptionalBooleanOutput=Check<Equal<v.InferOutput<typeof optionalBoolean._schema>,boolean>>;
type EmailOutput=Check<Equal<v.InferOutput<typeof optionalEmail._schema>,string|null>>;
type PhoneInput=Check<Equal<v.InferInput<typeof optionalPhone._schema>,string|null|undefined>>;
type PhoneOutput=Check<Equal<v.InferOutput<typeof optionalPhone._schema>,string|null>>;
type RequiredPhoneOutput=Check<Equal<v.InferOutput<typeof requiredPhone._schema>,string>>;
type DynamicPhoneInput=Check<Equal<v.InferInput<typeof dynamicPhone._schema>,string|null|undefined>>;
type DateOutput=Check<Equal<v.InferOutput<typeof optionalDate._schema>,string|null>>;
type PasswordOutput=Check<Equal<v.InferOutput<typeof optionalPassword._schema>,string|null>>;
type UrlOutput=Check<Equal<v.InferOutput<typeof optionalUrl._schema>,string|null>>;
type AreaOutput=Check<Equal<v.InferOutput<typeof optionalArea._schema>,string|null>>;
type TimestampOutput=Check<Equal<v.InferOutput<typeof optionalTimestamp._schema>,string|null>>;
type NumberInput=Check<Equal<v.InferInput<typeof optionalNumber._schema>,number|null|undefined>>;
type NumberOutput=Check<Equal<v.InferOutput<typeof optionalNumber._schema>,number|null>>;
type ConstrainedNumberOutput=Check<Equal<v.InferOutput<typeof constrainedNumber._schema>,number|null|undefined>>;
type DefaultedNumberOutput=Check<Equal<v.InferOutput<typeof defaultedNumber._schema>,number|null>>;
type NullableNumberOutput=Check<Equal<v.InferOutput<typeof nullableNumber._schema>,number|null>>;
type RequiredNumberOutput=Check<Equal<v.InferOutput<typeof requiredNumber._schema>,number>>;
type TagsOutput=Check<Equal<v.InferOutput<typeof tags._schema>,string[]>>;
type JsonOutput=Check<Equal<v.InferOutput<typeof json._schema>,unknown>>;
type HiddenOutput=Check<Equal<v.InferOutput<typeof hidden._schema>,unknown>>;
type ChoiceOutput=Check<Equal<v.InferOutput<typeof choice._schema>,'low'|'high'>>;
type OptionalChoiceOutput=Check<Equal<v.InferOutput<typeof optionalChoice._schema>,'low'|'high'|''|null>>;
type MultiOutput=Check<Equal<v.InferOutput<typeof multi._schema>,'low'[]>>;
type SingleComboOutput=Check<Equal<v.InferOutput<typeof singleCombo._schema>,'low'|''|null>>;
type MultiComboOutput=Check<Equal<v.InferOutput<typeof multiCombo._schema>,'low'[]>>;
type RangeOutput=Check<Equal<v.InferOutput<typeof range._schema>,[string,string]>>;
type AnchorInput=Check<Equal<v.InferInput<typeof anchor._schema>,string>>;
type OptionalAnchorOutput=Check<Equal<v.InferOutput<typeof optionalAnchor._schema>,string|null|undefined>>;
type DynamicTextInput=Check<Equal<v.InferInput<typeof dynamicText._schema>,string|null|undefined>>;
type DynamicNumberOutput=Check<Equal<v.InferOutput<typeof dynamicNumber._schema>,number|null>>;
type DynamicAnchorOutput=Check<Equal<v.InferOutput<typeof dynamicAnchor._schema>,string|null|undefined>>;
type DynamicComboOutput=Check<Equal<v.InferOutput<typeof dynamicCombo._schema>,'low'|''|null|'low'[]>>;
const descriptor=defineSchema({title:requiredText,enabled:optionalBoolean});
type LogicalOutput=Check<Equal<InferSchemaType<typeof descriptor>,{title:string;enabled:boolean}>>;
type LogicalInput=Check<Equal<InferSchemaInput<typeof descriptor>,{title:string;enabled?:boolean}>>;
type NotAny=Check<Equal<IsAny<InferSchemaType<typeof descriptor>>,false>>;
const bundle=schema({tasks:{fields:{title:requiredText,enabled:optionalBoolean},pk:'task_id'}});
type BundleDefinition=Check<Equal<InferSchemaType<typeof bundle.definitions.tasks>,{title:string;enabled:boolean}>>;
type BundlePrimaryKey=Check<Equal<typeof bundle.definitions.tasks.primaryKey,'task_id'>>;
const validated=bundle.definitions.tasks.validate({title:'Task'});
if(validated.success){
 const typedOutput:{title:string;enabled:boolean}=validated.output;
}
const table=defineTable('tasks',{title:requiredText,enabled:optionalBoolean,multi,range},{pk:'task_id'});
type Stored=InferRow<typeof table>;
const stored:Stored={task_id:'id',title:'Task',enabled:false,multi:'[]',range:'["",""]'};
const insert:InferInsert<typeof table>={title:'Task',enabled:false,multi:'[]',range:'["",""]'};
type Key=Check<Equal<PrimaryKeyOf<Stored>,'task_id'>>;
const nullableTable=defineTable('optional_fields',{optionalText,optionalNumber,optionalAnchor,requiredText});
type NullableStored=InferRow<typeof nullableTable>;
const nullableStored:NullableStored={id:'id',optionalText:null,optionalNumber:null,optionalAnchor:null,requiredText:'Task'};
const phoneTable=defineTable('phones',{optionalPhone,requiredPhone});
const phoneStored:InferRow<typeof phoneTable>={id:'id',optionalPhone:null,requiredPhone:'+442079460123'};
// @ts-expect-error required stored phone values cannot be null.
const invalidPhoneStored:InferRow<typeof phoneTable>={...phoneStored,requiredPhone:null};
// @ts-expect-error country selectors use a supported CountryCode, not arbitrary labels.
field.phone({defaultCountry:'Unknown'});
declare module '@zero/framework/schema' {
 interface Register { tables: { registered_tasks: Stored } }
}
type RegisteredNames=Check<Equal<TableNames,'registered_tasks'>>;
const registered:TableRow<'registered_tasks'>=stored;
// @ts-expect-error the registry does not permit missing stored row fields.
const invalidRegistered:TableRow<'registered_tasks'>={task_id:'id'};
// @ts-expect-error required scalars remain non-nullable.
const requiredNull:NullableStored={...nullableStored,requiredText:null};
// @ts-expect-error required logical title remains required.
const missingTitle:InferSchemaInput<typeof descriptor>={};
// @ts-expect-error typed logical booleans do not accept storage integers.
const wireBoolean:InferSchemaType<typeof descriptor>={title:'Task',enabled:1};
// @ts-expect-error required field inputs cannot be omitted.
const missingRequiredBoolean:v.InferInput<typeof requiredBoolean._schema>=undefined;
// @ts-expect-error storage strings remain distinct from logical multi-select arrays.
const arrayStored:Stored={...stored,multi:['low']};
`;

describe('schema inference', () => {
  test('preserves logical input/output, literal options and stored row compatibility', () => {
    const fixture = `${import.meta.dir}/__in_memory_schema_contract.ts`;
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true, skipLibCheck: true, noEmit: true, types: ['bun'],
      paths: { '@zero/framework/schema': [`${import.meta.dir}/index.ts`] },
    };
    const host = ts.createCompilerHost(options);
    const read = host.getSourceFile.bind(host);
    host.getSourceFile = (filename, languageVersion, onError, shouldCreateNewSourceFile) => filename === fixture
      ? ts.createSourceFile(fixture, contract, languageVersion, true)
      : read(filename, languageVersion, onError, shouldCreateNewSourceFile);
    const program = ts.createProgram([fixture], options, host);
    const diagnostics = ts.getPreEmitDiagnostics(program).map((diagnostic) => {
      const line = diagnostic.file && diagnostic.start !== undefined
        ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1
        : undefined;
      return `${diagnostic.code}${line ? `:${line}` : ''} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`;
    });
    expect(diagnostics).toEqual([]);
  }, 30_000);
});
