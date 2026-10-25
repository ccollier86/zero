'use client';

/** Typed UI blocks, not a parser/editor/CMS. Text stays escaped; applications supply trusted custom React content themselves. */
import * as React from 'react';
import { CodeBlock } from '../code-block';
import { Typography } from './blog-primitives';
import { ContentImage, ImageGallery, ImageCarousel, ImageStack } from './blog-images';
import { AudioPlayer, VideoPlayer } from './blog-media';
import { InlineLink, InlineLinkPreview } from './blog-content';
import { blogHeadingId } from './blog-utils';
import type { BlogContentBlock } from './blog.types';

export function BlockRenderer({ blocks }: { blocks: readonly BlogContentBlock[] }) {
  return <>{blocks.map((block, index) => {
    const key = block.id ?? index;
    switch (block.type) {
      case 'paragraph': return <Typography key={key}>{block.text}</Typography>;
      case 'heading': return <Typography key={key} variant={`h${block.level}`} id={block.anchor ?? blogHeadingId(block.text, index)}>{block.text}</Typography>;
      case 'quote': return <blockquote key={key}><p>{block.text}</p>{(block.author || block.source) && <footer>{block.author}{block.author && block.source ? ' — ' : ''}{block.source}</footer>}</blockquote>;
      case 'callout': return <aside key={key} className="zero-blog-callout" data-tone={block.variant}>{block.title && <strong>{block.title}</strong>}<p>{block.text}</p></aside>;
      case 'list': return block.style === 'numbered' ? <ol key={key}>{block.items.map((item, i) => <li key={i}>{item}</li>)}</ol> : <ul key={key}>{block.items.map((item, i) => <li key={i}>{item}</li>)}</ul>;
      case 'code': return <CodeBlock key={key} code={block.code} language={block.language ?? 'text'} filename={block.filename} showLineNumbers={block.showLineNumbers} highlightLines={block.highlightLines} />;
      case 'image': return <ContentImage key={key} {...block} />;
      case 'image-gallery': return block.layout === 'carousel' ? <ImageCarousel key={key} images={block.images} /> : block.layout === 'stack' ? <ImageStack key={key} images={block.images} columns={block.columns} /> : <ImageGallery key={key} images={block.images} columns={block.columns} />;
      case 'video': return <VideoPlayer key={key} {...block} />;
      case 'audio': return <AudioPlayer key={key} {...block} />;
      case 'divider': return <hr key={key} />;
      case 'embed': return <InlineLinkPreview key={key} href={block.url} title={block.title} description={block.description} image={block.image}>{block.title ?? block.url}</InlineLinkPreview>;
      case 'citation': return <p key={key}>{block.text} <cite>{block.url ? <InlineLink href={block.url}>{block.source}</InlineLink> : block.source}</cite></p>;
      default: return null;
    }
  })}</>;
}
