/** Select an exact framework target, inspect its public contract and fingerprint bounded source. */
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { sourceOnlyBlockedPath, sourceOnlyInside, sourceOnlyRealpath } from './source-only-package';
import { admitUpgradeFile, SourceOnlyUpgradeExports, type UpgradeExportBinding, type UpgradeResolvedExport } from './source-only-upgrade-exports';
import type { PlatformDoctorFinding } from './platform-doctor-contracts';
import type { SourceOnlyUpgradeOption, SourceOnlyUpgradeTargetInspection, UpgradeCapability, UpgradeEvidenceStatus,
  UpgradeExportEvidence, UpgradeExportKind, UpgradeTargetSummary } from './source-only-upgrade-types';

const CAPABILITIES: readonly UpgradeCapability[] = ['modalShow', 'dropdownInnerViewport', 'popoverViewport', 'contentCard', 'selectRichSlots'];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const unavailable: UpgradeExportEvidence = Object.freeze({ status: 'unknown', reason: 'unresolved-source' });
function rootBlocked(path: string): boolean {
  // An installed package may legitimately live in node_modules; runtime/private directories and env paths may not.
  return sourceOnlyBlockedPath(path.replaceAll('\\', '/').split('/').filter(segment => segment !== 'node_modules').join('/'));
}
function empty(status: UpgradeTargetSummary['status'], findings: readonly PlatformDoctorFinding[]): SourceOnlyUpgradeTargetInspection {
  return Object.freeze({ summary: Object.freeze({ status, version: null,
    fingerprint: Object.freeze({ algorithm: 'sha256' as const, scope: 'bounded-public-source' as const, value: null, complete: false, files: 0 }),
    capabilities: Object.freeze(Object.fromEntries(CAPABILITIES.map(capability => [capability, 'unknown'])) as Record<UpgradeCapability, UpgradeEvidenceStatus>) }),
    findings: Object.freeze(findings), inspectNamedExport: async () => unavailable });
}
function failure(code: string, path: string, message: string): PlatformDoctorFinding {
  return { code, path, severity: 'error', category: 'required', confidence: 'high', message,
    hint: 'Select an exact readable @zero/framework package root. Doctor does not fall back to a nested application or execute package code.' };
}

/** Plain own-data options only. Even direct API callers cannot trigger accessors while selecting a root. */
function optionRoot(option: SourceOnlyUpgradeOption): string | undefined | null {
  if (typeof option === 'boolean') return undefined;
  if (!object(option) || ![Object.prototype, null].includes(Object.getPrototypeOf(option))) return null;
  const descriptors = Object.getOwnPropertyDescriptors(option);
  if (Reflect.ownKeys(descriptors).some(key => key !== 'targetRoot')) return null;
  const descriptor = descriptors.targetRoot;
  if (!descriptor) return undefined;
  return Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string' && descriptor.value.trim() ? descriptor.value : null;
}

/** Reads JSON data only, with canonical metadata/source fencing matching the source-only contract. */
async function manifest(root: string): Promise<{ value: Record<string, unknown>; source: string } | 'outside' | null> {
  try {
    const path = await admitUpgradeFile(root, join(root, 'package.json'));
    if (!path) return null;
    if (typeof path !== 'string') return path.outsideRoot ? 'outside' : null;
    if (basename(path) !== 'package.json' || sourceOnlyBlockedPath(relative(root, path))) return null;
    const file = Bun.file(path); if (file.size > 2_000_000) return null;
    const source = await file.slice(0, 2_000_001).text(); if (Buffer.byteLength(source) > 2_000_000) return null;
    const value: unknown = JSON.parse(source);
    return object(value) ? { value, source } : null;
  } catch { return null; }
}

