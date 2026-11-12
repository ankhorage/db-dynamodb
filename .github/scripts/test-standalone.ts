import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/*** Verifies that the exact packed artifact installs and imports from an isolated consumer. */
export const testStandalone = (): void => {
  const fixture = mkdtempSync(join(tmpdir(), 'ankhorage-db-dynamodb-consumer-'));
  const tarballs = join(fixture, 'tarballs');
  const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
    readonly name: string;
    readonly version: string;
  };
  execFileSync('bun', ['pm', 'pack', '--destination', tarballs, '--quiet'], { stdio: 'inherit' });
  const tarball = join(
    tarballs,
    `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`,
  );
  writeFileSync(
    join(fixture, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies: { '@ankhorage/db-dynamodb': `file:${tarball}` },
    }),
  );
  const consumer = [
    "import { createDynamoDbAdapter } from '@ankhorage/db-dynamodb';",
    "const adapter = createDynamoDbAdapter({ tables: { records: { name: 'records', partitionKey: 'id' } }, client: { send: async () => ({}), destroy: () => {} } });",
    "if (adapter.ownsClient) throw new Error('An injected client must remain caller-owned.');",
    'await adapter.close();',
  ].join('\n');
  execFileSync('bun', ['install', '--ignore-scripts'], { cwd: fixture, stdio: 'inherit' });
  execFileSync('bun', ['--eval', consumer], { cwd: fixture, stdio: 'inherit' });
};

if (import.meta.main) testStandalone();
