'use client';

/** Restricted rich-text editor with shared Zero controls and a selection bubble. No persistence, raw HTML wire format or remote assets. */
import * as React from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import CodeMark from '@tiptap/extension-code';
import DOMPurify from 'dompurify';
import { Bold, Italic, Underline, Strikethrough, Code } from 'lucide-react';
import { Link as LinkIcon } from '../animate-ui/icons/link';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Popover, PopoverTrigger, PopoverContent } from '../popover';
import { BlogRichText } from './blog-rich-text';
import { safeBlogHref } from './blog-utils';
import type { BlogInlineText } from '../../blog/content-types';
import { blogInlineFromEditor, blogInlineToEditor } from './editor-inline-codec';

export interface BlogInlineInputProps {
  value: readonly BlogInlineText[];
  onChange(value: readonly BlogInlineText[]): void;
  label: string;
  disabled?: boolean;
  active?: boolean;
  onActivate?: () => void;
  /** Replace the selection toolbar without replacing the canonical document or save controller. */
  renderSelectionMenu?: (editor: Editor) => React.ReactNode;
}
/** Only the focused block mounts an editor, keeping long documents from instantiating hundreds of engines. */
export function BlogInlineInput(props: BlogInlineInputProps) {
  const [editing, setEditing] = React.useState(false);
  const activate = () => { if (!props.disabled) { setEditing(true); props.onActivate?.(); } };
  return (props.active ?? editing) && !props.disabled ? <ActiveInlineInput {...props} /> : <div role="button" tabIndex={props.disabled ? -1 : 0} aria-label={props.label}
    className="zero-blog-inline-idle" aria-disabled={props.disabled || undefined} onClick={event => { event.preventDefault(); activate(); }}
    onKeyDown={event => { if (!props.disabled && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); activate(); } }}>
    {props.value.some(run => run.text) ? <BlogRichText content={props.value} /> : <span className="zero-blog-muted">Write something…</span>}
  </div>;
}
function ActiveInlineInput({ value, onChange, label, disabled, renderSelectionMenu }: BlogInlineInputProps) {
  const latest = React.useRef(onChange); latest.current = onChange;
  const last = React.useRef(JSON.stringify(value));
  const [invalid, setInvalid] = React.useState(false);
  const editor = useEditor({ immediatelyRender: false, autofocus: 'end', editable: !disabled,
    extensions: [StarterKit.configure({ heading: false, blockquote: false, codeBlock: false, code: false, bulletList: false, orderedList: false, listItem: false, horizontalRule: false,
      link: { openOnClick: false, autolink: false, isAllowedUri: url => Boolean(safeBlogHref(url)) } }), CodeMark.extend({ excludes: '' })],
    content: blogInlineToEditor(value), editorProps: { attributes: { role: 'textbox', 'aria-label': label, 'aria-multiline': 'true', class: 'zero-blog-inline-editor' },
      transformPastedHTML: html => DOMPurify.sanitize(html, { ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'code', 'a'], ALLOWED_ATTR: ['href'], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false }) },
    onUpdate: ({ editor: current }) => { try { const next = blogInlineFromEditor(current.getJSON()); last.current = JSON.stringify(next); latest.current(next); setInvalid(false); }
      catch { current.commands.setContent(blogInlineToEditor(JSON.parse(last.current) as BlogInlineText[]), { emitUpdate: false }); setInvalid(true); } },
  });
  React.useEffect(() => { editor?.setEditable(!disabled); }, [editor, disabled]);
  React.useEffect(() => { const json = JSON.stringify(value); if (editor && json !== last.current) { last.current = json; editor.commands.setContent(blogInlineToEditor(value), { emitUpdate: false }); } }, [editor, value]);
  return <div><EditorContent editor={editor} />{editor && <>
    <div className="zero-blog-inline-formatting"><Formatting editor={editor} /></div>
    <BubbleMenu editor={editor} options={{ placement: 'top', offset: 8 }}><div className="zero-blog-selection-menu">{renderSelectionMenu?.(editor) ?? <Formatting editor={editor} />}</div></BubbleMenu>
  </>}{invalid && <p role="alert">That unsupported edit was not applied. Your last valid text is preserved.</p>}</div>;
}
function Formatting({ editor }: { editor: Editor }) {
  const [open, setOpen] = React.useState(false), [url, setUrl] = React.useState('');
  const state = useEditorState({ editor, selector: ({ editor: current }) => ({ bold: current.isActive('bold'), italic: current.isActive('italic'), underline: current.isActive('underline'), strike: current.isActive('strike'), code: current.isActive('code'), link: current.isActive('link') }) });
  return <div role="toolbar" aria-label="Text formatting" className="zero-blog-format-tools">
    <Button type="button" variant="ghost" size="icon-sm" aria-label="Bold" aria-pressed={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}><Bold /></Button>
    <Button type="button" variant="ghost" size="icon-sm" aria-label="Italic" aria-pressed={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic /></Button>
    <Button type="button" variant="ghost" size="icon-sm" aria-label="Underline" aria-pressed={state.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline /></Button>
    <Button type="button" variant="ghost" size="icon-sm" aria-label="Strikethrough" aria-pressed={state.strike} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough /></Button>
    <Button type="button" variant="ghost" size="icon-sm" aria-label="Inline code" aria-pressed={state.code} onClick={() => editor.chain().focus().toggleCode().run()}><Code /></Button>
    <Popover open={open} onOpenChange={next => { setOpen(next); if (next) setUrl(String(editor.getAttributes('link').href ?? '')); }}>
      <PopoverTrigger asChild><Button type="button" variant="ghost" size="icon-sm" aria-label="Add or edit link" aria-pressed={state.link}><LinkIcon /></Button></PopoverTrigger>
      <PopoverContent><label>Link URL<Input value={url} maxLength={2048} onChange={event => setUrl(event.currentTarget.value)} /></label><div className="zero-blog-format-tools">
        <Button type="button" variant="ghost" onClick={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); setOpen(false); }}>Remove link</Button>
        <Button type="button" disabled={!safeBlogHref(url)} onClick={() => { const href = safeBlogHref(url); if (href) editor.chain().focus().extendMarkRange('link').setLink({ href }).run(); setOpen(false); }}>Apply</Button>
      </div></PopoverContent>
    </Popover>
  </div>;
}
