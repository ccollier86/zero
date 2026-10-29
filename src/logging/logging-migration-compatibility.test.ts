import { expect, test } from 'bun:test';
import { loggingRealm } from './logging-realm';
import { loggingV6Realm } from './test-support/logging-v6-realm.fixture';

test('the five selected v2.7.0 logging migrations and former realm identity are frozen', () => {
  expect(loggingV6Realm.fingerprint).toBe('sha256:84d3d35129dde877a33ea06f4c9b19c684359167f8cb32dba030d2f063377a90');
  expect(loggingRealm.migrationChecksums.slice(0, 5)).toEqual([
    { version: '001', checksum: 'f7b3ff1f3312fa3748c3f25b79abcfc784781de2e71ca603a8171f166b713422' },
    { version: '002', checksum: '907016d199e9cb12b71fdcec6657b9cdee56d897b0be755d2e1b03f1ba816a17' },
    { version: '003', checksum: '927d49de64190d05547bc5ac17151bc9d224143d88c64d360362d54949bd4d52' },
    { version: '004', checksum: '2407f7938543fbf058a3ca6225106f02229009f43e0fbf8f6a675bf80b88681a' },
    { version: '005', checksum: 'fbf0d4f98177f0fa52fe95e07480630606b0c0d92d4ffc9b2bf36c21fbbf3137' },
  ]);
});
