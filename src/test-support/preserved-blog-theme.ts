/** Exact approved blog style admission. Never rebaseline or normalize any original theme byte. */
const BLOG_STYLE_ADDITION = '@import "../../components/blog/blog.css";\n@import "../../components/command-palette/command-palette.css";\n@import "../../components/ui/pagination.css";\n';
export function originalThemeBeforeBlogStyles(source: string): string {
  const at = source.indexOf(BLOG_STYLE_ADDITION);
  if (at < 0 || source.indexOf(BLOG_STYLE_ADDITION, at + 1) >= 0) throw new Error('The exact approved blog stylesheet addition is missing or duplicated.');
  return source.slice(0, at) + source.slice(at + BLOG_STYLE_ADDITION.length);
}
