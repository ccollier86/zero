/**
 * Verifies SecretField's server-rendered masking, accessibility, policy, and
 * semantic-token contract. Clipboard behavior is covered at its narrow helper.
 */

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { SecretField } from './secret-field';

describe('SecretField', () => {
  test('is display-only, masked by default, and exposes accessible controls', () => {
    const secret = 'zero_live_1234567890abcd';
    const markup = renderToStaticMarkup(
      <SecretField value={secret} label="API key" visiblePrefix={10} />,
    );

    expect(markup).toContain('data-slot="secret-field"');
    expect(markup).toContain('data-masked="true"');
    expect(markup).toContain('data-copy-state="idle"');
    expect(markup).toContain('zero_live_');
    expect(markup).toContain('abcd');
    expect(markup).toContain('•');
    expect(markup).not.toContain(secret);
    expect(markup).not.toContain('<input');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('API key hidden.');
    expect(markup).toContain('aria-label="Show API key"');
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain('aria-label="Copy API key"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
  });

  test('clamps invalid and overlapping visible segments without revealing a non-empty value', () => {
    const overlap = renderToStaticMarkup(
      <SecretField
        value="abcd"
        visiblePrefix={Number.POSITIVE_INFINITY}
        visibleSuffix={Number.POSITIVE_INFINITY}
        revealable={false}
        copyable={false}
      />,
    );
    const normalized = renderToStaticMarkup(
      <SecretField
        value="abcdef"
        visiblePrefix={-10}
        visibleSuffix={2.9}
        revealable={false}
        copyable={false}
      />,
    );

    expect(overlap).toContain('>abc•</code>');
    expect(overlap).not.toContain('abcd');
    expect(normalized).toContain('>••••ef</code>');
    expect(normalized).not.toContain('abcdef');
  });

  test('forces masking and removes the reveal action when reveal is disabled', () => {
    const markup = renderToStaticMarkup(
      <SecretField
        value="zero_live_forced-mask"
        label="Signing secret"
        masked={false}
        revealable={false}
      />,
    );

    expect(markup).toContain('data-masked="true"');
    expect(markup).toContain('Signing secret hidden.');
    expect(markup).not.toContain('data-slot="secret-field-reveal"');
    expect(markup).not.toContain('zero_live_forced-mask');
  });

  test('renders the controlled showing state and Zero semantic tokens', () => {
    const markup = renderToStaticMarkup(
      <SecretField
        value="zero_live_visible"
        label="API key"
        masked={false}
        className="w-full"
      />,
    );

    expect(markup).toContain('data-masked="false"');
    expect(markup).toContain('zero_live_visible');
    expect(markup).toContain('API key showing.');
    expect(markup).toContain('aria-label="API key value"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('aria-label="Hide API key"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('border-border/80');
    expect(markup).toContain('bg-card');
    expect(markup).toContain('text-card-foreground');
    expect(markup).toContain('w-full');
  });
});
