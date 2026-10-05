/** Read-only guide placement check for individually catalogued frontend symbols. */
import { catalogHomes } from './catalog-home-parser';

const root = new URL('../../', import.meta.url);
const catalogs = ['frontend-components', 'frontend-hooks', 'frontend-support', 'frontend-sdk-members'];
const problems: Array<{ catalog: string; symbol: string; reason: string }> = [];
const counts: Record<string, number> = {};
const distinctHomes = new Set<string>();

for (const catalog of catalogs) {
  const file = new URL(`_work/audits/catalogs/${catalog}.md`, root);
  const records = catalogHomes(await Bun.file(file).text());
  counts[catalog] = records.length;
  for (const record of records) {
    if (!record.destination) {
      problems.push({ catalog, symbol: record.symbol, reason: 'No reader home assigned' });
      continue;
    }
    const target = new URL(record.destination, record.rooted ? root : file);
    const path = decodeURIComponent(target.pathname.slice(root.pathname.length));
    if (!target.pathname.startsWith(root.pathname) || path.startsWith('_work/')) {
      problems.push({ catalog, symbol: record.symbol, reason: 'Home is outside the reader tree' });
      continue;
    }
    if (!await Bun.file(target).exists()) {
      problems.push({ catalog, symbol: record.symbol, reason: `Missing ${path}` });
      continue;
    }
    distinctHomes.add(path);
  }
}

console.log(JSON.stringify({
  kind: 'catalog-home-placement-only', counts, records: Object.values(counts).reduce((sum, count) => sum + count, 0),
  distinctHomes: distinctHomes.size, problems,
}, null, 2));
process.exitCode = problems.length ? 1 : 0;
