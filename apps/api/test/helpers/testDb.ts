import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import mariadb from 'mariadb';

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? 'mysql://root:test@127.0.0.1:3317';

/** Creates an empty, fully migrated database for one test, and returns its URL and a cleanup. */
export async function createTestDatabase(): Promise<{ url: string; cleanup(): Promise<void> }> {
  const name = `bsc_${randomBytes(6).toString('hex')}`;
  const admin = new URL(ADMIN_URL);
  const conn = await mariadb.createConnection({
    host: admin.hostname,
    port: Number(admin.port),
    user: admin.username,
    password: admin.password,
  });
  await conn.query(`CREATE DATABASE \`${name}\``);
  const url = `${ADMIN_URL}/${name}`;
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: join(import.meta.dirname, '../..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  return {
    url,
    cleanup: async () => {
      await conn.query(`DROP DATABASE \`${name}\``);
      await conn.end();
    },
  };
}
