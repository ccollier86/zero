import { expect, test } from 'bun:test';

import { migrations } from './index';

const MUTABLE_RUNTIME_VALUE_IMPORT = /import\s+(?!type\b)[\s\S]*?\sfrom\s+['"](\.\.\/\.\.\/[^'"]+)['"];?/g;

/**
 * `hashMigration()` protects the exported `up`/`down` function bodies, but a
 * function's string representation does not include module-local helpers or
 * constants that it closes over. Pin the complete numbered definition source
 * as well so an edit to same-file SQL cannot silently retain the ledger
 * checksum. New migrations are appended to this map when they are introduced.
 */
const FROZEN_MIGRATION_DEFINITIONS: Readonly<Record<string, string>> = {
  '001_initial_schema.ts': '8878b278ad73a18ad239384a748b939c330a926ac97b2db7548c84e1bee30416',
  '002_auth_account_lifecycle.ts': 'e76a7dd4566613752f4ce865f71857aca30f37c99b1e5f97860041542771c67d',
  '003_platform_tokens.ts': 'aa8722a1b9a4eaf00d80941e17c2532927b8e3435d7527ec62ccead71a87c6ea',
  '004_auth_email_verification_mfa.ts': 'ffbabf2b5abe54a8a58ff1a3d8e5d2df98f45407fdcab17d88d6e5adf30ec693',
  '005_native_app_auth.ts': 'd6d175f93efd7806d7a51677dbfa9de48c2c3c218326c9762003cdf8d98a319c',
  '006_native_auth_hardening.ts': 'e3f93045baa0ae1cee96a6b86138ef860ff7807da7a797e36d88ab1bba9d127b',
  '007_auth_email_outbox.ts': 'f69ed7fc488b9357401e91cbc70e140bf87102a9042426a3ea08b2b9dcc53867',
  '008_builtin_service_tenant_scope.ts': 'ebadab96f973d3802fda109accb06856f12a5fc2c4ce795dc8a6ca407a6f9041',
  '009_auth_tenancy_sessions.ts': 'aff20b6464f05af4c598c715bbf1bf121089b06d2ba72484c426372a881237ab',
  '010_native_tenant_authority.ts': '925e351d2320f1471f7d777bd380a0da48b74a44d192df69feaa6fe7d2847f7b',
  '011_advanced_authorization_roles.ts': '9d3b324273079b9e1e882b7464ce4f2442085092e6967bd5d8f75d7f605076f0',
  '012_auth_request_admission.ts': 'e7cf5e92553c1a1ad97158f5254aae02533924cd1f29e49605ce50bf197ccd24',
  '013_tenant_invitation_onboarding.ts': '8771173ee33f92f4b63b99d246f20710eeb75ae72b29102a6f7f299d58a48fca',
  '014_workflow_execution_authority.ts': 'ea1d9d9edaa86fe93feca6c46255b82b880fe478ed6b12dd8e19cf8aeaf8d286',
  '015_registration_provisioning.ts': 'bc3a5ea03c5f19f104b8a7b379435dcd995950e8cdff72c86193769197017ce6',
  '016_usable_owner_invariants.ts': '87215a1cb9ba81b40915b6b7728b2c9107bb56bacbcc695d85ec9e7ed1b9b2a6',
  '017_verified_domain_onboarding.ts': 'cf2500b11f627d59c0fb3610265016ff80d0358d15ee2d304f49070b41bfceea',
  '018_auth_control_plane_audit.ts': '823de0c365382e815a78fa7c185a091760f4dd78f6353105093f365454785f68',
  '019_verified_domain_release.ts': '427e58420415cbbaa7ef9b59399dbc211a42eb99d729498087dfb5ef8a96a9e4',
  '020_auth_authority_revision.ts': '2cade89d14afa3c48af54b1fa0bb6a37eba263d0a73ec95a969d3a77d567db58',
  '021_verified_domain_request_provenance.ts': '311c2f98cd346b959f070a3dcb5edcbf458bf5b76fedb1df0755aa667dddb548',
  '022_auth_request_admission_flows.ts': '06b2c9ae641b22dec9a63ee60b307375cef375dfb5711fa68025d37e5c4013be',
  '023_auth_installed_profile.ts': 'edfc1152e4c432a1ed2744b8f6c32fd411c3ae7ae84e7c538140da60cc9137dc',
  '024_administration_tenant.ts': 'b211f28866b33c610a31bc0dbd04b672f70e3cb223f8ae6a2fc79e5e734c6db2',
  '025_auth_mfa_assurance.ts': '4bf44735597f862dd23dffb50d8836fe8f554225797caae8636f595e59c54918',
  '026_tenant_invitation_grant_snapshot.ts': 'c7512f41e5915e3f3ad6f193dc4527d5e5a247fd174d6ecb3d00b0664ccc11e6',
  '027_authorization_registry_manifest.ts': '8ce4499f60da14211dc114a597f81fa75afa20760e8eca6b6f2a40514074bfb7',
  '028_admin_user_provisioning_receipts.ts': '15e32cf527d0006e504c97dd5bfbfa466e3782a445d693ac4f8c92d2a033a20b',
  '029_guardian_api_keys.ts': '10b7e65d959db692a2e43b91aac5d496f5596fcf3aae2caef5825aec51957bc4',
  '030_workflow_graph_runtime.ts': '970cad86968c11246c9c9f46f9a0532c3c6e426e02dd4e0b88c976d6dc17b36b',
  '031_workflow_graph_tenant_integrity.ts': '881e85ac0abe870c357f8cee4994765e56fb14f9a8f523eb2ef1a1fe6ae63a51',
  '032_workflow_runtime_ownership.ts': 'dba700eb05587afab3ebfce6ba9119e7af764e3f079edecbfd23e6607ba1cf94',
  '033_torrent_integrity_hardening.ts': 'f88a844bbc276b41138670fd3e6d1f7c40b9faef1cfa173a15100e58f57e7b56',
  '034_storage_studio_foundation.ts': '29c0d38b55ad687a7ababe894d29447d59bb7c5597ed171c1d3f2475b207ecab',
  '035_storage_blob_leases.ts': 'fb18d96f421e90007d76437269ad6bea8f09fcc644bc365ea79ad36eb14f1b3d',
  '036_workflow_system_event_receipts.ts': '4dcf3233d11a21a915dcea8524cc61997fb00c9657dd7a0eefc33b35848deea2',
  '037_database_automation_source_catalog.ts': '6fe68d59b759d51586f9d76e6b2932871765287462054e352146eddf58f3d552',
};

