#!/usr/bin/env node
/**
 * Runs the API regression specs (apps/api/src/** /__tests__/*.spec.ts) with the
 * built-in node:test runner — nothing to install.
 *
 * Each spec is bundled with esbuild. `db/prisma` and `db/redis` imports are
 * swapped for the in-memory fakes in apps/api/src/services/__tests__/fakes, and
 * every LLM key is removed from the environment, so a test can never reach a
 * database or the network.
 *
 * Usage: node scripts/test-api.mjs [name-filter]
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiSrc = path.join(root, 'apps/api/src');
const fakesDir = path.join(apiSrc, 'services/__tests__/fakes');
const filter = process.argv[2] || '';

const specs = readdirSync(apiSrc, { recursive: true })
  .map((p) => String(p).split(path.sep).join('/'))
  .filter((p) => /(^|\/)__tests__\/[^/]+\.spec\.ts$/.test(p) && p.includes(filter))
  .map((p) => path.join(apiSrc, p))
  .sort();

if (specs.length === 0) {
  console.error('No spec files found');
  process.exit(1);
}

const tmp = mkdtempSync(path.join(tmpdir(), 'api-tests-'));
try {
  const outfiles = [];
  for (const spec of specs) {
    const outfile = path.join(tmp, path.basename(spec).replace(/\.ts$/, '.cjs'));
    await build({
      entryPoints: [spec],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile,
      packages: 'external',
      absWorkingDir: root,
      logLevel: 'warning',
      alias: {
        '@whatres/config': path.join(root, 'libs/config/src/index.ts'),
        '@whatres/shared': path.join(root, 'libs/shared/src/index.ts'),
      },
      plugins: [
        {
          name: 'fake-io',
          setup(b) {
            b.onResolve({ filter: /\/db\/(prisma|redis)$/ }, (a) => ({
              path: path.join(fakesDir, a.path.endsWith('redis') ? 'redis.ts' : 'prisma.ts'),
            }));
          },
        },
      ],
    });
    outfiles.push(outfile);
  }

  const env = {
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    NODE_PATH: path.join(root, 'node_modules'),
  };
  for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'AI_ROUTER_ENABLED']) delete env[k];

  // cwd = temp dir so dotenv never picks up a .env with real keys
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...outfiles], {
    env,
    cwd: tmp,
    stdio: 'inherit',
  });
  process.exitCode = r.status ?? 1;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
