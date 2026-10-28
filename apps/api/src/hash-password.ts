import { createInterface } from 'node:readline/promises';
import { hashPassword } from './platform/util.js';

// Usage: pnpm --filter @bsc/api hash-password   (prompts; or pass the password as the first argument)
const rl = createInterface({ input: process.stdin, output: process.stderr });
const password = process.argv[2] ?? (await rl.question('Password: '));
rl.close();
if (password.length < 8) {
  console.error('Use at least 8 characters (the shared password should be long and random).');
  process.exit(1);
}
console.log(await hashPassword(password));
