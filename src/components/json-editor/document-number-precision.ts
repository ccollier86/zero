/** Compare decimal meaning with the JavaScript numeric projection. Source precision is never inferred from rounded equality. */
export function losesDocumentNumberPrecision(text: string, value: number) {
  const decimal = (source: string) => {
    const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/u.exec(source);
    if (!match) return source;
    let digits = (match[2]! + (match[3] ?? '')).replace(/^0+/u, ''); if (!digits) return '0';
    const trailing = /0*$/u.exec(digits)![0].length; digits = digits.slice(0, digits.length - trailing);
    return `${match[1]}${digits}e${Number(match[4] ?? 0) - (match[3]?.length ?? 0) + trailing}`;
  };
  return decimal(text) !== decimal(String(value));
}
export function jsonSourceNeedsExactNumbers(source: string) {
  const pattern = /"(?:[^"\\]|\\.)*"|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) if (match[1] && losesDocumentNumberPrecision(match[1], Number(match[1]))) return true;
  return false;
}
/** Pretty-print admitted JSON tokens, preserving the exact number/string lexemes. */
export function formatJsonSourceTokens(source: string) {
  const tokens = source.match(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\],:]/gu) ?? [];
  let depth = 0; const parts: string[] = [], newline = () => parts.push('\n' + '  '.repeat(depth));
  tokens.forEach((token, index) => {
    if (token === '{' || token === '[') { parts.push(token); if (tokens[index + 1] !== (token === '{' ? '}' : ']')) { depth++; newline(); } }
    else if (token === '}' || token === ']') { if (tokens[index - 1] !== (token === '}' ? '{' : '[')) { depth--; newline(); } parts.push(token); }
    else if (token === ',') { parts.push(token); newline(); }
    else parts.push(token === ':' ? ': ' : token);
  });
  return parts.join('');
}