/**
 * `Migration.up.toString()` cannot see imported helper bodies. These files are
 * therefore part of the already-committed migration definition and must be
 * pinned independently; behavior changes belong in a newly numbered migration.
 */
const FROZEN_LOCAL_DEPENDENCIES: Readonly<Record<string, string>> = {
  '006_native_auth_hardening_schema.ts': '8a441004a5315039595f1182b625d473a7404157ed0a3fbd9b9beef1cf135d10',
  '007_auth_email_outbox_schema.ts': '0b58e7856109c360bb3d9d92ce2b7d1dd3c45235793bd3aa6987c8a6362ba88f',
  '009_auth_tenancy_schema.ts': '86257a375c897123b8a23420d06f9087fa90afb7ae708893835e9513d3006e94',
  '011_advanced_authorization_schema.ts': '3723cfc217dae92384660cc389a16bb06988da2bcde7d79115958900ae8c4e01',
  '012_auth_request_admission_schema.ts': 'b0ba6823fbc715909bf06b740888dcdb825af590f04515f7032685f652aa7886',
  '013_tenant_onboarding_schema.ts': 'aa4b14b4073db88bb7f69c64d4a1c691740896614f1e5d6d2a22b85bdff70460',
  '014_workflow_execution_authority_schema.ts': '0228e10d3c29452c04ce5fd9657331737672e9b9b2f2e0e298e0cd7b175163da',
  '015_registration_provisioning_schema.ts': 'c49a375f490c6885a698c9514012821f81205eda4fd8780c5ac1676eebffdfe7',
  '017_verified_domain_schema.ts': 'f98fc271c9070aad0fd362e9b93597b9c008e86ef4398cf65ac76fb596826af8',
  '018_auth_control_plane_audit_schema.ts': '60aba0ba5352bd40df3e230aeb31fe4535731821b95453e655d159e24cc2332e',
  '020_auth_authority_revision_schema.ts': '2e2365d74430bfcb0ff57c5a052d8878248ebae6c2d2a216567495cdc74602fd',
  '024_authority_revision_refresh.ts': 'c63849138f7df82db27e9d62915a13c55c6717de6544ffc39e1d6405d64a541f',
  '030_workflow_definition_canonical.ts': '142d5e5532efbb7bafccce4038dc83acb28db461d007b3062a806db0fd60ad13',
  '030_workflow_graph_schema.ts': '99b52744060398a5152e402a505980a95ab869a9fc18bbff0521bd83c30d388c',
  '030_workflow_runtime_schema.ts': '7d5fcea4007cdd8f4a20295ecec5c06a81ad408c2bcd49ba17b6a0709d558219',
  '031_workflow_graph_integrity_schema.ts': '4fb85fbd287328bf981a94c9ac624bd11b5e3c69321d9b5e92b6bbd0fc011713',
  '031_workflow_graph_table_rebuilds.ts': 'b15402d664b8ed69caa4d86c1072c6ed8d0ae8e822ac3eff54e73688797f9b84',
};

