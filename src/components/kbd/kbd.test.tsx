/** SSR and native prop contracts for display-only keyboard hints. */
import { describe, expect, test } from 'bun:test';
import { createRef, type CSSProperties } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Kbd, KbdGroup, type KbdProps, type KbdGroupProps } from './index';
import { RecordNavigationBar } from '../ui/record-navigation-bar';

describe('keyboard hint presentation', () => {
  test('renders native keys/groups, merges caller classes and forwards labels and metrics without button semantics', () => {
    const props: KbdProps = { 'aria-label': 'Control', className: 'custom-key', style: { '--zero-kbd-height': '24px' } as CSSProperties };
    const keyRef = createRef<HTMLElement>(), groupRef = createRef<HTMLElement>();
    const groupProps: KbdGroupProps = { 'aria-label': 'Save shortcut', title: 'Display only' };
    const markup = renderToStaticMarkup(<KbdGroup ref={groupRef} {...groupProps} className="custom-group">
      <Kbd ref={keyRef} {...props}>Ctrl</Kbd>
      +<Kbd>S</Kbd>
    </KbdGroup>);
    expect(markup).toContain('<kbd data-slot="kbd-group"'); expect(markup).toContain('zero-kbd-group custom-group');
    expect(markup.match(/data-slot="kbd"/g)).toHaveLength(2);
    expect(markup).toContain('aria-label="Control"'); expect(markup).toContain('aria-label="Save shortcut"');
    expect(markup).toContain('zero-kbd custom-key'); expect(markup).toContain('--zero-kbd-height:24px');
    expect(markup).not.toContain('tabindex'); expect(markup).not.toContain('role="button"');
  });
  test('supports caller-sized SVG icons and explicit accessible icon names', () => {
    const markup = renderToStaticMarkup(<Kbd aria-label="Arrow up"><svg className="size-5" aria-hidden="true"><path d="M0 0" /></svg></Kbd>);
    expect(markup).toContain('aria-label="Arrow up"'); expect(markup).toContain('class="size-5"');
    expect(markup).toContain('aria-hidden="true"');
  });
  test('existing record shortcut strings render through Kbd without changing action buttons or callbacks', () => {
    const markup = renderToStaticMarkup(<RecordNavigationBar currentIndex={0} totalCount={0} onPrevious={() => {}} onNext={() => {}}
      primaryAction={{ label: 'New record', shortcut: 'Cmd+N', onClick() {} }} />);
    expect(markup).toContain('data-slot="kbd"'); expect(markup).toContain('>Cmd+N</kbd>');
    expect(markup).toContain('type="button"'); expect(markup).toContain('hidden @sm/wrapper:inline-flex');
  });
});
