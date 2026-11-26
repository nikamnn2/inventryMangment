/** Purpose: set the password of an existing account (`npm run password`; add -- someone@example.com for another account, -- --prod for production). */
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { config } from '../src/config/index.js';
import { connect } from '../src/database/connection.js';
import { COLLECTIONS as C } from '../src/database/collections.js';
import { checkPassword, hashPassword } from '../src/services/auth.service.js';

const MIN_LENGTH = 12;
const email = (process.argv.slice(2).find(a => !a.startsWith('--')) ?? config.adminEmail).toLowerCase();

/** Reads one line without showing what is typed. */
let muted = false;
const output = new Writable({
  write(chunk, _encoding, done) {
    if (!muted) process.stdout.write(chunk);
    done();
  },
});
const rl = createInterface({ input: process.stdin, output, terminal: !!process.stdin.isTTY });
rl.on('SIGINT', () => {
  console.log('\nCancelled. Nothing was changed.');
  process.exit(1);
});
const lines = rl[Symbol.asyncIterator]();
async function askHidden(prompt) {
  process.stdout.write(prompt);
  muted = true;
  const { value = '' } = await lines.next();
  muted = false;
  process.stdout.write('\n');
  return value;
}

const conn = await connect({ uri: config.mongoUri, dbName: config.dbName, maxPoolSize: 2, minPoolSize: 0 });
try {
  const users = conn.db.collection(C.users);
  if (!(await users.findOne({ email }))) throw new Error(`No account for ${email} in database "${config.dbName}".`);

  console.log(`Changing the password of ${email} in database "${config.dbName}" [${config.env}]. Press Ctrl+C to cancel.`);
  const password = await askHidden(`New password (at least ${MIN_LENGTH} characters): `);
  // sign-in trims the password, so spaces at either end would never match
  if (password !== password.trim()) throw new Error('The password cannot start or end with a space.');
  if (password.length < MIN_LENGTH || password.length > 200) throw new Error(`The password must be ${MIN_LENGTH} to 200 characters.`);
  if ((await askHidden('Type it again: ')) !== password) throw new Error('The two passwords do not match.');

  await users.updateOne({ email }, { $set: { passwordHash: await hashPassword(password), updatedAt: new Date() } });
  const saved = await users.findOne({ email });
  if (!(await checkPassword(password, saved.passwordHash))) throw new Error('The password was not saved correctly.');
  console.log('Password changed. Sign in with the new password.');
  if (saved.status === 'pending') console.log('Note: this account is not activated yet, so it still cannot sign in.');
} catch (err) {
  console.error(`${err.message} Nothing else was changed.`);
  process.exitCode = 1;
} finally {
  rl.close();
  await conn.close();
}
