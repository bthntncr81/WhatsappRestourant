import { getConfig } from '@whatres/config';
import { broadcastService } from '../../api/src/services/broadcast.service';
import prisma from '../../api/src/db/prisma';

const config = getConfig();

console.log('Worker starting...');
console.log(`Environment: ${config.server.nodeEnv}`);
console.log(`Redis: ${config.redis.host}:${config.redis.port}`);

// Campaign send processor: runs every 60 seconds
const SEND_INTERVAL_MS = 60_000;

async function processCampaignSends() {
  try {
    const result = await broadcastService.processPendingSends();
    if (result.sent > 0 || result.failed > 0) {
      console.log(
        `Campaign sends: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped`,
      );
    }
  } catch (err) {
    console.error('Campaign send processing error:', err);
  }
}

// Customer profile sync: runs every 6 hours
const SYNC_INTERVAL_MS = 6 * 60 * 60_000;

async function syncProfiles() {
  try {
    const tenants = await prisma.broadcastSettings.findMany({
      where: { isEnabled: true },
      select: { tenantId: true },
    });
    for (const t of tenants) {
      const result = await broadcastService.syncCustomerProfiles(t.tenantId);
      if (result.created > 0 || result.updated > 0) {
        console.log(
          `Profile sync [${t.tenantId}]: ${result.created} created, ${result.updated} updated`,
        );
      }
    }
  } catch (err) {
    console.error('Profile sync error:', err);
  }
}

async function main() {
  console.log('Worker is ready');

  // Start background loops
  setInterval(processCampaignSends, SEND_INTERVAL_MS);
  setInterval(syncProfiles, SYNC_INTERVAL_MS);

  // Run initial sync after 10 seconds
  setTimeout(syncProfiles, 10_000);

  process.on('SIGTERM', () => {
    console.log('Worker shutting down...');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('Worker shutting down...');
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Worker failed to start:', error);
  process.exit(1);
});
