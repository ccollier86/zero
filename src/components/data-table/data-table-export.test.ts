/** Captures synthetic CSV downloads without opening a browser/app or writing files. */

import { describe, expect, test } from 'bun:test';
import { createTable, getCoreRowModel } from '@tanstack/react-table';
import { exportDataTableCsv } from './data-table-export';

async function exportText(headers: string[], values: unknown[][]): Promise<string> {
  const columns = headers.map((header, index) => ({ id: `column${index}`, accessorKey: `column${index}`, header }));
  const data = values.map((row) => Object.fromEntries(row.map((value, index) => [`column${index}`, value])));
  const table = createTable({ columns, data, getCoreRowModel: getCoreRowModel(), state: {}, onStateChange() {}, renderFallbackValue: null });
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousCreate = URL.createObjectURL;
  const previousRevoke = URL.revokeObjectURL;
  let blob: Blob | undefined;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ click() {}, href: '', download: '' }) } });
  URL.createObjectURL = (value) => {
    if (!(value instanceof Blob)) throw new Error('Expected a CSV Blob, not a media source.');
    blob = value;
    return 'blob:synthetic-export';
  };
  URL.revokeObjectURL = () => undefined;
  try { exportDataTableCsv(table, 'synthetic.csv'); }
  finally {
    URL.createObjectURL = previousCreate;
    URL.revokeObjectURL = previousRevoke;
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
  if (!blob) throw new Error('Expected a synthetic download blob.');
  return blob.text();
}

describe('DataTable CSV export', () => {
  test('escapes headers as CSV fields instead of creating extra columns', async () => {
    expect(await exportText(['Title, note', 'Say "yes"', 'Line\nbreak'], [['one', 'two', 'three']]))
      .toBe('"Title, note","Say ""yes""","Line\nbreak"\none,two,three');
  });

  test('preserves carriage returns and separator/quote text inside one field', async () => {
    expect(await exportText(['Value'], [['first\rsecond'], ['text",=1+1'], ['plain']]))
      .toBe('Value\n"first\rsecond"\n"text"",=1+1"\nplain');
  });

  const dangerous = ['=1+1', '+1+1', '-1+1', '@SUM(1,1)', '＝1+1', '＋1+1', '－1+1', '＠SUM(1,1)', '  =1+1', '\t=1+1', '\r=1+1', '\n=1+1', '\0=1+1'];
  for (const [index, value] of dangerous.entries()) {
    test(`literalizes formula-like string variant ${index + 1} without a formula payload at the field start`, async () => {
      const expected = `"'\t${value.replaceAll('"', '""')}"`;
      expect(await exportText(['Value'], [[value]])).toBe(`Value\n${expected}`);
    });
  }

  test('literalizes a formula-like heading but preserves genuine numeric/boolean values', async () => {
    expect(await exportText(['=Heading', 'Numeric', 'Integer', 'Boolean', 'Text'], [['-1', -1, -2n, false, 'ordinary']]))
      .toBe('"\'\t=Heading",Numeric,Integer,Boolean,Text\n"\'\t-1",-1,-2,false,ordinary');
  });
});
