/** Private compatibility pins for retained source contracts, not current owner admission.
 *
 * Policies first existed in 010. These are the actual realm identities recorded
 * from 11e9bbc (010), c32d307 (011), 6b3bf16 (012), fdc8262 (013), c6ede3d (014),
 * and 8bd8f25 (015), plus the genuine pre-manifest016 identity, using each
 * complete immutable table map, preserved migration closures and original
 * command/query names. Handler bodies do not participate in realm fingerprints.
 * Never accept an arbitrary retained fingerprint or rewrite old policy history.
 */
export const CALENDAR_INTEGRATION_HISTORICAL_REALMS = Object.freeze([
  Object.freeze({ version: '010', fingerprint: 'sha256:5e457eaab736c993801330867484a05246dc0d173abf911011f79765e7804abe' }),
  Object.freeze({ version: '011', fingerprint: 'sha256:4ca69377a6f4759fab3aae55304413255c837fd5de21f01fd19f91186943ebee' }),
  Object.freeze({ version: '012', fingerprint: 'sha256:571a5df7851c1f10a3aa11097ef00e80162651389a74457f70e8a60dcef1cf91' }),
  Object.freeze({ version: '013', fingerprint: 'sha256:5ed48a9f534752bed35acde772991897a1668122535d5070149c6449f4f5ce97' }),
  Object.freeze({ version: '014', fingerprint: 'sha256:642282673e4e569527bd1d85a6946bd289baf5a4af366d95bb82394b6739e650' }),
  Object.freeze({ version: '015', fingerprint: 'sha256:c49625860fd495b46bfa2e614e40b7283eb8312b41114eef5e7b4cb1cd98f603' }),
  Object.freeze({ version: '016', fingerprint: 'sha256:2b0e98dabe59b6cf27edf49b3bb37b3f11dc6b1e6d0274c6a590db5a3ba601b5' }),
]);

/** Historical contract compatibility only; current physical owner proof stays separate. */
export function isCalendarIntegrationHistoricalRealmFingerprint(input: unknown): input is string {
  return typeof input === 'string' && CALENDAR_INTEGRATION_HISTORICAL_REALMS.some(realm => realm.fingerprint === input);
}