/** Explicit targets are exact package roots; default selection is the app's installed package or framework workspace. */
export async function inspectSourceOnlyUpgradeTarget(projectRoot: string, option: SourceOnlyUpgradeOption): Promise<SourceOnlyUpgradeTargetInspection> {
  if (option === false) return empty('unavailable', []);
  let explicit: string | undefined | null;
  try { explicit = optionRoot(option); } catch { explicit = null; }
  if (explicit === null) return empty('unavailable', [failure('upgrade.target_invalid', 'upgrade.targetRoot', 'The upgrade target option must be a plain data object with an optional nonempty targetRoot string.')]);
  let project: string;
  try { project = sourceOnlyRealpath(resolve(projectRoot)); if (!(await stat(project)).isDirectory() || rootBlocked(project)) throw new Error(); }
  catch { return empty('unavailable', [failure('upgrade.target_invalid', 'projectRoot', 'The explicit source-inspection project root is unavailable or private.')]); }
  let root: string; let status: 'installed' | 'workspace' | 'explicit';
  if (explicit !== undefined) {
    const lexical = resolve(project, explicit);
    try {
      root = sourceOnlyRealpath(lexical); status = 'explicit';
      if (rootBlocked(lexical) || rootBlocked(root) || !(await stat(root)).isDirectory()) throw new Error();
    } catch { return empty('unavailable', [failure('upgrade.target_invalid', 'upgrade.targetRoot', 'The exact upgrade target directory is unavailable or private.')]); }
  } else {
    const installed = join(project, 'node_modules/@zero/framework');
    try { root = sourceOnlyRealpath(installed); status = 'installed'; }
    catch {
      const own = await manifest(project);
      if (own && own !== 'outside' && own.value.name === '@zero/framework') { root = project; status = 'workspace'; }
      else return empty('missing', [{ code: 'upgrade.target_unavailable', severity: 'info', category: 'manual-review', confidence: 'high',
        message: 'No installed framework target could be established for upgrade comparison.',
        hint: 'Install the intended package, or pass an explicit targetRoot to inspect a package before upgrading.' }]);
    }
    if (rootBlocked(root)) return empty('unavailable', [failure('upgrade.target_invalid', '@zero/framework/package.json', 'The canonical installed target points into a private directory.')]);
  }
  const metadata = await manifest(root);
  if (metadata === 'outside') return empty('unavailable', [failure('upgrade.outside_root', 'upgrade.targetRoot/package.json', 'The target manifest alias leaves its admitted canonical package root.')]);
  if (!metadata || metadata.value.name !== '@zero/framework') return empty('unavailable', [failure('upgrade.target_invalid', 'upgrade.targetRoot/package.json', 'The selected directory does not contain an admitted package.json named @zero/framework.')]);

  const inspector = new SourceOnlyUpgradeExports(root, metadata.value.exports);
  const capabilities = {} as Record<UpgradeCapability, UpgradeEvidenceStatus>;
  const modal = await exported(inspector, '@zero/framework/modals', 'modals');
  capabilities.modalShow = implementation(modal, modalShow);
  const dropdown = await exported(inspector, '@zero/framework/components/dropdown-menu', 'DropdownMenuContent');
  const subDropdown = await exported(inspector, '@zero/framework/components/dropdown-menu', 'DropdownMenuSubContent');
  capabilities.dropdownInnerViewport = combine([dropdown, subDropdown].map(result => implementation(result, dropdownViewport)));
  capabilities.popoverViewport = (await exported(inspector, '@zero/framework/components/popover', 'PopoverViewport')).status;
  capabilities.contentCard = (await exported(inspector, '@zero/framework/components/ui/content-card', 'ContentCard')).status;
  const select = await exported(inspector, '@zero/framework/components/ui/select', 'SelectItem');
  capabilities.selectRichSlots = implementation(select, richSelect);

  // Freeze this snapshot before lazy per-consumer export inspections; report identity never depends on inspection order.
  const hash = createHash('sha256').update('zero-upgrade-public-source-v1\0').update(stable(metadata.value))
    .update('\0export-map-order\0' + JSON.stringify(metadata.value.exports));
  for (const [path, source] of [...inspector.records].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) hash.update('\0' + path + '\0' + source);
  const summary: UpgradeTargetSummary = Object.freeze({ status, version: typeof metadata.value.version === 'string' ? metadata.value.version : null,
    fingerprint: Object.freeze({ algorithm: 'sha256', scope: 'bounded-public-source', value: hash.digest('hex'),
      complete: inspector.complete && Object.values(capabilities).every(value => value !== 'unknown'), files: inspector.records.size }),
    capabilities: Object.freeze(capabilities) });
  return Object.freeze({ summary, findings: Object.freeze([]),
    inspectNamedExport: async (specifier: string, name: string, kind: UpgradeExportKind = 'value'): Promise<UpgradeExportEvidence> => {
      const result = await inspector.inspect(specifier, name, kind);
      return Object.freeze({ status: result.status, ...(result.reason ? { reason: result.reason } : {}) });
    } });
}

async function exported(inspector: SourceOnlyUpgradeExports, path: string, name: string): Promise<UpgradeResolvedExport> {
  const direct = await inspector.inspect(path, name);
  if (direct.status === 'available') return direct;
  const frontend = await inspector.inspect('@zero/framework/react', name);
  if (frontend.status === 'available') return frontend;
  const root = await inspector.inspect('@zero/framework', name);
  if (root.status === 'available') return root;
  return [direct, frontend, root].find(result => result.status === 'unknown') ?? direct;
}

