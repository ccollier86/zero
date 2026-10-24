/** Grammar-based email CSS filtering. CSS Tree is a parser, not this policy. */
import * as css from 'css-tree';
import { EMAIL_HTML_LIMITS, EmailHtmlError } from './email-html-policy';

const PROPERTIES = new Set(('color background-color background-image background background-position background-size background-repeat '
  + 'border border-top border-right border-bottom border-left border-color border-width border-style border-collapse border-spacing border-radius '
  + 'border-top-left-radius border-top-right-radius border-bottom-left-radius border-bottom-right-radius '
  + 'box-sizing box-shadow caption-side clear direction display empty-cells float font font-family font-size font-style font-weight '
  + 'font-variant font-variant-numeric height width min-width max-width min-height max-height letter-spacing line-height '
  + 'list-style list-style-type list-style-position margin margin-top margin-right margin-bottom margin-left opacity overflow overflow-x overflow-y '
  + 'overflow-wrap word-break word-wrap padding padding-top padding-right padding-bottom padding-left table-layout text-align text-decoration '
  + 'text-decoration-color text-decoration-line text-decoration-style text-indent text-transform text-overflow vertical-align visibility white-space '
  + 'word-spacing flex flex-basis flex-direction flex-grow flex-shrink flex-wrap align-items align-content align-self justify-content gap row-gap column-gap '
  + 'grid-template-columns grid-template-rows grid-column grid-row place-items').split(' '));
const FUNCTIONS = new Set(('rgb rgba hsl hsla hwb lab lch oklab oklch color color-mix calc min max clamp '
  + 'linear-gradient radial-gradient repeating-linear-gradient repeating-radial-gradient repeat minmax fit-content').split(' '));

export interface EmailCssBudget { bytes: number; rules: number }
export function createEmailCssBudget(): EmailCssBudget { return { bytes: 0, rules: 0 }; }

export function sanitizeEmailCss(source: string, inline: boolean, budget: EmailCssBudget): string {
  budget.bytes += new TextEncoder().encode(source).byteLength;
  if (budget.bytes > EMAIL_HTML_LIMITS.cssBytes) throw new EmailHtmlError('Email styles exceed the safe rendering limit.');
  let ast: css.CssNode;
  try { ast = css.parse(source, { context: inline ? 'declarationList' : 'stylesheet', positions: false }); }
  catch { return ''; }

  const declarations = (block: css.CssNode): string => {
    if (!('children' in block) || !block.children) return '';
    const result: string[] = [];
    block.children.forEach(node => {
      if (++budget.rules > EMAIL_HTML_LIMITS.rules) throw new EmailHtmlError('Email styles contain too many rules.');
      if (node.type !== 'Declaration') return;
      const property = css.ident.decode(node.property).toLowerCase();
      if (!PROPERTIES.has(property)) return;
      let allowed = true;
      css.walk(node.value, child => {
        if (child.type === 'Raw' || child.type === 'Url' || child.type === 'Atrule') allowed = false;
        if (child.type === 'Function' && !FUNCTIONS.has(css.ident.decode(child.name).toLowerCase())) allowed = false;
        if ((child.type === 'Dimension' || child.type === 'Number' || child.type === 'Percentage') && Math.abs(Number(child.value)) > 10_000) allowed = false;
      });
      if (!allowed || css.lexer.matchProperty(property, node.value).error) return;
      // A reader owns overflow. Sender CSS must not install hidden scroll traps.
      if (property.startsWith('overflow') && !['overflow-wrap'].includes(property)) return;
      result.push(`${property}:${css.generate(node.value)}${node.important ? '!important' : ''}`);
    });
    return result.join(';');
  };
  const rules = (tree: css.CssNode, depth = 0): string => {
    if (depth > 2 || !('children' in tree) || !tree.children) return '';
    const result: string[] = [];
    tree.children.forEach(node => {
      if (++budget.rules > EMAIL_HTML_LIMITS.rules) throw new EmailHtmlError('Email styles contain too many rules.');
      if (node.type === 'Rule') {
        let allowed = true, count = 0;
        css.walk(node.prelude, child => { if (child.type === 'Raw' || ++count > 128) allowed = false; });
        if (!allowed) return;
        const body = declarations(node.block);
        if (body) result.push(`${css.generate(node.prelude)}{${body}}`);
      } else if (node.type === 'Atrule' && css.ident.decode(node.name).toLowerCase() === 'media' && node.prelude && node.block) {
        let allowed = true;
        css.walk(node.prelude, child => {
          if (child.type === 'Raw' || child.type === 'Url' || child.type === 'Function') allowed = false;
          if ('name' in child && typeof child.name === 'string' && /height|resolution|container/i.test(css.ident.decode(child.name))) allowed = false;
        });
        const condition = css.generate(node.prelude);
        if (!allowed || condition.length > 512) return;
        const body = rules(node.block, depth + 1);
        if (body) result.push(`@media ${condition}{${body}}`);
      }
    });
    return result.join('\n');
  };
  // CSS text must remain CSS when serialized inside an HTML raw-text element.
  return (inline ? declarations(ast) : rules(ast)).replace(/</g, '\\3c ');
}
