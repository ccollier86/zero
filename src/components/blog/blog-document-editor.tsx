'use client';

/** Canonical block assembly with stable IDs. Uses Zero controls and the isolated inline editor; never writes a database. */
import * as React from 'react';
import { ArrowUp } from '../animate-ui/icons/arrow-up';
import { ArrowDown } from '../animate-ui/icons/arrow-down';
import { Trash as Trash2 } from '../animate-ui/icons/trash';
import { Plus } from '../animate-ui/icons/plus';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import type { BlogDocument, BlogDocumentBlock, BlogImageReference, BlogInlineText } from '../../blog/content-types';
import { BlogInlineInput, type BlogInlineInputProps } from './blog-inline-input';
import type { BlogMediaKind } from '../../blog/media-types';

export interface BlogDocumentEditorProps {
  value: BlogDocument;
  onChange(value: BlogDocument): void;
  disabled?: boolean;
  renderSelectionMenu?: BlogInlineInputProps['renderSelectionMenu'];
  /** The composing workspace supplies the native private media library; apps can provide another authorized selector. */
  renderMediaPicker?: (props: { kind: BlogMediaKind; value: string; onChange(id: string): void; disabled?: boolean }) => React.ReactNode;
}
/** Every placement has its own alternative text. Reusing a library asset never silently reuses contextual alt text. */
export function BlogImageFields({ value, onChange, disabled, renderMediaPicker }: { value: BlogImageReference; onChange(value: BlogImageReference): void; disabled?: boolean; renderMediaPicker?: BlogDocumentEditorProps['renderMediaPicker'] }) {
  return <div className="zero-blog-image-fields">
    {renderMediaPicker?.({ kind: 'image', value: value.mediaId, onChange: mediaId => onChange({ ...value, mediaId }), disabled }) ?? <label>Image asset ID<Input value={value.mediaId} disabled={disabled} onChange={event => onChange({ ...value, mediaId: event.target.value })} /></label>}
    <label>Alternative text<Input value={value.alt} maxLength={2000} disabled={disabled || value.decorative} onChange={event => onChange({ ...value, alt: event.target.value })} /></label>
    <label className="zero-blog-check"><input type="checkbox" checked={value.decorative ?? false} disabled={disabled} onChange={event => onChange({ ...value, decorative: event.target.checked, alt: event.target.checked ? '' : value.alt })} />Decorative image (empty alternative text)</label>
    <label>Caption<Input value={value.caption ?? ''} maxLength={2000} disabled={disabled} onChange={event => onChange({ ...value, caption: event.target.value })} /></label>
  </div>;
}
export function BlogDocumentEditor({ value, onChange, disabled, renderSelectionMenu, renderMediaPicker }: BlogDocumentEditorProps) {
  const [active, setActive] = React.useState<string | null>(null);
  const update = (id: string, block: BlogDocumentBlock) => onChange({ version: 1, blocks: value.blocks.map(item => item.id === id ? block : item) });
  const add = (type: BlogDocumentBlock['type']) => { if (value.blocks.length >= 500) return; const block = emptyBlock(type); onChange({ version: 1, blocks: [...value.blocks, block] }); setActive(block.id); };
  const move = (index: number, direction: -1 | 1) => { const blocks = [...value.blocks], target = index + direction; if (target < 0 || target >= blocks.length) return; [blocks[index], blocks[target]] = [blocks[target]!, blocks[index]!]; onChange({ version: 1, blocks }); };
  const inline = (block: BlogDocumentBlock, content: readonly BlogInlineText[], change: (runs: readonly BlogInlineText[]) => void, suffix = '') =>
    <BlogInlineInput value={content} onChange={change} label={`Edit ${block.type} ${value.blocks.findIndex(item => item.id === block.id) + 1}${suffix}`} disabled={disabled}
      active={active === block.id + suffix} onActivate={() => setActive(block.id + suffix)} renderSelectionMenu={renderSelectionMenu} />;
  const media = (kind: BlogMediaKind, id: string, change: (id: string) => void) => renderMediaPicker?.({ kind, value: id, onChange: change, disabled })
    ?? <label>{kind} asset ID<Input value={id} disabled={disabled} onChange={event => change(event.target.value)} /></label>;
  return <section className="zero-blog-document-editor" aria-label="Article blocks">
    {value.blocks.map((block, index) => <section key={block.id} className="zero-blog-editor-block" data-block-type={block.type}>
      <header><span>{block.type === 'heading' ? `Heading ${block.level}` : block.type}</span><div className="zero-blog-format-tools">
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move block ${index + 1} up`} disabled={disabled || index === 0} onClick={() => move(index, -1)}><ArrowUp /></Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move block ${index + 1} down`} disabled={disabled || index === value.blocks.length - 1} onClick={() => move(index, 1)}><ArrowDown /></Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove block ${index + 1}`} disabled={disabled} onClick={() => onChange({ version: 1, blocks: value.blocks.filter(item => item.id !== block.id) })}><Trash2 /></Button>
      </div></header>
      {'content' in block && <>
        {block.type === 'heading' && <Select value={String(block.level)} disabled={disabled} onValueChange={level => update(block.id, { ...block, level: Number(level) as 2 })}><SelectTrigger aria-label="Heading level"><SelectValue /></SelectTrigger><SelectContent>{[2, 3, 4, 5, 6].map(level => <SelectItem key={level} value={String(level)}>Heading {level}</SelectItem>)}</SelectContent></Select>}
        {block.type === 'callout' && <><Select value={block.tone} disabled={disabled} onValueChange={tone => update(block.id, { ...block, tone: tone as 'info' })}><SelectTrigger aria-label="Callout tone"><SelectValue /></SelectTrigger><SelectContent>{['info', 'tip', 'success', 'warning', 'error'].map(tone => <SelectItem key={tone} value={tone}>{tone}</SelectItem>)}</SelectContent></Select><label>Callout title<Input value={block.title ?? ''} disabled={disabled} onChange={event => update(block.id, { ...block, title: event.target.value })} /></label></>}
        {inline(block, block.content, content => update(block.id, { ...block, content }))}
        {block.type === 'quote' && <label>Attribution<Input value={block.attribution ?? ''} disabled={disabled} onChange={event => update(block.id, { ...block, attribution: event.target.value })} /></label>}
      </>}
      {block.type === 'list' && <><label className="zero-blog-check"><input type="checkbox" checked={block.ordered} disabled={disabled} onChange={event => update(block.id, { ...block, ordered: event.target.checked })} />Numbered list</label>
        {block.items.map((item, i) => <div key={i} className="zero-blog-list-editor-item">{inline(block, item, content => update(block.id, { ...block, items: block.items.map((entry, j) => i === j ? content : entry) }), ` item ${i + 1}`)}<Button type="button" size="icon-sm" variant="ghost" disabled={disabled} aria-label={`Remove list item ${i + 1}`} onClick={() => update(block.id, { ...block, items: block.items.filter((_, j) => i !== j) })}><Trash2 /></Button></div>)}
        <Button type="button" variant="ghost" disabled={disabled || block.items.length >= 200} onClick={() => update(block.id, { ...block, items: [...block.items, []] })}>Add list item</Button></>}
      {block.type === 'code' && <><label>Language<Input value={block.language} disabled={disabled} onChange={event => update(block.id, { ...block, language: event.target.value })} /></label><label>File name<Input value={block.filename ?? ''} disabled={disabled} onChange={event => update(block.id, { ...block, filename: event.target.value })} /></label><label>Code<Textarea value={block.code} spellCheck={false} disabled={disabled} onChange={event => update(block.id, { ...block, code: event.target.value })} /></label></>}
      {block.type === 'image' && <BlogImageFields value={block.image} onChange={image => update(block.id, { ...block, image })} disabled={disabled} renderMediaPicker={renderMediaPicker} />}
      {block.type === 'gallery' && <><Select value={block.layout} disabled={disabled} onValueChange={layout => update(block.id, { ...block, layout: layout as 'grid' })}><SelectTrigger aria-label="Gallery layout"><SelectValue /></SelectTrigger><SelectContent>{['grid', 'carousel', 'stack'].map(layout => <SelectItem key={layout} value={layout}>{layout}</SelectItem>)}</SelectContent></Select>
        <Select value={String(block.columns)} disabled={disabled} onValueChange={columns => update(block.id, { ...block, columns: Number(columns) as 2 })}><SelectTrigger aria-label="Gallery columns"><SelectValue /></SelectTrigger><SelectContent>{[2, 3, 4].map(columns => <SelectItem key={columns} value={String(columns)}>{columns} columns</SelectItem>)}</SelectContent></Select>
        {block.images.map((image, i) => <div key={i}><BlogImageFields value={image} onChange={next => update(block.id, { ...block, images: block.images.map((entry, j) => i === j ? next : entry) })} disabled={disabled} renderMediaPicker={renderMediaPicker} /><Button type="button" variant="ghost" disabled={disabled} onClick={() => update(block.id, { ...block, images: block.images.filter((_, j) => i !== j) })}>Remove image {i + 1}</Button></div>)}
        <Button type="button" variant="outline" disabled={disabled || block.images.length >= 40} onClick={() => update(block.id, { ...block, images: [...block.images, { mediaId: '', alt: '' }] })}>Add image</Button></>}
      {(block.type === 'audio' || block.type === 'video') && <>{media(block.type, block.mediaId, mediaId => update(block.id, { ...block, mediaId }))}<label>Title<Input value={block.title} disabled={disabled} onChange={event => update(block.id, { ...block, title: event.target.value })} /></label>
        {block.type === 'audio' && <label>Artist<Input value={block.artist ?? ''} disabled={disabled} onChange={event => update(block.id, { ...block, artist: event.target.value })} /></label>}
        <details><summary>{block.type === 'video' ? 'Poster image' : 'Cover image'}</summary><BlogImageFields value={(block.type === 'video' ? block.poster : block.cover) ?? { mediaId: '', alt: '' }} disabled={disabled} renderMediaPicker={renderMediaPicker} onChange={image => update(block.id, block.type === 'video' ? { ...block, poster: image } : { ...block, cover: image })} />
          <Button type="button" variant="ghost" disabled={disabled} onClick={() => { const next = { ...block }; if (next.type === 'video') delete next.poster; else delete next.cover; update(block.id, next); }}>Remove artwork</Button></details></>}
      {block.type === 'embed' && <><label>Link URL<Input value={block.url} disabled={disabled} onChange={event => update(block.id, { ...block, url: event.target.value })} /></label><label>Title<Input value={block.title} disabled={disabled} onChange={event => update(block.id, { ...block, title: event.target.value })} /></label><label>Description<Textarea value={block.description ?? ''} disabled={disabled} onChange={event => update(block.id, { ...block, description: event.target.value })} /></label></>}
      {block.type === 'divider' && <hr />}
    </section>)}
    <div className="zero-blog-block-inserter"><Plus aria-hidden="true" /><Select value="" disabled={disabled || value.blocks.length >= 500} onValueChange={type => add(type as BlogDocumentBlock['type'])}><SelectTrigger aria-label="Add article block"><SelectValue placeholder="Add a block…" /></SelectTrigger><SelectContent>{['paragraph', 'heading', 'quote', 'list', 'callout', 'code', 'image', 'gallery', 'video', 'audio', 'embed', 'divider'].map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select></div>
  </section>;
}
function emptyBlock(type: BlogDocumentBlock['type']): BlogDocumentBlock {
  const id = 'b_' + crypto.randomUUID();
  switch (type) {
    case 'paragraph': return { id, type, content: [] };
    case 'heading': return { id, type, level: 2, content: [] };
    case 'quote': return { id, type, content: [] };
    case 'list': return { id, type, ordered: false, items: [[]] };
    case 'callout': return { id, type, tone: 'info', content: [] };
    case 'code': return { id, type, code: '', language: 'text' };
    case 'image': return { id, type, image: { mediaId: '', alt: '' } };
    case 'gallery': return { id, type, images: [], layout: 'grid', columns: 2 };
    case 'video': case 'audio': return { id, type, title: '', mediaId: '' };
    case 'embed': return { id, type, title: '', url: '' };
    case 'divider': return { id, type };
  }
}
