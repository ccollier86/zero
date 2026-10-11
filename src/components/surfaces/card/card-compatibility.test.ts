/** Legacy Card/helper paths are identity-only facades, never a second implementation or owner. */
import { expect, test } from 'bun:test';
import * as canonicalCard from './card';
import * as legacyCard from '../../ui/card';
import * as canonicalContentCard from './content-card';
import * as legacyContentCard from '../../ui/content-card';
import * as canonicalPresentation from './card-presentation';
import * as legacyPresentation from '../../ui/card-presentation';
import * as canonicalStatus from './card-status';
import * as legacyStatus from '../../ui/card-status';
import * as family from './index';

test('legacy Card, ContentCard, status and helper paths preserve canonical export identity', () => {
  expect(Object.keys(legacyCard).sort()).toEqual(Object.keys(canonicalCard).sort());
  for (const name of Object.keys(canonicalCard) as Array<keyof typeof canonicalCard>) {
    expect(legacyCard[name]).toBe(canonicalCard[name]);
    expect(family[name]).toBe(canonicalCard[name]);
  }
  expect(legacyContentCard.ContentCard).toBe(canonicalContentCard.ContentCard);
  expect(family.ContentCard).toBe(canonicalContentCard.ContentCard);
  expect(legacyStatus.CardStatus).toBe(canonicalStatus.CardStatus);
  expect(canonicalCard.CardStatus).toBe(canonicalStatus.CardStatus);
  expect(Object.keys(legacyPresentation).sort()).toEqual(Object.keys(canonicalPresentation).sort());
  for (const name of Object.keys(canonicalPresentation) as Array<keyof typeof canonicalPresentation>) {
    expect(legacyPresentation[name]).toBe(canonicalPresentation[name]);
  }
});

test('legacy CSS path imports the sole family-owned selector definitions', async () => {
  const compatibility = await Bun.file(new URL('../../ui/content-card.css', import.meta.url)).text();
  const canonical = await Bun.file(new URL('./content-card.css', import.meta.url)).text();
  expect(compatibility).toContain('@import "../surfaces/card/content-card.css";');
  expect(compatibility).not.toContain('.zero-content-card');
  expect(canonical).toContain('.zero-content-card');
});
