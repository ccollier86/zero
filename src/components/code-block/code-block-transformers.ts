/** Token-safe Shiki transforms, adapting pheralb's complete Shiki feature family. */
import type { ShikiTransformer } from 'shiki';
import { parseMetaHighlightWords, transformerNotationDiff, transformerNotationFocus,
  transformerNotationHighlight, transformerNotationWordHighlight } from '@shikijs/transformers';
import type { CodeBlockHighlightOptions } from './code-block.types';
import { readCodeBlockMetadata } from './code-block-metadata';

/** Fresh transforms per render prevent mutable metadata leaking across blocks. */
export function createCodeBlockTransformers(options: CodeBlockHighlightOptions, maxLine = 100_000): ShikiTransformer[] {
  const metadata = readCodeBlockMetadata(options, maxLine);
  const highlighted = new Set(metadata.highlightLines);
  const transforms: ShikiTransformer[] = [literalWordHighlights([
    ...parseMetaHighlightWords(options.meta ?? ''), ...options.highlightWords ?? [],
  ])];
  if (options.annotations !== false) transforms.push(
    transformerNotationDiff({ matchAlgorithm: 'v3' }),
    transformerNotationFocus({ matchAlgorithm: 'v3' }),
    transformerNotationHighlight({ classActiveLine: 'zero-code-highlighted', matchAlgorithm: 'v3' }),
    transformerNotationWordHighlight({ classActiveWord: 'zero-code-word-highlight', matchAlgorithm: 'v3' }),
  );
  transforms.push(...options.transformers ?? [], {
    name: 'zero:code-block-presentation', enforce: 'post',
    pre(node) {
      node.properties['data-language'] = this.options.lang;
      if (metadata.title) node.properties['data-title'] = metadata.title;
      if (metadata.wordWrap) node.properties['data-word-wrap'] = 'true';
      if (metadata.lineNumbers) node.properties['data-line-numbers'] = 'true';
    },
    line(node, sourceLine) {
      const line = metadata.startLine + sourceLine - 1;
      node.properties['data-line-number'] = line;
      if (highlighted.has(sourceLine)) this.addClassToHast(node, 'zero-code-highlighted');
    },
    code(node) {
      // Annotation transforms inspect token children in their code hook. Insert
      // non-token anchor elements only after those hooks have finished.
      const prefix = metadata.prefix?.trim().replace(/\s+/g, '-');
      if (!prefix) return;
      for (const child of node.children) {
        if (child.type !== 'element' || child.tagName !== 'span') continue;
        const line = child.properties['data-line-number'];
        if (typeof line !== 'number') continue;
        const id = `${prefix}-l${line}`;
        child.properties.id = id;
        child.children.unshift({ type: 'element', tagName: 'a', properties: {
          className: ['zero-code-line-anchor'], href: `#${encodeURIComponent(id)}`, ariaLabel: `Link to line ${line}`, tabIndex: 0,
        }, children: [] });
      }
    },
  });
  return transforms;
}

function literalWordHighlights(words: readonly string[]): ShikiTransformer {
  const uniqueWords = new Set(words.filter(Boolean));
  if (uniqueWords.size > 2048) throw new RangeError('Code highlight word budget exceeded.');
  return { name: 'zero:literal-word-highlights', preprocess(code, options) {
    for (const word of uniqueWords) {
      let cursor = 0;
      while (cursor < code.length) {
        const index = code.indexOf(word, cursor);
        if (index < 0) break;
        if ((options.decorations?.length ?? 0) >= 20_000) throw new RangeError('Code highlight decoration budget exceeded.');
        (options.decorations ??= []).push({ start: index, end: index + word.length,
          properties: { className: ['zero-code-word-highlight'] } });
        cursor = index + word.length;
      }
    }
  } };
}
