import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/** Starts the throwaway MariaDB (docker-compose.test.yml) unless one is already reachable. */
export default function setup(): () => void {
  const root = join(import.meta.dirname, '../../../..');
  const compose = (...args: string[]) =>
    execFileSync('docker', ['compose', '-f', join(root, 'docker-compose.test.yml'), ...args], { stdio: 'inherit' });
  compose('up', '-d', '--wait');
  return () => {
    if (!process.env.KEEP_TEST_DB) compose('down', '-v');
  };
}
