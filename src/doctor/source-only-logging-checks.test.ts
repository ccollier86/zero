import { expect, test } from 'bun:test';
import { checkSourceOnlyLogging } from './source-only-logging-checks';
const check = (source: string) => checkSourceOnlyLogging({ path: 'app/fixture.tsx', source });
test('known native identity-only views are review findings, not false coverage certification or execution', () => {
  expect(check("import {useLoggingView as track} from '@zero/framework/react/logging'; track({type:'record',id:'one'});")[0]).toMatchObject({ code: 'usage.logging.identity_only_view', severity: 'info', category: 'manual-review' });
  expect(check("import {useLoggingView as track} from '@zero/framework/react/logging'; function F(track) {track({type:'record',id:'one'});}")).toEqual([]);
  expect(check("import {useLoggingRows} from '@zero/framework/react/logging'; useLoggingRows(rows);")).toEqual([]);
  expect(check("const x=\"useLoggingView({type:'record'})\";")).toEqual([]);
});
test('literal custom adapter omissions are narrow review findings; native/indirect/spread/receipt-aware results are not guessed', () => {
  const prefix = "import {DataTable as Table} from '@zero/framework/components/data-table'; ";
  expect(check(prefix + "const x=<Table source={{type:'server',adapter:{async query(){return {rows:[],page:{}};}}}}/>;")[0]?.code).toBe('usage.logging.custom_result_receipt');
  for (const body of ["return {rows:[],page:{},auditReceipt};", "return {rows:[],page:{},...rest};", "return helper();"])
    expect(check(prefix + `const x=<Table source={{type:'server',adapter:{async query(){${body}}}}}/>;`)).toEqual([]);
  expect(check(prefix + "const x=<Table source={{type:'server',table:'records'}}/>;")).toEqual([]);
});
