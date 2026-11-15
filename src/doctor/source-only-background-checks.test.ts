/** Pure source evidence. No modules/configuration/handlers are evaluated or imported from the inspected text. */
import { expect, test } from 'bun:test';
import { checkSourceOnlyBackground } from './source-only-background-checks';
const prefix = "import {defineDatabaseFunction as define} from '@zero/framework/database-automations'; ";
const check = (source: string) => checkSourceOnlyBackground({ path: 'server/source-handler.ts', source });

test('owned durable definitions identify awaited eager start/event handoffs with exact source locations and safe guidance', () => {
  const result = check(prefix + "define({mode:'durable', async handler({zero}) {await zero.torrent.start('PRIVATE_PAYLOAD'); await zero.torrent.deliverEvent(id,'ready');}});");
  expect(result.map(item => item.code)).toEqual(['usage.background.eager_torrent_handoff', 'usage.background.eager_torrent_handoff']);
  expect(result[0]).toMatchObject({ severity: 'warning', category: 'recommended', confidence: 'high', path: 'server/source-handler.ts:1', line: 1 });
  expect(JSON.stringify(result)).not.toContain('PRIVATE_PAYLOAD');
});
test('aliases, namespace imports and a directly bound context use the same narrow ownership evidence', () => {
  expect(check(prefix + "define({mode:'durable', handler:async ({zero:z})=>{await z.torrent.start('run');}});")).toHaveLength(1);
  expect(check("import * as Z from '@zero/framework/database-automations'; Z.defineDatabaseFunction({mode:'durable',async handler(context){await context.zero.torrent.start('run');}});")).toHaveLength(1);
});
test('discarded enqueue receipts are flagged but awaited, returned or grouped promises are not guessed', () => {
  const result = check(prefix + "define({mode:'durable',async handler({zero}) {void zero.torrent.enqueue('a');zero.torrent.enqueueEvent(id,'ready');await zero.torrent.enqueue('b'); await Promise.all([zero.torrent.enqueue('c')]);return zero.torrent.enqueue('d');}});");
  expect(result.map(item => item.code)).toEqual(['usage.background.unacknowledged_torrent_enqueue', 'usage.background.unacknowledged_torrent_enqueue']);
});
test('lookalike imports, shadowing, dynamic modes/spreads, nested callbacks and rebinding do not produce false owned-lane claims', () => {
  const cases = [
    "import {defineDatabaseFunction as define} from 'another-library'; define({mode:'durable',async handler({zero}){await zero.torrent.start('a');}});",
    "import {defineDatabaseFunction as define} from '@zero/framework/icons'; define({mode:'durable',async handler({zero}){await zero.torrent.start('a');}});",
    "import {defineDatabaseFunction as define} from '@zero/framework'; define({mode:'durable',async handler({zero}){await zero.torrent.start('a');}});",
    prefix + "function make(define){define({mode:'durable',async handler({zero}){await zero.torrent.start('a');}});}",
    prefix + "define({mode:'transactional',async handler({zero}){await zero.torrent.start('a');}});",
    prefix + "define({mode:selected,async handler({zero}){await zero.torrent.start('a');}});",
    prefix + "define({mode:'durable',...options,async handler({zero}){await zero.torrent.start('a');}});",
    prefix + "define({mode:'durable',async handler({zero}){const future=async()=>{await zero.torrent.start('a');};}});",
    prefix + "define({mode:'durable',async handler({zero}){zero=custom;await zero.torrent.start('a');}});",
    prefix + "define({mode:'durable',async handler({zero}){zero.torrent=custom;await zero.torrent.start('a');}});",
    prefix + "define({mode:'durable',async handler(ctx){ctx.zero.torrent.start=custom;await ctx.zero.torrent.start('a');}});",
    prefix + "define({mode:'durable',async handler({zero}){{let zero=custom;await zero.torrent.start('a');}}});",
  ];
  for (const source of cases) expect(check(source)).toEqual([]);
});
