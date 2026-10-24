import { expect, test } from 'bun:test';
import { prepareEmailHtml } from './prepare-email-html';
import { emailInlineImage } from './email-inline-image';
import { emailUrl, EmailHtmlError } from './email-html-policy';
import { emailQuotedText } from './email-quoted-text';

test('HTML5 preprocessing preserves useful email presentation while removing active and passive resource surfaces', () => {
  const result = prepareEmailHtml(`<head><base href="https://tracker.invalid"><link rel="preload" href="https://tracker.invalid/font"><style>@import "https://tracker.invalid/style"; .nice{color:#123456;padding:12px;background:url(https://tracker.invalid/x)}@media(max-width:500px){.nice{font-size:12px}}</style></head>
    <body class="nice" style="color:red" onload="alert(1)"><table cellpadding="8"><tr><td>Readable <b>email</b></td></tr></table><img src="https://tracker.invalid/pixel" srcset="https://tracker.invalid/srcset 2x"><img src="/auth/logout"><script>alert(1)</script><iframe src="https://tracker.invalid/frame"></iframe><form action="/auth/logout"><input></form><svg><a onload="alert(1)"></a></svg></body>`, { appOrigin: 'https://app.example.test' });
  expect(result.html).toContain('<table cellpadding="8">'); expect(result.html).toContain('color:#123456'); expect(result.html).toContain('@media'); expect(result.html).toContain('class="nice" style="color:red"');
  expect(result.html).not.toContain('tracker.invalid'); expect(result.html).not.toContain('/auth/logout');
  for (const tag of ['<script', '<iframe', '<form', '<svg', '<base', '<link', 'onload', 'srcset']) expect(result.html).not.toContain(tag);
  expect(result.blockedImages).toBe(1);
});
test('CSS escaped and nested resource functions cannot bypass the AST policy', () => {
  const result = prepareEmailHtml('<style>.a{background:u\\72l(https://tracker.invalid/x);font-family:var(--unsafe);position:fixed;top:0}.b{background:image-set("https://tracker.invalid/y" 1x)}@font-face{font-family:trap;src:url(https://tracker.invalid/font)}</style><div class="a b" style="background:URL(https://tracker.invalid/z);color:blue">Hello</div>');
  expect(result.html).not.toContain('tracker.invalid'); expect(result.html).not.toContain('position:'); expect(result.html).toContain('color:blue');
});
test('relative, executable and app-local image URLs fail closed; explicit image consent is per render', () => {
  expect(emailUrl('javascript:alert(1)', 'link')).toBeNull(); expect(emailUrl('/auth/logout', 'link')).toBeNull();
  const html = '<img src="https://images.example.test/a.png"><img src="https://app.example.test/auth/logout">';
  expect(prepareEmailHtml(html, { appOrigin: 'https://app.example.test' }).html).not.toContain('src=');
  const enabled = prepareEmailHtml(html, { appOrigin: 'https://app.example.test', loadRemoteImages: true });
  expect(enabled.remoteOrigins).toEqual(['https://images.example.test']); expect(enabled.html).not.toContain('/auth/logout');
  expect(prepareEmailHtml(html).blockedImages).toBe(2);
});
test('complexity limits and raster type/dimension checks fail closed', () => {
  expect(() => prepareEmailHtml('a'.repeat(2 * 1024 * 1024 + 1))).toThrow(EmailHtmlError);
  expect(() => prepareEmailHtml('<div>'.repeat(140) + 'x' + '</div>'.repeat(140))).toThrow(EmailHtmlError);
  expect(() => emailInlineImage(new TextEncoder().encode('<svg onload="alert(1)"></svg>'))).toThrow(EmailHtmlError);
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X1wAAAABJRU5ErkJggg=='), char => char.charCodeAt(0));
  expect(emailInlineImage(png)).toMatchObject({ contentType: 'image/png', width: 1, height: 1 });
  const bad = new Uint8Array(png); new DataView(bad.buffer).setUint32(16, 50000); expect(() => emailInlineImage(bad)).toThrow(EmailHtmlError);
});
test('quoting HTML-only mail preserves readable paragraphs without scripts, styles or resource loading', () => {
  expect(emailQuotedText('<head><style>body{color:red}</style></head><p>Hello <b>Jordan</b></p><p>Second line.</p><script>secret()</script><img src="https://tracker.invalid/x">')).toBe('Hello Jordan\n\nSecond line.');
});
