/**
 * Pure backing-theme diagnostics over supplied source text. Compares the owned
 * generated stylesheet/catalog and records mandatory canonical references only;
 * no filesystem, application imports, Tailwind execution or automatic migration.
 */
import { auditThemeTokenUsage, collectThemeTokenDeclarations } from '../design-system/theme-audit';
import { createThemeDeclarations, getThemeTokenCatalog } from '../design-system/theme-tokens';
import { renderThemeFoundationCss } from '../design-system/theme-css';
import { THEME_FOUNDATION_VERSION } from '../design-system/theme-foundation';
import type { ThemeAuditSource } from '../design-system/theme-types';
import type { PlatformDoctorFinding } from './platform-doctor-contracts';

/** Inputs are already read/admitted by the source-only filesystem boundary. */
export interface SourceOnlyThemeCheckInput {
  readonly bundledStyles: string | null;
  readonly bundledLegacyStyles: string | null;
  readonly sources: readonly ThemeAuditSource[];
  readonly copiedStyles?: readonly ThemeAuditSource[];
}

/** Counts are review evidence, not claims of computed-style or visual correctness. */
export interface SourceOnlyThemeSummary {
  readonly version: number;
  readonly roles: number;
  readonly bundledStyles: 'verified' | 'modified' | 'unavailable';
  readonly legacyAliases: number;
  readonly sourceFiles: number;
  readonly copiedStyles: number;
  readonly reviewCounts: {
    readonly unresolvedCanonicalReferences: number;
    readonly legacyReferences: number;
    readonly literalColors: number;
  };
  readonly readOnly: true;
}

/** Theme findings remain separate from runtime/configuration Doctor contracts. */
export interface SourceOnlyThemeCheckResult {
  readonly findings: readonly PlatformDoctorFinding[];
  readonly summary: SourceOnlyThemeSummary;
}

function evidence(code: string, path: string, message: string, hint: string,
  severity: PlatformDoctorFinding['severity'] = 'error', category: PlatformDoctorFinding['category'] = 'required', line = 1): PlatformDoctorFinding {
  return { code, severity, category, confidence: 'high', path: `${path}:${line}`, line, message, hint };
}

/** Mask comments/strings for root-selector discovery without changing positions. */
function cssStructure(source: string): string {
  const characters = source.split('');
  let quote: string | undefined;
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index];
    if (quote) {
      if (character === '\\') {
        characters[index] = ' ';
        if (index + 1 < characters.length) { if (characters[index + 1] !== '\n') characters[index + 1] = ' '; index++; }
      }
      else { if (character === quote) quote = undefined; if (character !== '\n') characters[index] = ' '; }
      continue;
    }
    if (character === '"' || character === "'") { quote = character; characters[index] = ' '; continue; }
    if (character !== '/' || characters[index + 1] !== '*') continue;
    let end = index + 2;
    while (end < characters.length && !(characters[end] === '*' && characters[end + 1] === '/')) end++;
    end = Math.min(characters.length, end + 2);
    for (let cursor = index; cursor < end; cursor++) if (characters[cursor] !== '\n') characters[cursor] = ' ';
    index = end - 1;
  }
  return characters.join('');
}

/**
 * Diagnose backing integrity. Old paint aliases and deliberate literal colours
 * are aggregate review counts only; they never become migration errors/warnings.
 */
export function checkSourceOnlyThemeFoundation(input: SourceOnlyThemeCheckInput): SourceOnlyThemeCheckResult {
  const findings: PlatformDoctorFinding[] = [];
  const expectedStyles = renderThemeFoundationCss();
  const bundledStyles = input.bundledStyles === null ? 'unavailable'
    : input.bundledStyles === expectedStyles ? 'verified' : 'modified';
  if (bundledStyles === 'unavailable') findings.push(evidence('theme.foundation.styles_unavailable', '@zero/framework/styles-next.css',
    'The inspected Doctor package does not contain its supplemental foundation stylesheet.',
    'Repair/reinstall the intended framework package; this check does not install or activate styles.'));
  else if (bundledStyles === 'modified') findings.push(evidence('theme.foundation.generated_stale', '@zero/framework/styles-next.css',
    'The bundled supplemental stylesheet does not match this Doctor package\'s pure foundation generator.',
    'Regenerate/repair the framework-owned asset before release. Do not overwrite customized application styles.'));

  const root = input.bundledLegacyStyles === null ? null
    : /:root\s*\{([\s\S]*?)\}/u.exec(cssStructure(input.bundledLegacyStyles));
  const legacyAliases = root ? collectThemeTokenDeclarations([{ name: 'legacy-root.css', content: root[1]! }]) : [];
  if (!root) findings.push(evidence('theme.foundation.legacy_root_unavailable', '@zero/framework/styles.css',
    'The bundled legacy root declarations could not be established; compatibility-alias coverage is incomplete.',
    'Repair/review the framework-owned base stylesheet. The legacy stylesheet is not replaced by the supplement.'));
  else for (const mode of ['light', 'dark'] as const) {
    const declarations = createThemeDeclarations({ mode });
    for (const name of legacyAliases) if (!Object.hasOwn(declarations, name)) {
      const offset = input.bundledLegacyStyles!.indexOf(name, root.index);
      const line = input.bundledLegacyStyles!.slice(0, Math.max(0, offset)).split('\n').length;
      findings.push(evidence('theme.foundation.alias_missing', '@zero/framework/styles.css',
        `The ${mode} foundation does not declare the legacy compatibility alias ${name}.`,
        'Restore the explicit compatibility mapping in the framework; do not rename application usages automatically.', 'error', 'required', line));
    }
  }

  for (const source of input.copiedStyles ?? []) if (source.content !== expectedStyles) findings.push(evidence(
    'theme.foundation.copied_styles_modified', source.name,
    'An application-owned supplemental stylesheet differs from this Doctor package\'s generated baseline.',
    'This may be deliberate customization or a different installed version. Review it against the intended baseline; Doctor leaves the file untouched.',
    'warning', 'manual-review'));

  const audits = auditThemeTokenUsage(input.sources, {
    // Copied generated CSS stays out of app review counts, but any admitted
    // customized declarations are real evidence for references in app sources.
    externalTokens: collectThemeTokenDeclarations(input.copiedStyles ?? []),
  });
  const unresolved = audits.filter(finding => finding.kind === 'unresolved-reference'
    && (finding.token?.startsWith('--zero-theme-') || finding.token?.startsWith('--zero-type-')));
  for (const finding of unresolved) findings.push(evidence('theme.foundation.unresolved_reference', finding.source,
    `A mandatory owned foundation reference ${finding.token} has no declaration in the inspected catalog/source set.`,
    'Check spelling or provide its actual source declaration. This is static evidence, not proof of computed scope; no style is rewritten.',
    'warning', 'manual-review', finding.line));

  return Object.freeze({ findings: Object.freeze(findings), summary: Object.freeze({
    version: THEME_FOUNDATION_VERSION, roles: getThemeTokenCatalog().length, bundledStyles,
    legacyAliases: legacyAliases.length, sourceFiles: input.sources.length, copiedStyles: input.copiedStyles?.length ?? 0,
    reviewCounts: Object.freeze({ unresolvedCanonicalReferences: unresolved.length,
      legacyReferences: audits.filter(finding => finding.kind === 'legacy-reference').length,
      literalColors: audits.filter(finding => finding.kind === 'literal-color').length }), readOnly: true as const,
  }) });
}
