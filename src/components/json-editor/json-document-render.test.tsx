/** SSR is deterministic and side-effect free; browser clocks and saved state cannot be invented. */
import { expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { JsonDocumentEditor, DocumentEditor } from './json-document-editor';
import { tokenizeJsonDocument } from './json-document-source';

test('server tree retains exact escaped values and never calls change or writer', () => {
  let changed = 0, saved = 0;
  const html = renderToString(<JsonDocumentEditor value={{ text: '<script>bad()</script>', list: [1, true] }}
    onChange={() => changed++} onSave={async () => { saved++; }} label="Settings" />);
  expect(html).toContain('json-document-editor'); expect(html).toContain('&lt;script&gt;bad()&lt;/script&gt;');
  expect(html).not.toContain('<script>'); expect(html).not.toContain('Saved'); expect(html).not.toContain('zero-scroll-decoration');
  expect(changed).toBe(0); expect(saved).toBe(0);
});

test('source SSR preserves malformed buffers; syntax decorations remain bounded without dropping text', () => {
  const source = '{"name":';
  const html = renderToString(<JsonDocumentEditor value={{}} onChange={() => {}} rawTextDraft={source} />);
  expect(html).toContain('data-mode="code"');
  expect(html).toContain('aria-invalid="true"'); expect(html).toContain('Expected a JSON value.');
  const large = '1,'.repeat(20_000);
  const tokens = tokenizeJsonDocument(large);
  expect(tokens.length).toBeLessThanOrEqual(5_001); expect(tokens.map(token => token.text).join('')).toBe(large);
});

test('exact-number source opens Code and retains its original numeric text rather than showing a rounded editable field', () => {
  for (const format of ['json', 'yaml'] as const) {
    const html = renderToString(<DocumentEditor format={format} sourceText={format === 'json' ? '{"id":9007199254740993}' : 'id: 9007199254740993\n'} />);
    const fields = html.match(/<textarea[\s\S]*?<\/textarea>/gu)?.join('') ?? '';
    expect(html).toContain('data-mode="code"'); expect(fields).toContain('9007199254740993'); expect(fields).not.toContain('9007199254740992');
  }
});
