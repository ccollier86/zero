import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnimateIcon, IconWrapper, useAnimateIconContext } from './icon';

function Probe() {
  const context = useAnimateIconContext();
  return <svg data-retain={String(context.persistOnAnimateEnd)} data-reset={String(context.initialOnAnimateEnd)} />;
}

test('retention policy is inherited by ordinary and nested wrapped icons', () => {
  expect(renderToStaticMarkup(<AnimateIcon persistOnAnimateEnd><Probe /></AnimateIcon>))
    .toContain('data-retain="true"');
  expect(renderToStaticMarkup(<AnimateIcon persistOnAnimateEnd><IconWrapper icon={Probe} /></AnimateIcon>))
    .toContain('data-retain="true"');
  expect(renderToStaticMarkup(<AnimateIcon persistOnAnimateEnd><IconWrapper icon={Probe} persistOnAnimateEnd={false} /></AnimateIcon>))
    .toContain('data-retain="false"');
});

test('direct wrapped icons forward explicit retention and reset behavior without a parent context', () => {
  expect(renderToStaticMarkup(<IconWrapper icon={Probe} animate persistOnAnimateEnd initialOnAnimateEnd />))
    .toContain('data-retain="true" data-reset="true"');
});
