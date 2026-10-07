import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KeyRound, Shield, UserRoundX } from 'lucide-react';
import { RecordNavigationBar } from './record-navigation-bar';

describe('RecordNavigationBar', () => {
  test('defaults to collapsed labels with full accessible names and touch-safe horizontal overflow', () => {
    const markup = renderToStaticMarkup(
      <RecordNavigationBar
        currentIndex={1}
        totalCount={3}
        onPrevious={() => {}}
        onNext={() => {}}
        actions={[
          { icon: createElement(KeyRound), label: 'Reset password', onClick() {} },
          { icon: createElement(Shield), label: 'Revoke sessions', onClick() {} },
          { icon: createElement(UserRoundX), label: 'Suspend account', onClick() {} },
        ]}
        secondaryPrimaryAction={{ label: 'Invite member', onClick() {} }}
        primaryAction={{ label: 'Add member', onClick() {} }}
      />,
    );

    expect(markup).toContain('flex-nowrap');
    expect(markup).toContain('gap-2');
    expect(markup).toContain('overflow-x-auto');
    expect(markup).not.toContain('@sm/wrapper:overflow-visible');
    expect(markup).toContain('>Reset password</span>');
    expect(markup).toContain('>Revoke sessions</span>');
    expect(markup).toContain('>Suspend account</span>');
    expect(markup).not.toContain('invisible');
    expect(markup).not.toContain('max-w-10');
    expect(markup).toContain('aria-label="Reset password"');
    expect(markup).toContain('aria-label="Revoke sessions"');
    expect(markup).toContain('aria-label="Suspend account"');
    expect(markup).not.toContain('sm:flex-nowrap');
    expect(markup.match(/data-label-mode="expand"/g)).toHaveLength(3);
    expect(markup.match(/data-expanded="false"/g)).toHaveLength(3);
  });
  test('bar and per-action opt-outs preserve always-visible labels', () => {
    const markup = renderToStaticMarkup(<RecordNavigationBar currentIndex={0} totalCount={0}
      onPrevious={() => {}} onNext={() => {}} actionLabelMode="visible" actions={[
        { icon: createElement(KeyRound), label: 'Visible default', onClick() {} },
        { icon: createElement(Shield), label: 'Expandable override', labelMode: 'expand', onClick() {} },
      ]} />);
    expect(markup).toContain('data-label-mode="visible" data-expanded="true"');
    expect(markup).toContain('data-label-mode="expand" data-expanded="false"');
  });

  test('uses non-submitting buttons with visible focus treatment throughout', () => {
    const markup = renderToStaticMarkup(
      <RecordNavigationBar
        currentIndex={0}
        totalCount={1}
        onPrevious={() => {}}
        onNext={() => {}}
        actions={[{ icon: createElement(KeyRound), label: 'Reset password', onClick() {} }]}
        primaryAction={{ label: 'Add user', onClick() {} }}
      />,
    );

    expect(markup.match(/type="button"/g)).toHaveLength(4);
    expect(markup).toContain('focus-visible:ring-ring/50');
  });

  test('retains shortcut string display through the shared keyboard primitive', () => {
    const markup = renderToStaticMarkup(<RecordNavigationBar currentIndex={0} totalCount={1} onPrevious={() => {}} onNext={() => {}}
      primaryAction={{ label: 'New table', shortcut: 'Cmd+N', onClick() {} }} />);
    expect(markup).toContain('data-slot="kbd"'); expect(markup).toContain('>Cmd+N</kbd>');
  });
});