function combine(statuses: readonly UpgradeEvidenceStatus[]): UpgradeEvidenceStatus {
  return statuses.every(status => status === 'available') ? 'available' : statuses.every(status => status === 'missing') ? 'missing' : 'unknown';
}
function implementation(result: UpgradeResolvedExport, inspect: (binding?: UpgradeExportBinding) => UpgradeEvidenceStatus): UpgradeEvidenceStatus {
  return result.status === 'available' ? combine((result.bindings ?? [result.binding]).map(inspect)) : result.status;
}
function unwrap(expression: ts.Expression): ts.Expression {
  while (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isParenthesizedExpression(expression)
    || ts.isTypeAssertionExpression(expression)) expression = expression.expression;
  return expression;
}
function modalShow(binding?: UpgradeExportBinding): UpgradeEvidenceStatus {
  if (!binding || !ts.isVariableStatement(binding.declaration)) return 'unknown';
  const declaration = binding.declaration.declarationList.declarations.find(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === binding.localName);
  const expression = declaration?.initializer ? unwrap(declaration.initializer) : null;
  if (!expression || !ts.isObjectLiteralExpression(expression)) return 'unknown';
  if (expression.properties.some(property => property.name && ((ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === 'show'))) return 'available';
  return expression.properties.some(property => ts.isSpreadAssignment(property) || property.name && ts.isComputedPropertyName(property.name)) ? 'unknown' : 'missing';
}
function functionBody(binding?: UpgradeExportBinding): ts.Node | null {
  if (!binding) return null;
  if (ts.isFunctionDeclaration(binding.declaration)) return binding.declaration.body ?? null;
  if (ts.isVariableStatement(binding.declaration)) {
    const declaration = binding.declaration.declarationList.declarations.find(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === binding.localName);
    const expression = declaration?.initializer ? unwrap(declaration.initializer) : null;
    if (expression && (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression))) return expression.body;
  }
  return null;
}
function jsxAttribute(node: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
  return node.attributes.properties.find((attribute): attribute is ts.JsxAttribute => ts.isJsxAttribute(attribute) && attribute.name.getText() === name);
}
function walk(root: ts.Node, visit: (node: ts.Node) => void): boolean {
  const queue = [root]; let visited = 0;
  while (queue.length) {
    if (++visited > 100_000) return false;
    const node = queue.pop()!; visit(node); ts.forEachChild(node, child => { queue.push(child); });
  }
  return true;
}
function strings(node: ts.Node): string[] | null {
  const result: string[] = [];
  return walk(node, child => { if (ts.isStringLiteralLike(child)) result.push(child.text); }) ? result : null;
}
function dropdownViewport(binding?: UpgradeExportBinding): UpgradeEvidenceStatus {
  const body = functionBody(binding); if (!body) return 'unknown';
  let viewport = false, decoration = false, ref = false;
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const slot = jsxAttribute(node, 'data-slot');
      if (node.tagName.getText() === 'div' && slot?.initializer && ts.isStringLiteral(slot.initializer)
        && slot.initializer.text === 'dropdown-menu-viewport') {
        viewport = strings(jsxAttribute(node, 'className') ?? node)?.some(text => /(?:^|\s)overflow-y-auto(?:\s|$)/u.test(text)) ?? false;
        ref = !!jsxAttribute(node, 'ref')?.initializer;
      }
      if (node.tagName.getText() === 'ScrollViewportDecoration' && jsxAttribute(node, 'viewport')?.initializer) decoration = true;
    }
  };
  if (!walk(body, visit)) return 'unknown';
  return viewport && decoration && ref ? 'available' : 'missing';
}
function richSelect(binding?: UpgradeExportBinding): UpgradeEvidenceStatus {
  const body = functionBody(binding); if (!body || !binding) return 'unknown';
  const labels = strings(body); if (!labels) return 'unknown';
  const classes = new Set(labels);
  const parts = ['zero-select-item-leading', 'zero-select-item-description', 'zero-select-item-trailing'];
  let itemText = false; const visit = (node: ts.Node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText().endsWith('.ItemText')) itemText = true;
  };
  if (!walk(body, visit)) return 'unknown';
  return itemText && parts.every(part => classes.has(part)) ? 'available' : 'missing';
}
function stable(value: unknown): string {
  // Iterative serialization also fences deeply nested, untrusted JSON from the JavaScript call stack.
  type Task = { value: unknown } | { token: string };
  const tasks: Task[] = [{ value }], output: string[] = [];
  while (tasks.length) {
    const task = tasks.pop()!;
    if ('token' in task) { output.push(task.token); continue; }
    const item = task.value;
    if (!Array.isArray(item) && !object(item)) { output.push(JSON.stringify(item) ?? 'null'); continue; }
    const children: Task[] = [{ token: Array.isArray(item) ? '[' : '{' }];
    const keys = Array.isArray(item) ? item.map((_, index) => String(index)) : Object.keys(item).sort();
    keys.forEach((key, index) => {
      if (index) children.push({ token: ',' });
      if (!Array.isArray(item)) children.push({ token: JSON.stringify(key) + ':' });
      children.push({ value: Array.isArray(item) ? item[Number(key)] : item[key] });
    });
    children.push({ token: Array.isArray(item) ? ']' : '}' });
    for (let index = children.length - 1; index >= 0; index--) tasks.push(children[index]!);
  }
  return output.join('');
}
