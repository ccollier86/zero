'use client';
import * as React from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import DOMPurify from 'dompurify';
import { Bold, Italic, Underline, List, ListOrdered, Quote, Link, Undo, Redo } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../popover';
import { prepareEmailHtml } from './html/prepare-email-html';
import { emailUrl } from './html/email-html-policy';
import { EmailIconButton } from './email-inbox-parts';

export interface EmailRichTextInputProps { html: string; disabled?: boolean; onChange: (html: string, text: string) => void }
/** A separate, schema-limited composer policy. Received message HTML never enters the app editor unchanged. */
function composerHtml(value: string): string {
  if (typeof window === 'undefined') return '';
  try { return DOMPurify.sanitize(prepareEmailHtml(value).html, { ALLOWED_TAGS: ['p', 'div', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'blockquote', 'ul', 'ol', 'li', 'a', 'code', 'pre', 'hr'],
    ALLOWED_ATTR: ['href'], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false }); }
  catch { return ''; }
}
export function EmailRichTextInput({ html, disabled, onChange }: EmailRichTextInputProps) {
  const [linkOpen, setLinkOpen] = React.useState(false), [url, setUrl] = React.useState('');
  const editor = useEditor({ immediatelyRender: false, extensions: [StarterKit.configure({ heading: false, codeBlock: false,
    link: { openOnClick: false, autolink: true, isAllowedUri: value => !!emailUrl(value, 'link') } })],
    content: composerHtml(html), editable: !disabled,
    editorProps: { attributes: { role: 'textbox', 'aria-label': 'Message body', 'aria-multiline': 'true', class: 'zero-email-editor-input' },
      transformPastedHTML: composerHtml },
    onUpdate: ({ editor: current }) => onChange(current.getHTML(), current.getText()),
  });
  const active = useEditorState({ editor, selector: ({ editor: value }) => ({ bold: value?.isActive('bold'), italic: value?.isActive('italic'), underline: value?.isActive('underline'),
    bullet: value?.isActive('bulletList'), ordered: value?.isActive('orderedList'), quote: value?.isActive('blockquote'), link: value?.isActive('link') }) });
  React.useEffect(() => { editor?.setEditable(!disabled); }, [editor, disabled]);
  React.useEffect(() => { if (editor && html !== editor.getHTML()) editor.commands.setContent(composerHtml(html), { emitUpdate: false }); }, [editor, html]);
  return <div className="zero-email-rich-text">
    <div className="zero-email-formatting" role="toolbar" aria-label="Message formatting">
      <EmailIconButton label="Bold" disabled={!editor || disabled} aria-pressed={!!active?.bold} onClick={() => editor?.chain().focus().toggleBold().run()}><Bold className="size-3.5" /></EmailIconButton>
      <EmailIconButton label="Italic" disabled={!editor || disabled} aria-pressed={!!active?.italic} onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic className="size-3.5" /></EmailIconButton>
      <EmailIconButton label="Underline" disabled={!editor || disabled} aria-pressed={!!active?.underline} onClick={() => editor?.chain().focus().toggleUnderline().run()}><Underline className="size-3.5" /></EmailIconButton>
      <span className="mx-1 h-4 w-px bg-border" />
      <EmailIconButton label="Bulleted list" disabled={!editor || disabled} aria-pressed={!!active?.bullet} onClick={() => editor?.chain().focus().toggleBulletList().run()}><List className="size-3.5" /></EmailIconButton>
      <EmailIconButton label="Numbered list" disabled={!editor || disabled} aria-pressed={!!active?.ordered} onClick={() => editor?.chain().focus().toggleOrderedList().run()}><ListOrdered className="size-3.5" /></EmailIconButton>
      <EmailIconButton label="Quote" disabled={!editor || disabled} aria-pressed={!!active?.quote} onClick={() => editor?.chain().focus().toggleBlockquote().run()}><Quote className="size-3.5" /></EmailIconButton>
      <Popover open={linkOpen} onOpenChange={open => { setLinkOpen(open); if (open) setUrl(String(editor?.getAttributes('link').href ?? '')); }}><PopoverTrigger asChild><Button type="button" size="icon-sm" variant="ghost" aria-label="Insert link" aria-pressed={!!active?.link} disabled={!editor || disabled}><Link className="size-3.5" /></Button></PopoverTrigger><PopoverContent className="w-72 p-3"><label className="grid gap-2 text-xs">Link URL<Input aria-label="Link URL" value={url} placeholder="https://…" onChange={event => setUrl(event.target.value)} /></label><div className="mt-3 flex justify-end gap-2"><Button type="button" size="xs" variant="ghost" onClick={() => { editor?.chain().focus().unsetLink().run(); setLinkOpen(false); }}>Remove</Button><Button type="button" size="xs" disabled={!emailUrl(url, 'link')} onClick={() => { const safe = emailUrl(url, 'link'); if (safe) editor?.chain().focus().extendMarkRange('link').setLink({ href: safe }).run(); setLinkOpen(false); }}>Apply</Button></div></PopoverContent></Popover>
      <span className="ml-auto inline-flex"><EmailIconButton label="Undo" disabled={!editor || disabled} onClick={() => editor?.chain().focus().undo().run()}><Undo className="size-3.5" /></EmailIconButton><EmailIconButton label="Redo" disabled={!editor || disabled} onClick={() => editor?.chain().focus().redo().run()}><Redo className="size-3.5" /></EmailIconButton></span>
    </div>
    <EditorContent editor={editor} />
  </div>;
}
