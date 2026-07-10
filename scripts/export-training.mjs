#!/usr/bin/env node
/**
 * Export AiTrainingSample rows as JSONL for QLoRA fine-tuning of the local
 * Qwen model. One line per sample:
 *   {"messages":[{"role":"system","content":...},{"role":"user","content":...},{"role":"assistant","content":...}]}
 *
 * Usage:
 *   node scripts/export-training.mjs                     # all samples → stdout
 *   node scripts/export-training.mjs --out train.jsonl   # → file
 *   node scripts/export-training.mjs --tenant <id>       # single tenant
 *   node scripts/export-training.mjs --since 2026-07-01  # createdAt >= date
 *   node scripts/export-training.mjs --with-history      # include history turns
 *
 * See docs/ai-flywheel.md for the full flywheel process.
 */
import { createWriteStream } from 'node:fs';
import { config as dotenvConfig } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

dotenvConfig(); // root .env → DATABASE_URL

function getArg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

const databaseUrl =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/whatres_db?schema=public';

const pool = new pg.Pool({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const outPath = getArg('out');
const tenantId = getArg('tenant');
const since = getArg('since');
const withHistory = hasFlag('with-history');

const out = outPath ? createWriteStream(outPath, 'utf8') : process.stdout;

const BATCH = 500;
let cursor;
let count = 0;

try {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = await prisma.aiTrainingSample.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        ...(since ? { createdAt: { gte: new Date(since) } } : {}),
      },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      const ctx = row.contextJson ?? {};
      const messages = [{ role: 'system', content: ctx.system ?? '' }];
      if (withHistory && Array.isArray(ctx.history)) {
        for (const turn of ctx.history) {
          if (turn && (turn.role === 'user' || turn.role === 'assistant') && turn.content) {
            messages.push({ role: turn.role, content: turn.content });
          }
        }
      }
      // Avoid duplicating the user message when history already ends with it
      const last = messages[messages.length - 1];
      if (!(last && last.role === 'user' && last.content === row.userMessage)) {
        messages.push({ role: 'user', content: row.userMessage });
      }
      messages.push({ role: 'assistant', content: row.assistantReply });

      out.write(JSON.stringify({ messages }) + '\n');
      count++;
    }
    cursor = rows[rows.length - 1].id;
  }

  if (outPath) {
    await new Promise((resolve, reject) => {
      out.end(() => resolve());
      out.on('error', reject);
    });
  }
  process.stderr.write(`Exported ${count} training samples${outPath ? ` → ${outPath}` : ''}\n`);
} finally {
  await prisma.$disconnect();
  await pool.end();
}
