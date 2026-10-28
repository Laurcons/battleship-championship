import { createInterface } from 'node:readline/promises';
import { hashPassword } from './platform/util.js';

// Usage: pnpm --filter @bsc/api hash-password   (prompts; or pass the password as the first argument). Any password is accepted.
const rl = createInterface({ input: process.stdin, output: process.stderr });
const password = process.argv[2] ?? (await rl.question('Password: '));
rl.close();
console.log(await hashPassword(password));
