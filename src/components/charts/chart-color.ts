/**
 * chart-color.ts
 *
 * Owns a bounded, SSR-safe grammar for resource-free chart colors. This pure
 * presentation boundary consumes no DOM/CSS parser, resolves no theme tokens,
 * and never admits images, CSS-wide keywords, relative colors or arithmetic.
 */

const NAMED_COLORS = new Set((
  'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan '
  + 'darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet '
  + 'deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush '
  + 'lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen '
  + 'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid '
  + 'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen transparent currentcolor'
).split(' '));
const RECTANGULAR_SPACES = new Set(['srgb', 'srgb-linear', 'display-p3', 'a98-rgb', 'prophoto-rgb', 'rec2020', 'lab', 'oklab', 'xyz', 'xyz-d50', 'xyz-d65']);
const POLAR_SPACES = new Set(['hsl', 'hwb', 'lch', 'oklch']);
const PROFILE_SPACES = new Set(['srgb', 'srgb-linear', 'display-p3', 'a98-rgb', 'prophoto-rgb', 'rec2020', 'xyz', 'xyz-d50', 'xyz-d65']);
const MAX_DEPTH = 12;

/** Split only outer separators; nested functions retain their original grammar. */
function splitOuter(value: string, separator: ',' | '/' | 'space'): string[] {
  const result: string[] = [];
  let depth = 0, start = 0;
  for (let index = 0; index < value.length; index++) {
    const char = value[index]!;
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (depth === 0 && (separator === 'space' ? /\s/.test(char) : char === separator)) {
      const part = value.slice(start, index).trim();
      if (part || separator !== 'space') result.push(part);
      start = index + 1;
    }
  }
  const part = value.slice(start).trim();
  if (part || separator !== 'space') result.push(part);
  return result;
}

