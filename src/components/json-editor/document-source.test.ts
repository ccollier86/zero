/** Codec round trips and adversarial supplied buffers only; never touches real environment files or settings. */
import { expect, test } from 'bun:test';
import { parseDocumentSource, readSourceDocument, writeSourceDocument, formatDocumentSource, tokenizeDocumentSource } from './document-source';
import { mutateJsonDocument } from './json-document-model';
import { sourceInputEdit } from './document-source-input';

const yaml = '# Deployment\nname: Zero # dashboard label\nretries: 3\nnotes: |\n  Keep this multiline text.\nroutes:\n  - path: /health\n    method: GET\n';
const toml = '# Deployment\nname = "Zero"\nratio = 1.0\n\n[server]\nport = 8080 # public port\n\n[[routes]]\npath = "/health"\nmethod = "GET"\n\n[[routes]]\npath = "/ready"\nmethod = "GET"\n';
const env = '# Local config\nexport PORT = 8080 # public port\nURL=https://example.invalid/a#literal\nNAME="Hello # world" # greeting\nTOKEN="\\${LITERAL}"\nEMPTY=\n';

test('YAML comments, block strings and flow collections survive independent tree edits and key renames', () => {
  const source = readSourceDocument(yaml, 'yaml');
  expect(source.comments.get('/name')).toContain('dashboard label');
  const next = mutateJsonDocument(source.value, { kind: 'replace', path: ['retries'], value: 4 }).value;
  const text = writeSourceDocument(next, 'yaml', source);
  expect(text).toContain('# Deployment'); expect(text).toContain('# dashboard label'); expect(text).toContain('notes: |'); expect(text).toContain('retries: 4');
  const renamed = mutateJsonDocument(source.value, { kind: 'rename', path: ['name'], name: 'service' }).value;
  expect(writeSourceDocument(renamed, 'yaml', source)).toContain('service: Zero # dashboard label');
  expect(writeSourceDocument(source.value, 'yaml', source)).toBe(yaml);
});

test('YAML anchors remain intact; edits cannot silently detach aliases or change another value', () => {
  const source = readSourceDocument('defaults: &defaults\n  retries: 3\nworker: *defaults\nother: true\n', 'yaml');
  const next = mutateJsonDocument(source.value, { kind: 'replace', path: ['other'], value: false }).value;
  const text = writeSourceDocument(next, 'yaml', source); expect(text).toContain('&defaults'); expect(text).toContain('*defaults');
  expect(() => writeSourceDocument(mutateJsonDocument(source.value, { kind: 'replace', path: ['defaults', 'retries'], value: 4 }).value, 'yaml', source)).toThrow('shared YAML anchor');
  expect(() => writeSourceDocument(mutateJsonDocument(source.value, { kind: 'replace', path: ['worker'], value: 'detached' }).value, 'yaml', source)).toThrow('detach');
  for (const text of ['a: &a [*a]\n', 'a: 1\na: 2\n', '---\na: 1\n---\nb: 2', 'a: !execute command\n', 'a: .inf\n', '? [complex, key]\n: value']) expect(parseDocumentSource(text, 'yaml').ok).toBe(false);
});

test('TOML parses table arrays, quoted/dotted keys and multiline strings without turning source into a new file', () => {
  const source = readSourceDocument(toml + 'note = """One\nTwo"""\n', 'toml');
  expect(source.value).toMatchObject({ server: { port: 8080 }, routes: [{ path: '/health' }, { path: '/ready', note: 'One\nTwo' }] });
  expect(source.comments.get('/server/port')).toContain('public port');
  const value = mutateJsonDocument(source.value, { kind: 'replace', path: ['server', 'port'], value: 9090 }).value;
  expect(writeSourceDocument(value, 'toml', source)).toBe(source.text.replace('8080', '9090'));
  const float = mutateJsonDocument(source.value, { kind: 'replace', path: ['ratio'], value: 2 }).value;
  expect(writeSourceDocument(float, 'toml', source)).toContain('ratio = 2.0');
  const quoted = readSourceDocument('"a.b".value = 3\n', 'toml'); expect(quoted.value).toEqual({ 'a.b': { value: 3 } });
});

test('TOML native dates and exact large integers are protected textual projections, not coerced save values', () => {
  const text = 'date = 2026-10-11\ninstant = 2026-10-11T12:45:00-04:00\nlarge = 9223372036854775807\nflag = true\n';
  const source = readSourceDocument(text, 'toml');
  expect(source.value).toEqual({ date: '2026-10-11', instant: '2026-10-11T12:45:00-04:00', large: '9223372036854775807', flag: true });
  expect(source.native.size).toBe(3);
  const value = mutateJsonDocument(source.value, { kind: 'replace', path: ['flag'], value: false }).value;
  expect(writeSourceDocument(value, 'toml', source)).toBe(text.replace('flag = true', 'flag = false'));
  expect(() => writeSourceDocument(mutateJsonDocument(source.value, { kind: 'replace', path: ['date'], value: 'oops' }).value, 'toml', source)).toThrow('native');
  expect(parseDocumentSource('number = inf', 'toml').ok).toBe(false);
  expect(() => writeSourceDocument({ missing: null }, 'toml')).toThrow('null');
});

