/** Read-only human-facing theme parity/gap check; never installs a stylesheet, edits source or boots application services. */
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { auditThemeTokenUsage, createThemeDeclarations, getThemeTokenCatalog, renderThemeFoundationCss, THEME_FOUNDATION_VERSION } from '../src/design-system';
import { collectThemeTokenDeclarations } from '../src/design-system/theme-audit';

const root = join(import.meta.dir, '..');
const generated = readFileSync(join(root, 'src/frontend/styles/theme-next.css'), 'utf8');
const problems: string[] = [];
if (generated !== renderThemeFoundationCss()) problems.push('theme-next.css does not match renderThemeFoundationCss().');
const legacy = readFileSync(join(root, 'src/frontend/styles/globals.css'), 'utf8');
const names = collectThemeTokenDeclarations([{ name: 'legacy-root.css', content: legacy.match(/:root\s*\{([\s\S]*?)\n\}/u)![1]! }]);
for (const mode of ['light', 'dark'] as const) for (const name of names)
  if (!Object.hasOwn(createThemeDeclarations({ mode }), name)) problems.push(`Missing ${mode} legacy alias: ${name}`);

function sources(directory: string): { name: string; content: string }[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    if (!/\.(?:css|tsx?)$/u.test(entry.name) || /(?:\.test\.|\.browser-fixture\.|\.package-fixture\.)/u.test(entry.name)) return [];
    // Generated paint is qualified by exact parity above, not counted as component migration work.
    if (relative(root, path) === 'src/frontend/styles/theme-next.css') return [];
    return [{ name: relative(root, path), content: readFileSync(path, 'utf8') }];
  });
}
const inspected = [...sources(join(root, 'src/components')), ...sources(join(root, 'src/frontend/styles'))];
// Compile the actual global import closure in memory. Tailwind prunes unused
// theme entries, so reference-derived arbitrary utilities mark the exact source
// dependencies as used without fabricating declarations or allowing --color-*.
const require = createRequire(import.meta.url);
const { compile } = require('@tailwindcss/node') as typeof import('@tailwindcss/node');
const dependencies = new Set<string>();
const globalPath = join(root, 'src/frontend/styles/globals.css');
const compiler = await compile(legacy, { base: join(root, 'src/frontend/styles'), from: globalPath,
  onDependency(path) { dependencies.add(path); } });
const referenced = new Set(inspected.flatMap(source => [...source.content.matchAll(/\bvar\(\s*(--[\w-]+)\s*[,)]/giu)].map(match => match[1]!)));
const compiled = compiler.build([...referenced].sort().map(token => `[color:var(${token})]`));
const externalTokens = collectThemeTokenDeclarations([{ name: 'compiled-global-imports.css', content: compiled }]);
const findings = auditThemeTokenUsage(inspected, { externalTokens });
const unresolved = findings.filter(item => item.kind === 'unresolved-reference');
const literalReview = new Map<string, { source: string; count: number; lines: Set<number> }>();
for (const finding of findings) if (finding.kind === 'literal-color') {
  const item = literalReview.get(finding.source) ?? { source: finding.source, count: 0, lines: new Set<number>() };
  item.count++; item.lines.add(finding.line); literalReview.set(finding.source, item);
}
// Unknown component geometry is not a failed global-token check; undeclared foundation roles are.
for (const finding of unresolved) if (finding.token?.startsWith('--zero-theme-') || finding.token?.startsWith('--zero-type-'))
  problems.push(`${finding.source}:${finding.line} ${finding.token}`);
console.log(JSON.stringify({
  version: THEME_FOUNDATION_VERSION, roles: getThemeTokenCatalog().length, legacyAliases: names.length,
  sourceFiles: inspected.length, importedTokenDeclarations: externalTokens.length, compiledDependencies: dependencies.size, problems,
  reviewCounts: Object.fromEntries(['unresolved-reference', 'legacy-reference', 'literal-color'].map(kind => [kind, findings.filter(item => item.kind === kind).length])),
  unresolvedReview: unresolved.slice(0, 30),
  literalColorReview: [...literalReview.values()].map(item => ({ source: item.source, count: item.count, lines: [...item.lines] })),
  note: 'Syntactic source review candidates with declarations from the actual global CSS import closure. Generated foundation paint is parity-checked separately; computed scope/inline ownership still requires review. Compilation is in memory; no migration, deletion or file output performed.',
}, null, 2));
if (problems.length) process.exitCode = 1;
