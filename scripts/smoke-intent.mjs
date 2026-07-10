#!/usr/bin/env node
/**
 * Smoke test for the LLM-free parts of the hybrid AI layer:
 *   1. detectNegativeConstraint() regex detector (intent-analysis.service.ts)
 *   2. decideReplyModel() router rule       (model-router.service.ts)
 *
 * No LLM / network calls. TS sources are bundled on the fly with esbuild.
 *
 * Usage: node scripts/smoke-intent.mjs
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Keep pino transport-free inside the bundle (no pino-pretty worker)
process.env.NODE_ENV = 'production';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(path.join(tmpdir(), 'smoke-intent-'));

async function bundleAndImport(entry, name) {
  const outfile = path.join(tmp, name);
  await build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    alias: {
      '@whatres/config': path.join(root, 'libs/config/src/index.ts'),
      '@whatres/shared': path.join(root, 'libs/shared/src/index.ts'),
    },
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
}

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (got: ${JSON.stringify(actual)}, want: ${JSON.stringify(expected)})`);
}

try {
  const intentMod = await bundleAndImport(
    'apps/api/src/services/nlu/intent-analysis.service.ts',
    'intent-analysis.cjs'
  );
  const routerMod = await bundleAndImport(
    'apps/api/src/services/ai/model-router.service.ts',
    'model-router.cjs'
  );

  const { detectNegativeConstraint } = intentMod;
  const { decideReplyModel, ModelRouterService } = routerMod;

  console.log('\n--- 1. Negative-constraint regex detector ---');
  // positives (raw Turkish + normalizeTr'ed variants)
  for (const text of [
    'soğan olmasın',
    'sogan olmasin lutfen',
    'sadece ketçap olsun',
    'acı sos hariç her şey olur',
    'haric olsun aci',
    'turşu istemiyorum',
    'sos koyma',
    'mayonez ekleme',
    'yalnızca peynirli olsun',
    'yalnizca et doner',
    'mayonez dışında hepsi olur',
    'disinda bir sey olmasin',
  ]) {
    check(`positive: "${text}"`, detectNegativeConstraint(text), true);
  }
  // negatives
  for (const text of [
    'bir tavuk döner',
    'iki kola bir ayran',
    'menü',
    'evet onaylıyorum',
    'bir de patates ekler misiniz',
    'merhaba iyi günler',
  ]) {
    check(`negative: "${text}"`, detectNegativeConstraint(text), false);
  }

  console.log('\n--- 2. Reply-model router rule ---');
  const base = { hasAnthropicKey: true, routerEnabled: true };
  check(
    'no ANTHROPIC_API_KEY → local',
    decideReplyModel({ hasAnthropicKey: false, routerEnabled: true, actionableIntentCount: 5, negativeConstraint: true }),
    'local'
  );
  check(
    'AI_ROUTER_ENABLED=false → local',
    decideReplyModel({ hasAnthropicKey: true, routerEnabled: false, actionableIntentCount: 5, negativeConstraint: true }),
    'local'
  );
  check(
    '0 actionable intents, no constraint → haiku',
    decideReplyModel({ ...base, actionableIntentCount: 0, negativeConstraint: false }),
    'haiku'
  );
  check(
    '1 actionable intent, no constraint → haiku',
    decideReplyModel({ ...base, actionableIntentCount: 1, negativeConstraint: false }),
    'haiku'
  );
  check(
    '2 actionable intents → sonnet',
    decideReplyModel({ ...base, actionableIntentCount: 2, negativeConstraint: false }),
    'sonnet'
  );
  check(
    '3 actionable intents → sonnet',
    decideReplyModel({ ...base, actionableIntentCount: 3, negativeConstraint: false }),
    'sonnet'
  );
  check(
    'negativeConstraint → sonnet',
    decideReplyModel({ ...base, actionableIntentCount: 1, negativeConstraint: true }),
    'sonnet'
  );

  console.log('\n--- 3. ModelRouterService.route() (env-driven) ---');
  const router = new ModelRouterService();
  const savedKey = process.env.ANTHROPIC_API_KEY;
  const savedEnabled = process.env.AI_ROUTER_ENABLED;

  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_ROUTER_ENABLED;
  check(
    'route(): no key → local even with 2 intents + constraint',
    router.route({ actionableIntentCount: 2, negativeConstraint: true }, true).model,
    'local'
  );
  check('route(): no key → isEnabled() false', router.isEnabled(), false);

  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  check(
    'route(): key + null analysis + regex constraint → sonnet',
    router.route(null, true).model,
    'sonnet'
  );
  check(
    'route(): key + null analysis, no constraint → haiku',
    router.route(null, false).model,
    'haiku'
  );
  check(
    'route(): key + LLM constraint (regex false) → sonnet (OR)',
    router.route({ actionableIntentCount: 0, negativeConstraint: true }, false).model,
    'sonnet'
  );
  process.env.AI_ROUTER_ENABLED = 'false';
  check(
    'route(): kill switch AI_ROUTER_ENABLED=false → local',
    router.route({ actionableIntentCount: 3, negativeConstraint: true }, true).model,
    'local'
  );

  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
  if (savedEnabled === undefined) delete process.env.AI_ROUTER_ENABLED;
  else process.env.AI_ROUTER_ENABLED = savedEnabled;

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
