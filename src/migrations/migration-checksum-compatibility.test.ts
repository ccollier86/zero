import { expect, test } from 'bun:test';

import { migrations } from './index';
import { hashMigration } from './schema-snapshot';

/**
 * Canonical checksums already written by released or committed migration
 * definitions. Keep their exported migration objects byte-stable while moving
 * transitive SQL behind version-named local helpers.
 */
const CANONICAL_CHECKSUMS: Readonly<Record<string, string>> = {
  '001': '94e93cee7f534ac564840b2f72af00b6fec9cfb4f6bce70e51faa4bf21681596',
  '002': '7f1b6b0974b3f06d0d164d38fddf8594441bdf09496264a0cbd7619de6e03264',
  '003': 'd1ac0ebbe5485f5d49576a1f96709be1ff725450d12e76e06b850caa51274bcc',
  '004': 'e075b12038c1814667815aa7404f8e6ea640705c2da85fc65d84f23be6630a06',
  '005': 'fe84c55ca4d576fbd41f05c5bba5a0e6584733343a911a61a91370c196e0b93a',
  '006': '4ffe14ae8c3ec90f317dbe93971aaad41434a74a526279f5245d2adbbc662366',
  '007': 'bd0a4322186613734ae550e8504964cf3111c69a245a1cc2db2cd1aacadb873a',
  '008': '7c515f6cf7bd5b530072a160eb84c89d5a191d551a6d2e7963ae568d43bf72df',
  '009': '8eda00ff83fbe3d0a89436269e20d00e99622ce8fa5d1c7bbb801d87d8802fc4',
  '010': 'cbd1ee84e52f5af738fd26b5eb21acd1eaa1bbd6d2ace761d4d84a4aefd18d62',
  '011': '00a6f859f55dfbd529018278ee9c90868d74804e5d27fb92469ab2b56638e9ef',
  '012': '3b7a3610411883620fc5d7a52121e42e968f9545cc53c2a34e073010ef4faf1e',
  '013': '1e9acd40de193e79e0630e9eee6a919720ed3a86d06f29f25147602d2c44c870',
  '014': 'ac02a556408381725c00c8dbdecb18a0ae18f58150cbd89b59bafa8dcb9ce6ec',
  '015': '7a24e3071e26aa2961972911ad3620d6539130505af525b18ed1c82ddd7a89ca',
  '016': '555335c826b6c0bd41894f7bc8b9d18b35901c496d1d606fb3c39379d6fd2f34',
  '017': '7e4f0e0267f5d0bc965ec45eac6670e0f6c69112aaee3e3b31042e8fc581b619',
  '018': '8944c9d95cc87368b2a807ac1c72409778009078c42f2f2864fdc85ec74de92f',
  '019': 'c3597b97f16cbc6fa870e9186a5e251300e292c794596065e329da8b8d2e29f8',
  '020': '47a64030ca51ed937df7ff7114e005808b8ce7df17e0bfc435c823043b470229',
  '021': '985a1d0759f2597db66c8b91aa04d8b33ef12c2254202b14e59e2dd3951214a0',
  '022': 'e9f279f9d5739e4c974cbe5460129f99319c5990a80ed6a2aa89f7f21f0d9e9c',
  '023': '1d294e147c9b5ddcb6f4556f8c10b961519dbcbf40f4761dde9fd90b3fae1f0a',
  '024': 'eeab6f92994fee216b9e3481054f2176a24cc8f5fa27c8aec7cc32b05834fcfd',
  '025': '170c631ddb7ef614c0cccac7d5dac876aabbac1ad33114d9b2d55fa24014defa',
  '026': 'cd5678f16192d6bff8578d487e2d1e63777251079a0a94a19713b662bf7b5825',
  '027': '16942efc6ac8820c2df2f90f2b5d9a4444cad9d7f214c32e6ff8e99bb26555d4',
  '028': '8d27e76b5b9d9299e436d361b7c847f6e94dce6ce5ca6abbc19f6dd098f5c661',
  '029': '5f898b1f19119a0474bb6c2c22304869cd1ea62eb6e051cb0bc5697e62a5fb51',
};

test('committed migration checksums remain compatible', () => {
  const actual = Object.fromEntries(
    migrations
      .filter((migration) => migration.version in CANONICAL_CHECKSUMS)
      .map((migration) => [migration.version, hashMigration(migration)]),
  );

  expect(actual).toEqual(CANONICAL_CHECKSUMS);
});
