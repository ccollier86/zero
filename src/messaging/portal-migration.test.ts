/** Release-pinned migration history. Portal routing appends indexes; it must never rewrite published 2.8.0 migrations. */
import { expect, test } from 'bun:test';
import { messagingRealm } from './realm';

test('portal indexes append to the exact nine migration checksums published in Zero 2.8.0', () => {
  // Read from archive commit 00e1ffcb388a606b82e38f8e5bc64db24882c08e,
  // SHA-256 56f699821cf26aaad587e587cc42c8b959f53749acf5a220f70d79d7dec6e020.
  const released = [
    'b7dc81504b79959e4ce10ee13f442a95516851c5a7ddb0ab5dfb25560b3ab811',
    'bc7e5ed3f19ecba2cd691feaece48b4649a8227897e3b7470d0aaf8d23749bd8',
    '73a16c8520f9ee4afa728ea0a13720a9a55b5ea3379e62c41151263316c615de',
    '50909a7a4a144f6a90c3cef798a5b0fce5c5f7fb897a4ef4a61c7ab6c4b81f6e',
    '669d2873e6a8ce2cbbe2f6eed62f8a87665f942eb87b221f51dd24a54c4c9e7d',
    'c8da67b94e0ea74b65d86936048f3e04d2c59ce89844714877178f21bb493290',
    '9815b0f68c8d34602f28f420c59b1064e8d7febf70c59486a9123ab6e0c6b004',
    'd9012328296a7f4799792efe76d87fb4795af186a807e8fdfe048629e1cbbccb',
    'cc4c85546d3a9142f05994472055c6c43a8fb4fd2431ed265a7a6375bf3b09c2',
  ];
  expect(messagingRealm.version).toBe('10');
  expect(messagingRealm.migrationChecksums.slice(0, 9).map(value => value.checksum)).toEqual(released);
  expect(messagingRealm.migrationChecksums.slice(9).map(value => value.version)).toEqual(['010']);
});
