/** Test-only preflight, loaded before the unchanged real dedicated calendar actor. */
import { writeFileSync } from 'node:fs';

if (process.env.ZERO_CALENDAR_FILE_RUNTIME_PARENT_SECRET !== undefined) {
  throw new Error('Calendar actor inherited the synthetic parent environment.');
}

// The command-prefix variant supplies this proof destination as a Bun script
// argument before the private actor suffix. The normal actor parser permits
// unrelated application arguments and still requires the exact private suffix.
const proof = process.argv.find(argument => argument.startsWith('--synthetic-calendar-environment-proof='));
if (!proof) throw new Error('Synthetic calendar environment proof is missing.');
const path = proof.slice('--synthetic-calendar-environment-proof='.length)
  + '-' + process.argv.at(-2) + '-' + process.argv.at(-1);
writeFileSync(path, 'synthetic parent environment absent\n', { flag: 'wx', mode: 0o600 });