function functionParts(value: string): { name: string; body: string } | null {
  const match = /^([a-z][a-z-]*)\(/i.exec(value);
  if (!match || !value.endsWith(')')) return null;
  let depth = 0;
  for (let index = match[0].length - 1; index < value.length; index++) {
    if (value[index] === '(') depth++;
    if (value[index] === ')' && (--depth < 0 || (depth === 0 && index !== value.length - 1))) return null;
  }
  return depth === 0 ? { name: match[1]!.toLowerCase(), body: value.slice(match[0].length, -1).trim() } : null;
}

/** Variables refer only to trusted theme tokens; every explicit fallback is validated in its own context. */
function variable(value: string, depth: number, fallback: (value: string, depth: number) => boolean): boolean {
  const parsed = functionParts(value);
  if (depth > MAX_DEPTH || parsed?.name !== 'var') return false;
  const parts = splitOuter(parsed.body, ',');
  if (!/^--[-_a-z\d]+$/i.test(parts[0] ?? '')) return false;
  return parts.length === 1 || fallback(parts.slice(1).join(',').trim(), depth + 1);
}

type Channel = 'number' | 'percentage' | 'hue';
function channel(value: string, kind: Channel, depth: number, missing = true): boolean {
  if (depth > MAX_DEPTH) return false;
  if (missing && value.toLowerCase() === 'none') return true;
  if (variable(value, depth, (fallback, nextDepth) => channel(fallback, kind, nextDepth, missing))) return true;
  const match = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(%|deg|grad|rad|turn)?$/i.exec(value);
  if (!match || !Number.isFinite(Number(match[1]))) return false;
  const unit = (match[2] ?? '').toLowerCase();
  return kind === 'percentage' ? unit === '%' : kind === 'hue' ? unit !== '%' : unit === '' || unit === '%';
}

/** Absolute color channels support legacy commas and modern space/slash syntax, including unresolved token tuples. */
function channels(body: string, kinds: readonly Channel[], depth: number, legacy: boolean): boolean {
  const comma = splitOuter(body, ',');
  if (comma.length > 1) {
    if (!legacy || splitOuter(body, '/').length !== 1 || (comma.length !== 3 && comma.length !== 4)) return false;
    if (!comma.slice(0, 3).every((value, index) => channel(value, kinds[index]!, depth, false))) return false;
    // Legacy RGB does not allow a mixture of raw number and percentage channels.
    if (kinds.every(kind => kind === 'number') && !comma.slice(0, 3).some(value => functionParts(value)?.name === 'var')) {
      if (comma.slice(0, 3).some(value => value.endsWith('%')) && !comma.slice(0, 3).every(value => value.endsWith('%'))) return false;
    }
    return comma.length === 3 || channel(comma[3]!, 'number', depth, false);
  }
  const slash = splitOuter(body, '/');
  if (slash.length > 2 || (slash.length === 2 && !channel(slash[1]!, 'number', depth))) return false;
  const values = splitOuter(slash[0]!, 'space');
  if (values.length === 1 && variable(values[0]!, depth, (fallback, nextDepth) => channels(fallback, kinds, nextDepth, legacy))) return true;
  return values.length === 3 && values.every((value, index) => channel(value, kinds[index]!, depth));
}

function colorStop(value: string, depth: number): { valid: boolean; percentage?: number } {
  const parts = splitOuter(value, 'space');
  if (parts.length < 1 || parts.length > 2 || !color(parts[0]!, depth)) return { valid: false };
  if (parts.length === 1) return { valid: true };
  if (!channel(parts[1]!, 'percentage', depth, false) || functionParts(parts[1]!)) return { valid: false };
  const percentage = Number(parts[1]!.slice(0, -1));
  return { valid: percentage >= 0 && percentage <= 100, percentage };
}

function color(value: string, depth = 0): boolean {
  if (depth > MAX_DEPTH) return false;
  const normalized = value.trim();
  if (NAMED_COLORS.has(normalized.toLowerCase()) || /^#(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})$/i.test(normalized)) return true;
  if (variable(normalized, depth, color)) return true;
  const parsed = functionParts(normalized);
  if (!parsed) return false;
  const nextDepth = depth + 1;
  switch (parsed.name) {
    case 'rgb': case 'rgba': return channels(parsed.body, ['number', 'number', 'number'], nextDepth, true);
    case 'hsl': case 'hsla': return channels(parsed.body, ['hue', 'percentage', 'percentage'], nextDepth, true);
    case 'hwb': return channels(parsed.body, ['hue', 'percentage', 'percentage'], nextDepth, false);
    case 'lab': case 'oklab': return channels(parsed.body, ['number', 'number', 'number'], nextDepth, false);
    case 'lch': case 'oklch': return channels(parsed.body, ['number', 'number', 'hue'], nextDepth, false);
    case 'color': {
      const parts = splitOuter(parsed.body, 'space'), profile = parts.shift()?.toLowerCase();
      return !!profile && PROFILE_SPACES.has(profile) && channels(parts.join(' '), ['number', 'number', 'number'], nextDepth, false);
    }
    case 'light-dark': {
      const parts = splitOuter(parsed.body, ',');
      return parts.length === 2 && parts.every(value => color(value, nextDepth));
    }
    case 'color-mix': {
      const parts = splitOuter(parsed.body, ',');
      if (parts.length !== 3) return false;
      const method = splitOuter(parts[0]!.toLowerCase(), 'space');
      if (method[0] !== 'in' || !(RECTANGULAR_SPACES.has(method[1]!) || POLAR_SPACES.has(method[1]!))) return false;
      if (method.length !== 2 && !(method.length === 4 && POLAR_SPACES.has(method[1]!) && ['shorter', 'longer', 'increasing', 'decreasing'].includes(method[2]!) && method[3] === 'hue')) return false;
      const first = colorStop(parts[1]!, nextDepth), second = colorStop(parts[2]!, nextDepth);
      return first.valid && second.valid && !(first.percentage === 0 && second.percentage === 0);
    }
    default: return false;
  }
}

/** Admit only complete supported color expressions, without browser globals or resource-capable CSS tokens. */
export function isChartCssColor(value: string): boolean {
  // The lexical envelope forbids escapes, comments, strings, declarations and
  // at-rules before the grammar sees them. Length and nesting bound all work.
  return value.length <= 256 && /^[a-z\d_\t\n\f\r #.,()%+\/-]+$/i.test(value) && color(value);
}
