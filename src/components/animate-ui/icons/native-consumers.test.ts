/** Recent native UI families must use Zero's pack before admitting an external icon. */
import { expect, test } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import * as ts from 'typescript';

const COMPONENTS = new URL('../../', import.meta.url);
// These exact semantic glyphs are missing from Zero's catalog. New exceptions
// need explicit review; adding a native glyph makes its old fallback fail here.
const FALLBACKS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'messaging/conversation-activity.tsx': { Bot: 'bot', Mic: 'mic' },
  'messaging/message-bubble.tsx': { CheckCheck: 'check-check', CircleAlert: 'circle-alert', File: 'file' },
  'messaging/workspace-message-actions.tsx': { Ellipsis: 'ellipsis' },
  'blog/blog-search.tsx': { FileText: 'file-text', Tag: 'tag', Folder: 'folder' },
  'blog/blog-post-editor.tsx': { History: 'history', Save: 'save' },
  'blog/blog-search-results.tsx': { FileText: 'file-text', ArrowUpRight: 'arrow-up-right' },
  'blog/blog-inline-input.tsx': { Bold: 'bold', Italic: 'italic', Underline: 'underline', Strikethrough: 'strikethrough', Code: 'code' },
  'blog/blog-lightbox.tsx': { Minus: 'minus', ScanSearch: 'scan-search' },
  'blog/blog-media-picker.tsx': { FileImage: 'file-image', FileAudio: 'file-audio', FileVideo: 'file-video' },
  'blog/blog-primitives.tsx': { ArrowUpRight: 'arrow-up-right' },
  'blog/blog-cards.tsx': { ArrowUpRight: 'arrow-up-right' },
  'blog/blog-media-controls.tsx': { VolumeX: 'volume-x', Repeat: 'repeat', SkipBack: 'skip-back', SkipForward: 'skip-forward' },
  'logging/logging-columns.tsx': { ArrowUpRight: 'arrow-up-right', Bot: 'bot', FileText: 'file-text' },
  'logging/logging-event-detail.tsx': { FileText: 'file-text', Fingerprint: 'fingerprint', Info: 'info', ShieldCheck: 'shield-check' },
  'logging/logging-workspace.tsx': { Activity: 'activity', CircleHelp: 'circle-help', SearchX: 'search-x', ShieldCheck: 'shield-check' },
  'logging/logging-filters.tsx': { SlidersHorizontal: 'sliders-horizontal' },
  'command-palette/command-palette.tsx': { ArrowUpRight: 'arrow-up-right' },
  'ui/pagination.tsx': { MoreHorizontal: 'more-horizontal' },
};
const EQUIVALENTS: Readonly<Record<string, string>> = {
  RefreshCw: 'rotate-cw', Clock3: 'clock', LoaderCircle: 'loader', Loader2: 'loader',
  Settings2: 'settings', Trash2: 'trash', UserRound: 'user', UsersRound: 'users',
};

async function sources(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const item of await readdir(new URL(directory, COMPONENTS), { withFileTypes: true })) {
    const path = directory + item.name;
    if (item.isDirectory()) result.push(...await sources(path + '/'));
    else if (item.isFile() && item.name.endsWith('.tsx')) result.push(path);
  }
  return result;
}

test('native messaging/blog/logging/palette/presence/pagination icons prefer Zero with explicitly missing fallbacks', async () => {
  const registry = ts.createSourceFile('registry.ts', await readFile(new URL('animate-ui/icons/registry.ts', COMPONENTS), 'utf8'), ts.ScriptTarget.Latest, true);
  const names = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'zeroAnimatedIcons' && node.initializer) {
      let value = node.initializer;
      while (ts.isSatisfiesExpression(value) || ts.isAsExpression(value)) value = value.expression;
      if (ts.isObjectLiteralExpression(value)) for (const property of value.properties) {
        if (property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) names.add(property.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(registry); expect(names.size).toBeGreaterThan(50);
  const files = [...(await Promise.all(['messaging/', 'blog/', 'logging/', 'command-palette/'].map(sources))).flat(),
    'profile-settings/user-presence-settings.tsx', 'ui/pagination.tsx'];
  const observed: Record<string, string[]> = {};
  for (const file of files) {
    const source = ts.createSourceFile(file, await readFile(new URL(file, COMPONENTS), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const imported: string[] = [];
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
        || !/lucide|react-icons|@phosphor|@tabler|heroicons/.test(statement.moduleSpecifier.text)) continue;
      expect(statement.moduleSpecifier.text).toBe('lucide-react');
      expect(statement.importClause?.name).toBeUndefined();
      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) throw new Error(`${file}: unchecked icon namespace import`);
      for (const binding of bindings.elements) {
        const symbol = (binding.propertyName ?? binding.name).text;
        const canonical = symbol.replace(/Icon$/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([a-z])([0-9])/g, '$1-$2').toLowerCase();
        expect(names.has(EQUIVALENTS[symbol] ?? canonical), `${file}: use Zero's ${EQUIVALENTS[symbol] ?? canonical} icon`).toBe(false);
        const admitted = FALLBACKS[file]?.[symbol];
        expect(admitted, `${file}: external ${symbol} needs a documented missing icon`).toBeDefined();
        expect(names.has(admitted!)).toBe(false);
        imported.push(symbol);
      }
    }
    if (imported.length) observed[file] = imported;
  }
  expect(observed).toEqual(Object.fromEntries(Object.entries(FALLBACKS).map(([file, symbols]) => [file, Object.keys(symbols)])));
});