test('numbered migrations do not import mutable runtime values', async () => {
  const violations: string[] = [];
  const definitions = new Bun.Glob('definitions/[0-9][0-9][0-9]_*.ts');

  for await (const relativePath of definitions.scan({
    cwd: import.meta.dir,
    onlyFiles: true,
  })) {
    const source = await Bun.file(`${import.meta.dir}/${relativePath}`).text();
    for (const match of source.matchAll(MUTABLE_RUNTIME_VALUE_IMPORT)) {
      violations.push(`${relativePath} -> ${match[1]}`);
    }
  }

  expect(violations).toEqual([]);
});

test('numbered migration definitions remain byte-stable and append-only', async () => {
  const discovered: string[] = [];
  const definitions = new Bun.Glob('definitions/[0-9][0-9][0-9]_*.ts');
  for await (const relativePath of definitions.scan({
    cwd: import.meta.dir,
    onlyFiles: true,
  })) {
    const file = relativePath.slice('definitions/'.length);
    const source = (await Bun.file(`${import.meta.dir}/${relativePath}`).text())
      .replace(/\r\n/g, '\n');
    if (/export\s+const\s+migration\s*:/.test(source)) discovered.push(file);
  }

  expect(discovered.sort()).toEqual(
    Object.keys(FROZEN_MIGRATION_DEFINITIONS).sort(),
  );
  expect(migrations.map((migration) => migration.version)).toEqual(
    Object.keys(FROZEN_MIGRATION_DEFINITIONS).map((file) => file.slice(0, 3)),
  );

  const actual: Record<string, string> = {};
  for (const file of Object.keys(FROZEN_MIGRATION_DEFINITIONS)) {
    const source = (await Bun.file(`${import.meta.dir}/definitions/${file}`).text())
      .replace(/\r\n/g, '\n');
    actual[file] = new Bun.CryptoHasher('sha256').update(source).digest('hex');
  }
  expect(actual).toEqual(FROZEN_MIGRATION_DEFINITIONS);
});

test('version-local migration dependencies remain byte-stable', async () => {
  const actual: Record<string, string> = {};
  for (const file of Object.keys(FROZEN_LOCAL_DEPENDENCIES)) {
    const source = (await Bun.file(`${import.meta.dir}/definitions/${file}`).text())
      .replace(/\r\n/g, '\n');
    actual[file] = new Bun.CryptoHasher('sha256').update(source).digest('hex');
  }

  expect(actual).toEqual(FROZEN_LOCAL_DEPENDENCIES);
});