test('TOML adds, removes and renames simple fields with their comments and tables intact', () => {
  const source = readSourceDocument(toml, 'toml');
  let value = mutateJsonDocument(source.value, { kind: 'rename', path: ['server', 'port'], name: 'http_port' }).value;
  expect(writeSourceDocument(value, 'toml', source)).toBe(toml.replace('port =', 'http_port ='));
  value = mutateJsonDocument(source.value, { kind: 'remove', path: ['name'] }).value;
  expect(writeSourceDocument(value, 'toml', source)).toBe(toml.replace('name = "Zero"\n', ''));
  value = mutateJsonDocument(source.value, { kind: 'add', path: ['server'] }).value;
  value = mutateJsonDocument(value, { kind: 'replace', path: ['server', 'key'], value: 'new' }).value;
  expect(parseDocumentSource(writeSourceDocument(value, 'toml', source), 'toml')).toEqual({ ok: true, value });
});

test('.env values are always literal strings; prefixes, comments, escapes and multiline quotes survive edits', () => {
  const source = readSourceDocument(env, 'env');
  expect(source.value).toEqual({ PORT: '8080', URL: 'https://example.invalid/a#literal', NAME: 'Hello # world', TOKEN: '${LITERAL}', EMPTY: '' });
  expect(source.comments.get('/PORT')).toContain('public port');
  const value = mutateJsonDocument(source.value, { kind: 'replace', path: ['PORT'], value: '9090' }).value;
  expect(writeSourceDocument(value, 'env', source)).toBe(env.replace('8080', '9090'));
  const rename = mutateJsonDocument(source.value, { kind: 'rename', path: ['NAME'], name: 'GREETING' }).value;
  expect(writeSourceDocument(rename, 'env', source, { from: '/NAME', to: 'GREETING' })).toBe(env.replace('NAME=', 'GREETING='));
  expect(parseDocumentSource('MESSAGE="Hello\nWorld" # comment\n', 'env')).toEqual({ ok: true, value: { MESSAGE: 'Hello\nWorld' } });
  for (const text of ['A=1\nA=2', 'not a key', 'A="open', 'A="value" invalid']) expect(parseDocumentSource(text, 'env').ok).toBe(false);
  expect(() => writeSourceDocument({ PORT: 8080 }, 'env')).toThrow('strings');
  expect(() => writeSourceDocument({ DATA: { nested: 'x' } }, 'env')).toThrow('strings');
  const roundtrip = { A: 'a # comment', B: 'a"quote', C: '$secret', D: '\\n', E: 'real\nnewline' };
  expect(parseDocumentSource(writeSourceDocument(roundtrip, 'env'), 'env')).toEqual({ ok: true, value: roundtrip });
  const empty = readSourceDocument('EMPTY= # keep comment\nQUOTED=""#keep this too\nexport export=literal\n', 'env');
  expect(empty.value).toEqual({ EMPTY: '', QUOTED: '', export: 'literal' });
  expect(writeSourceDocument({ EMPTY: 'new', QUOTED: 'new', export: 'changed' }, 'env', empty)).toBe('EMPTY= new # keep comment\nQUOTED=new #keep this too\nexport export=changed\n');
  expect(parseDocumentSource(formatDocumentSource(empty.text, 'env'), 'env')).toEqual({ ok: true, value: empty.value });
});

test('prototype-named keys stay ordinary data in all codecs and source limits apply before parsing', () => {
  for (const [format, text] of [['yaml', '__proto__: {polluted: true}\nconstructor: data\n'], ['toml', '__proto__.polluted = true\nconstructor = "data"'], ['env', '__proto__=literal\nconstructor=data']] as const) {
    const result = parseDocumentSource(text, format); expect(result.ok).toBe(true);
    if (result.ok) expect(Object.hasOwn(result.value as object, '__proto__')).toBe(true);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    expect(parseDocumentSource('x'.repeat(1_000_001), format).ok).toBe(false);
  }
  const wide = Array.from({ length: 2_000 }, (_, index) => `key${index}: ${index}\n`).join('');
  const parsed = parseDocumentSource(wide, 'yaml'); expect(parsed.ok).toBe(true); if (parsed.ok) expect(Object.keys(parsed.value as object)).toHaveLength(2_000);
  expect(parseDocumentSource('a.'.repeat(70) + 'value = 1', 'toml').ok).toBe(false);
  expect(parseDocumentSource(null as unknown as string, 'yaml').ok).toBe(false);
});

test('formatting and safe token decorations retain complete text, comments and native values', () => {
  expect(formatDocumentSource('port=8080 # comment\n', 'toml')).toBe('port = 8080 # comment\n');
  expect(formatDocumentSource('export A = "a = b" # comment\n', 'env')).toBe('export A="a = b" # comment\n');
  for (const [format, text] of [['yaml', yaml], ['toml', toml], ['env', env]] as const) {
    const tokens = tokenizeDocumentSource(text, format); expect(tokens.map(token => token.text).join('')).toBe(text); expect(tokens.some(token => token.kind === 'comment')).toBe(true);
    expect(parseDocumentSource(formatDocumentSource(text, format), format)).toEqual(parseDocumentSource(text, format));
    const large = 'key: "<script>" # text\n'.repeat(20_000), decorated = tokenizeDocumentSource(large, format);
    expect(decorated.length).toBeLessThanOrEqual(5_001); expect(decorated.map(token => token.text).join('')).toBe(large);
  }
  const yamlBlock = tokenizeDocumentSource('notes: | # comment\n  # literal, not a comment\n  name: literal, not a key\n', 'yaml');
  expect(yamlBlock.filter(token => token.kind === 'string').map(token => token.text).join('')).toContain('# literal, not a comment');
  const envTokens = tokenizeDocumentSource('URL=https://example.invalid/#fragment # comment\n', 'env');
  expect(envTokens.find(token => token.kind === 'string')?.text).toBe('https://example.invalid/#fragment');
  expect(envTokens.find(token => token.kind === 'comment')?.text).toBe('# comment');
});

test('source typing provides paired brackets, selected indent/outdent, soft tabs and YAML list continuation', () => {
  expect(sourceInputEdit('{}', 1, 1, 'Enter', false, 'json')).toMatchObject({ text: '\n  \n', anchor: 4 });
  expect(sourceInputEdit('key:', 4, 4, 'Enter', false, 'yaml')).toMatchObject({ text: '\n  ' });
  expect(sourceInputEdit('  - item', 8, 8, 'Enter', false, 'yaml')).toMatchObject({ text: '\n  - ' });
  expect(sourceInputEdit('  - ', 4, 4, 'Enter', false, 'yaml')).toMatchObject({ start: 0, end: 4, text: '' });
  expect(sourceInputEdit('a\nb', 0, 3, 'Tab', false, 'yaml')).toMatchObject({ text: '  a\n  b' });
  expect(sourceInputEdit('  a\n  b', 0, 7, 'Tab', true, 'yaml')).toMatchObject({ text: 'a\nb' });
  expect(sourceInputEdit('  ', 2, 2, 'Backspace', false, 'json')).toMatchObject({ start: 0, end: 2, text: '' });
  expect(sourceInputEdit('KEY=', 4, 4, '{', false, 'env')).toBeNull();
});

test('exact JSON numbers remain source-authoritative; Format cannot round them or detach their precision guard', () => {
  const text = '{"id":9007199254740993,"rate":0.123456789012345678901,"nested":{},"flag":true}';
  const source = readSourceDocument(text, 'json'); expect(source.native.size).toBe(1);
  const formatted = formatDocumentSource(text, 'json'); expect(formatted).toContain('9007199254740993'); expect(formatted).toContain('0.123456789012345678901');
  expect(parseDocumentSource(formatted, 'json').ok).toBe(true);
  expect(() => writeSourceDocument(mutateJsonDocument(source.value, { kind: 'replace', path: ['flag'], value: false }).value, 'json', source)).toThrow('exact numbers');
  expect(readSourceDocument('{"value":1.00e2,"zero":0.0,"negative":-0}', 'json').native.size).toBe(0);
});

test('exact YAML decimal and radix numbers are source-authoritative instead of being rounded by AST formatting', () => {
  for (const number of ['9007199254740993', '0.123456789012345678901', '0x20000000000001', '0o400000000000000001']) {
    const text = `id: ${number}\nflag: true\n`, source = readSourceDocument(text, 'yaml');
    expect(source.native.get('')).toContain('Exact YAML'); expect(formatDocumentSource(text, 'yaml')).toBe(text);
    expect(() => writeSourceDocument(mutateJsonDocument(source.value, { kind: 'replace', path: ['flag'], value: false }).value, 'yaml', source)).toThrow('exact numbers');
  }
  expect(readSourceDocument('a: +00100\nb: -.25\nc: 1.\nd: 0x10\ne: .5e2\n', 'yaml').native.size).toBe(0);
});
